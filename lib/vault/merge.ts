/**
 * Merging two copies of one vault.
 *
 * Sync used to be last-writer-wins: whichever side carried the higher
 * revision replaced the other wholesale. That is fine until two devices both
 * have something to say, and then it is silent data loss — a password added
 * on a phone disappears because a laptop happened to save afterwards.
 *
 * The pieces needed to do better are already in the format. Every entry has a
 * random id and an `updatedAt`, both outside the ciphertext, so two vaults can
 * be reconciled entry by entry without either side being decrypted. Deletion
 * is the one operation a union cannot express — an entry deleted here is just
 * an entry the other side still has — so it is recorded as a tombstone and
 * merged alongside the entries.
 *
 * The rules, in full:
 *
 *   - an entry present on one side only is kept
 *   - an entry on both sides is kept at its newer `updatedAt`
 *   - equal timestamps are broken by comparing the ciphertext, so both devices
 *     independently reach the same answer rather than each preferring its own
 *   - a tombstone removes an entry whose `updatedAt` is not newer than the
 *     deletion, and is itself dropped once the entry it names is gone from
 *     both sides
 *   - an entry edited *after* it was deleted elsewhere survives, and the
 *     tombstone is discarded: an edit is evidence someone still wants it
 *
 * This is convergent — merging in either direction gives the same vault — and
 * every rule runs on metadata alone, so the server could do none of it.
 */

import type { EncryptedItem, KeyEnvelope, Tombstone } from "./types";

/** One side of a merge: what a device or the server currently holds. */
export interface MergeSide {
  envelope: KeyEnvelope;
  items: EncryptedItem[];
  deleted?: Tombstone[];
  revision: number;
}

export interface MergeResult {
  envelope: KeyEnvelope;
  items: EncryptedItem[];
  deleted: Tombstone[];
  /** The higher of the two revisions. Callers add one to publish a write. */
  revision: number;
  /** Whether the merge differs from what the server holds — i.e. push. */
  differsFromRemote: boolean;
  /** Whether it differs from this device — i.e. rewrite and re-decrypt. */
  differsFromLocal: boolean;
}

/**
 * How long a deletion is remembered.
 *
 * A tombstone has to outlive every copy of the entry it deletes, and the only
 * copy that matters is on a device that has been offline since before the
 * deletion. Ninety days covers a laptop left in a drawer over a summer; a
 * device gone longer than that can resurrect an entry, which is the honest
 * cost of not keeping every deletion forever.
 */
export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** Deterministic winner for two versions of the same entry. */
function newer(a: EncryptedItem, b: EncryptedItem): EncryptedItem {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  // Same instant, different bytes: pick by ciphertext so that a device
  // merging A into B and a device merging B into A agree. Preferring "mine"
  // here would leave the two permanently disagreeing and pushing over
  // each other.
  return a.payload.ct >= b.payload.ct ? a : b;
}

function byId<T extends { id: string }>(entries: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const entry of entries) map.set(entry.id, entry);
  return map;
}

/** A stable summary of one side, used only to decide whether to write. */
function fingerprint(side: {
  envelope: KeyEnvelope;
  items: readonly EncryptedItem[];
  deleted?: readonly Tombstone[];
}): string {
  const items = [...side.items]
    .map((item) => `${item.id}:${item.updatedAt}:${item.payload.ct}`)
    .sort()
    .join("|");
  const deleted = [...(side.deleted ?? [])]
    .map((stone) => `${stone.id}:${stone.deletedAt}`)
    .sort()
    .join("|");
  return `${side.envelope.salt}:${side.envelope.wrapped.ct}#${items}#${deleted}`;
}

/**
 * Reconciles this device's vault with the server's.
 *
 * `envelopeChangedLocally` decides the one field that cannot be merged. An
 * envelope is not a collection — it is a single wrapped root key — so a merge
 * has to choose one, and choosing by revision would mean a passphrase the
 * user just rotated being quietly reverted by a sync. The device that changed
 * it therefore wins; when neither changed it, the server's copy stands.
 */
export function mergeVaults(
  local: MergeSide,
  remote: MergeSide,
  { envelopeChangedLocally = false, now = Date.now() } = {},
): MergeResult {
  const localItems = byId(local.items);
  const remoteItems = byId(remote.items);
  const stones = new Map<string, Tombstone>();

  for (const stone of [...(remote.deleted ?? []), ...(local.deleted ?? [])]) {
    const existing = stones.get(stone.id);
    if (!existing || stone.deletedAt > existing.deletedAt) stones.set(stone.id, stone);
  }

  const merged: EncryptedItem[] = [];
  for (const id of new Set([...localItems.keys(), ...remoteItems.keys()])) {
    const mine = localItems.get(id);
    const theirs = remoteItems.get(id);
    const winner = mine && theirs ? newer(mine, theirs) : (mine ?? theirs)!;

    const stone = stones.get(id);
    if (stone && stone.deletedAt >= winner.updatedAt) continue;
    // Edited after the deletion: the entry is wanted, so the deletion is not.
    if (stone) stones.delete(id);
    merged.push(winner);
  }

  const survivors = new Set(merged.map((item) => item.id));
  const deleted = [...stones.values()]
    .filter((stone) => !survivors.has(stone.id) && now - stone.deletedAt < TOMBSTONE_TTL_MS)
    .sort((a, b) => b.deletedAt - a.deletedAt);

  merged.sort((a, b) => b.updatedAt - a.updatedAt);

  const envelope = envelopeChangedLocally ? local.envelope : remote.envelope;
  const result = { envelope, items: merged, deleted };

  return {
    ...result,
    revision: Math.max(local.revision, remote.revision),
    differsFromRemote: fingerprint(result) !== fingerprint(remote),
    differsFromLocal: fingerprint(result) !== fingerprint(local),
  };
}

/** Adds a deletion to a tombstone list, replacing any older one for that id. */
export function addTombstone(
  deleted: readonly Tombstone[],
  id: string,
  at = Date.now(),
): Tombstone[] {
  return [{ id, deletedAt: at }, ...deleted.filter((stone) => stone.id !== id)];
}
