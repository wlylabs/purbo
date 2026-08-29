/**
 * The sync merge.
 *
 * These are the rules that decide whether a password written on one device
 * survives a save on another, so they are tested against the shapes that
 * actually caused loss: simultaneous edits, an offline device catching up, a
 * deletion racing an edit, and a passphrase rotated while disconnected.
 */

import assert from "node:assert/strict";

import { TOMBSTONE_TTL_MS, addTombstone, mergeVaults, type MergeSide } from "@/lib/vault/merge";
import type { EncryptedItem, KeyEnvelope, Tombstone } from "@/lib/vault/types";
import { report, test } from "./harness";

function box(ct: string) {
  return { v: 1, iv: "aaaa", ct } as const;
}

function item(id: string, updatedAt: number, ct = `ct-${id}`): EncryptedItem {
  return { id, payload: box(ct), updatedAt };
}

function envelope(wrapped: string, salt = "salt"): KeyEnvelope {
  return {
    version: 1,
    salt,
    kdf: { algorithm: "argon2id", memoryKiB: 65536, iterations: 3, parallelism: 1 },
    wrapped: box(wrapped),
    verifier: box("verifier"),
    auth: box("auth"),
    rootSalt: "rootsalt",
    createdAt: 1,
  };
}

function side(
  items: EncryptedItem[],
  revision: number,
  deleted: Tombstone[] = [],
  wrapped = "envelope",
): MergeSide {
  return { envelope: envelope(wrapped), items, deleted, revision };
}

const ids = (result: { items: EncryptedItem[] }) => result.items.map((i) => i.id).sort();

/**
 * Times are written relative to now, not as small integers.
 *
 * A tombstone is only kept while it is younger than its lifetime, so a
 * fixture dated `200` is a deletion from 1970 that the merge is right to
 * forget — and a test built on one would be asserting the opposite of what it
 * means to.
 */
const NOW = Date.now();
const ago = (ms: number) => NOW - ms;
const MINUTE = 60_000;

// ------------------------------------------------------------------ additions

await test("an entry added on each device survives the merge", () => {
  const merged = mergeVaults(side([item("a", 10)], 5), side([item("b", 11)], 6));
  assert.deepEqual(ids(merged), ["a", "b"]);
  assert.equal(merged.differsFromRemote, true);
  assert.equal(merged.differsFromLocal, true);
  assert.equal(merged.revision, 6);
});

await test("this is the case the old last-writer-wins rule lost", () => {
  // The server is ahead by revision, so the previous implementation replaced
  // the local vault wholesale and the entry added here disappeared.
  const local = side([item("shared", 1), item("added-here", 20)], 4);
  const remote = side([item("shared", 1), item("added-there", 21)], 9);

  const merged = mergeVaults(local, remote);
  assert.deepEqual(ids(merged), ["added-here", "added-there", "shared"]);
});

await test("an offline device catches up without losing its own edits", () => {
  const local = side([item("a", 10), item("offline", 50)], 3);
  const remote = side([item("a", 10), item("b", 40)], 12);

  const merged = mergeVaults(local, remote);
  assert.deepEqual(ids(merged), ["a", "b", "offline"]);
  assert.equal(merged.differsFromRemote, true, "the server has to hear about it");
});

// -------------------------------------------------------------------- updates

await test("the newer edit of one entry wins", () => {
  const merged = mergeVaults(
    side([item("a", 100, "mine")], 2),
    side([item("a", 50, "theirs")], 8),
  );
  assert.equal(merged.items.length, 1);
  assert.equal(merged.items[0]!.payload.ct, "mine");
});

await test("two edits at the same instant converge on the same answer", () => {
  const mine = item("a", 100, "aaa");
  const theirs = item("a", 100, "zzz");

  const here = mergeVaults(side([mine], 1), side([theirs], 1));
  const there = mergeVaults(side([theirs], 1), side([mine], 1));

  assert.equal(here.items[0]!.payload.ct, there.items[0]!.payload.ct);
});

await test("identical vaults need no write in either direction", () => {
  const merged = mergeVaults(side([item("a", 1)], 7), side([item("a", 1)], 7));
  assert.equal(merged.differsFromRemote, false);
  assert.equal(merged.differsFromLocal, false);
});

// ------------------------------------------------------------------ deletions

await test("a deletion is not undone by the other device still holding it", () => {
  const local = side([], 4, [{ id: "a", deletedAt: ago(MINUTE) }]);
  const remote = side([item("a", ago(2 * MINUTE))], 9);

  const merged = mergeVaults(local, remote);
  assert.deepEqual(ids(merged), []);
  assert.equal(merged.deleted.length, 1);
  assert.equal(merged.differsFromRemote, true);
});

await test("without a tombstone the entry would come back", () => {
  // The shape of the bug this format change fixes: a delete that is only an
  // absence is indistinguishable from never having had the entry.
  const merged = mergeVaults(side([], 4), side([item("a", ago(MINUTE))], 9));
  assert.deepEqual(ids(merged), ["a"]);
});

await test("an entry edited after it was deleted elsewhere survives", () => {
  const local = side([], 4, [{ id: "a", deletedAt: ago(2 * MINUTE) }]);
  const remote = side([item("a", ago(MINUTE))], 9);

  const merged = mergeVaults(local, remote);
  assert.deepEqual(ids(merged), ["a"]);
  assert.deepEqual(merged.deleted, [], "the deletion is superseded, not kept");
});

await test("tombstones are dropped once nothing holds the entry", () => {
  const merged = mergeVaults(
    side([], 4, [{ id: "gone", deletedAt: ago(MINUTE) }]),
    side([], 4, [{ id: "gone", deletedAt: ago(MINUTE) }]),
  );
  assert.equal(merged.deleted.length, 1, "still remembered while it may be needed");
  assert.deepEqual(ids(merged), []);
});

await test("a tombstone past its lifetime is forgotten", () => {
  const stale = Date.now() - TOMBSTONE_TTL_MS - 1;
  const merged = mergeVaults(side([], 1, [{ id: "old", deletedAt: stale }]), side([], 1));
  assert.deepEqual(merged.deleted, []);
});

await test("the later of two deletions is the one kept", () => {
  const merged = mergeVaults(
    side([], 1, [{ id: "a", deletedAt: ago(3 * MINUTE) }]),
    side([], 1, [{ id: "a", deletedAt: ago(MINUTE) }]),
  );
  assert.equal(merged.deleted[0]!.deletedAt, ago(MINUTE));
});

await test("addTombstone replaces an earlier record for the same entry", () => {
  const first = addTombstone([], "a", ago(2 * MINUTE));
  const second = addTombstone(first, "a", ago(MINUTE));
  assert.equal(second.length, 1);
  assert.equal(second[0]!.deletedAt, ago(MINUTE));
});

// ------------------------------------------------------------------ envelopes

await test("a passphrase rotated here is not reverted by the server's copy", () => {
  const local = side([], 4, [], "rotated");
  const remote = side([], 9, [], "old");

  const merged = mergeVaults(local, remote, { envelopeChangedLocally: true });
  assert.equal(merged.envelope.wrapped.ct, "rotated");
  assert.equal(merged.differsFromRemote, true);
});

await test("otherwise the server's envelope stands", () => {
  const merged = mergeVaults(side([], 4, [], "stale"), side([], 9, [], "current"));
  assert.equal(merged.envelope.wrapped.ct, "current");
});

await test("merging is symmetric", () => {
  const a = side([item("a", 10), item("both", 30, "newer")], 3, [
    { id: "x", deletedAt: ago(MINUTE) },
  ]);
  const b = side([item("b", 20), item("both", 10, "older")], 8);

  const forwards = mergeVaults(a, b);
  const backwards = mergeVaults(b, a);

  assert.deepEqual(ids(forwards), ids(backwards));
  assert.deepEqual(
    forwards.items.map((i) => i.payload.ct).sort(),
    backwards.items.map((i) => i.payload.ct).sort(),
  );
});

report("merge checks");
