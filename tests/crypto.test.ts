/**
 * End-to-end exercise of the vault's crypto layer, run under Node's
 * type-stripping mode against the real source files.
 */

import assert from "node:assert/strict";

import { seal, open, importAesKey } from "@/lib/crypto/aead";
import { deriveKeyEncryptionKey, hkdf, assertAcceptableKdfParams } from "@/lib/crypto/kdf";
import {
  createRecoveryPhrase,
  isValidRecoveryPhrase,
  phraseToSeed,
} from "@/lib/crypto/mnemonic";
import {
  generatePassword,
  estimateStrength,
  generatorEntropyBits,
  DEFAULT_GENERATOR_OPTIONS,
} from "@/lib/crypto/password";
import { randomInt, toBase64Url, fromBase64Url, wipe } from "@/lib/crypto/primitives";
import {
  createKeyring,
  unlockWithPassphrase,
  unlockWithRecoveryPhrase,
  rewrapWithNewPassphrase,
  IncorrectPassphraseError,
} from "@/lib/vault/keyring";
import { encryptItem, decryptItem, decryptAll, draftToItem } from "@/lib/vault/records";

const results: string[] = [];
function pass(name: string) {
  results.push(`  ok   ${name}`);
}

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    pass(name);
  } catch (error) {
    console.error(`  FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

const USER = "did:privy:test-user-0001";
const OTHER_USER = "did:privy:test-user-0002";

// ---------------------------------------------------------------- primitives

await test("base64url round-trips arbitrary bytes", () => {
  for (let i = 0; i < 200; i++) {
    const bytes = new Uint8Array(i);
    crypto.getRandomValues(bytes);
    assert.deepEqual(fromBase64Url(toBase64Url(bytes)), bytes);
  }
});

await test("base64url output is URL-safe and unpadded", () => {
  for (let i = 0; i < 500; i++) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const encoded = toBase64Url(bytes);
    assert.match(encoded, /^[A-Za-z0-9_-]+$/, `unexpected chars in ${encoded}`);
  }
});

await test("randomInt stays in range and is not visibly biased", () => {
  const buckets = new Array(7).fill(0);
  const draws = 140_000;
  for (let i = 0; i < draws; i++) {
    const value = randomInt(7);
    assert.ok(value >= 0 && value < 7);
    buckets[value]++;
  }
  const expected = draws / 7;
  for (const count of buckets) {
    // Well outside plausible sampling noise; catches modulo bias, not luck.
    assert.ok(
      Math.abs(count - expected) < expected * 0.05,
      `bucket ${count} deviates too far from ${expected}`,
    );
  }
});

await test("wipe zeroes a buffer", () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  wipe(bytes);
  assert.deepEqual(bytes, new Uint8Array([0, 0, 0, 0]));
});

// ---------------------------------------------------------------------- AEAD

await test("AES-GCM round-trips and rejects a wrong AAD", async () => {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  const key = await importAesKey(raw);
  const message = new TextEncoder().encode("correct horse battery staple");

  const box = await seal(key, message, "context:a");
  assert.deepEqual(await open(key, box, "context:a"), message);

  await assert.rejects(() => open(key, box, "context:b"), "wrong AAD must not decrypt");
});

await test("AES-GCM rejects a flipped ciphertext bit", async () => {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  const key = await importAesKey(raw);
  const box = await seal(key, new TextEncoder().encode("tamper me"), "ctx");

  const bytes = fromBase64Url(box.ct);
  bytes[0] = bytes[0]! ^ 0x01;
  const tampered = { ...box, ct: toBase64Url(bytes) };

  await assert.rejects(() => open(key, tampered, "ctx"));
});

await test("each seal uses a fresh IV", async () => {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  const key = await importAesKey(raw);
  const message = new TextEncoder().encode("same plaintext");

  const seen = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const box = await seal(key, message, "ctx");
    assert.ok(!seen.has(box.iv), "IV reuse detected");
    seen.add(box.iv);
  }
});

await test("AES key import rejects a wrong-sized key", async () => {
  await assert.rejects(() => importAesKey(new Uint8Array(16)));
});

// ----------------------------------------------------------------------- KDF

await test("Argon2id is deterministic and salt-dependent", async () => {
  const salt = new Uint8Array(16).fill(7);
  const otherSalt = new Uint8Array(16).fill(8);
  const params = { algorithm: "argon2id", memoryKiB: 19 * 1024, iterations: 2, parallelism: 1 } as const;

  const a = await deriveKeyEncryptionKey("passphrase", salt, params);
  const b = await deriveKeyEncryptionKey("passphrase", salt, params);
  const c = await deriveKeyEncryptionKey("passphrase", otherSalt, params);

  assert.equal(a.length, 32);
  assert.deepEqual(a, b, "same inputs must give the same key");
  assert.notDeepEqual(a, c, "different salts must diverge");
});

await test("Argon2id normalises unicode passphrases", async () => {
  const salt = new Uint8Array(16).fill(3);
  const params = { algorithm: "argon2id", memoryKiB: 19 * 1024, iterations: 2, parallelism: 1 } as const;

  // Same string, composed vs decomposed forms — must derive the same key.
  const composed = await deriveKeyEncryptionKey("café-vault", salt, params);
  const decomposed = await deriveKeyEncryptionKey("café-vault", salt, params);
  assert.deepEqual(composed, decomposed);
});

await test("weak KDF parameters are refused", () => {
  assert.throws(() =>
    assertAcceptableKdfParams({
      algorithm: "argon2id",
      memoryKiB: 8,
      iterations: 1,
      parallelism: 1,
    }),
  );
  assert.throws(() =>
    assertAcceptableKdfParams({
      algorithm: "pbkdf2" as never,
      memoryKiB: 65536,
      iterations: 3,
      parallelism: 1,
    }),
  );
});

await test("short KDF salt is refused", async () => {
  await assert.rejects(() => deriveKeyEncryptionKey("x", new Uint8Array(8)));
});

await test("HKDF separates domains", async () => {
  const ikm = new Uint8Array(32).fill(9);
  const a = await hkdf(ikm, "purbo:one:v1");
  const b = await hkdf(ikm, "purbo:two:v1");
  assert.equal(a.length, 32);
  assert.notDeepEqual(a, b, "different info labels must give unrelated keys");
});

// ------------------------------------------------------------------- mnemonic

await test("recovery phrases are 24 valid words and unique", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const phrase = createRecoveryPhrase();
    assert.equal(phrase.split(" ").length, 24);
    assert.ok(isValidRecoveryPhrase(phrase));
    assert.ok(!seen.has(phrase), "duplicate phrase generated");
    seen.add(phrase);
  }
});

await test("a corrupted phrase fails its checksum", () => {
  const phrase = createRecoveryPhrase().split(" ");
  phrase[0] = phrase[0] === "abandon" ? "ability" : "abandon";
  // Overwhelmingly likely to break the checksum; assert on the API, not luck.
  const mutated = phrase.join(" ");
  if (isValidRecoveryPhrase(mutated)) {
    // Rare legitimate collision — retry once with a different word.
    phrase[1] = "zoo";
    assert.equal(isValidRecoveryPhrase(phrase.join(" ")), false);
  }
});

await test("seed derivation is deterministic", async () => {
  const phrase = createRecoveryPhrase();
  const a = await phraseToSeed(phrase);
  const b = await phraseToSeed(phrase.toUpperCase());
  assert.equal(a.length, 64);
  assert.deepEqual(a, b, "case and whitespace must normalise");
});

// ------------------------------------------------------------------- keyring

await test("create then unlock with the passphrase", async () => {
  const phrase = createRecoveryPhrase();
  const { envelope, keyring } = await createKeyring(USER, phrase, "a-long-passphrase-1");

  const reopened = await unlockWithPassphrase(USER, envelope, "a-long-passphrase-1");

  const item = draftToItem({ name: "GitHub", username: "me", password: "s3cr3t" });
  const encrypted = await encryptItem(keyring, item);
  const decrypted = await decryptItem(reopened, encrypted);

  assert.equal(decrypted.password, "s3cr3t");
  assert.equal(decrypted.name, "GitHub");
});

await test("a wrong passphrase is rejected uniformly", async () => {
  const phrase = createRecoveryPhrase();
  const { envelope } = await createKeyring(USER, phrase, "correct-passphrase-1");

  await assert.rejects(
    () => unlockWithPassphrase(USER, envelope, "wrong-passphrase-1"),
    (error: unknown) => error instanceof IncorrectPassphraseError,
  );
});

await test("another user's id cannot unwrap the envelope", async () => {
  const phrase = createRecoveryPhrase();
  const { envelope } = await createKeyring(USER, phrase, "shared-passphrase-1");

  // Even knowing the passphrase, the AAD binds the envelope to its owner.
  await assert.rejects(
    () => unlockWithPassphrase(OTHER_USER, envelope, "shared-passphrase-1"),
    (error: unknown) => error instanceof IncorrectPassphraseError,
  );
});

await test("recovery phrase unlocks without the passphrase", async () => {
  const phrase = createRecoveryPhrase();
  const { envelope, keyring } = await createKeyring(USER, phrase, "original-passphrase-1");

  const item = draftToItem({ name: "Bank", username: "acct", password: "vault-value" });
  const encrypted = await encryptItem(keyring, item);

  const viaPhrase = await unlockWithRecoveryPhrase(USER, envelope, phrase);
  assert.equal((await decryptItem(viaPhrase, encrypted)).password, "vault-value");
});

await test("a different phrase does not open the vault", async () => {
  const phrase = createRecoveryPhrase();
  const { envelope, keyring } = await createKeyring(USER, phrase, "original-passphrase-1");
  const encrypted = await encryptItem(
    keyring,
    draftToItem({ name: "X", username: "y", password: "z" }),
  );

  const impostor = await unlockWithRecoveryPhrase(USER, envelope, createRecoveryPhrase());
  await assert.rejects(() => decryptItem(impostor, encrypted));
});

await test("rewrapping keeps existing entries readable", async () => {
  const phrase = createRecoveryPhrase();
  const { envelope, keyring } = await createKeyring(USER, phrase, "old-passphrase-11");
  const encrypted = await encryptItem(
    keyring,
    draftToItem({ name: "Figma", username: "designer", password: "keep-me-readable" }),
  );

  const rewrapped = await rewrapWithNewPassphrase(USER, envelope, phrase, "new-passphrase-11");

  const viaNew = await unlockWithPassphrase(USER, rewrapped, "new-passphrase-11");
  assert.equal((await decryptItem(viaNew, encrypted)).password, "keep-me-readable");

  await assert.rejects(() => unlockWithPassphrase(USER, rewrapped, "old-passphrase-11"));
});

await test("the envelope leaks no plaintext", async () => {
  const phrase = createRecoveryPhrase();
  const { envelope } = await createKeyring(USER, phrase, "leak-check-passphrase");
  const serialised = JSON.stringify(envelope);

  for (const word of phrase.split(" ")) {
    assert.ok(!serialised.includes(word), `phrase word "${word}" appeared in the envelope`);
  }
  assert.ok(!serialised.includes("leak-check-passphrase"));
});

// ------------------------------------------------------------------- records

await test("encrypted records expose no field values", async () => {
  const phrase = createRecoveryPhrase();
  const { keyring } = await createKeyring(USER, phrase, "record-passphrase-1");

  const item = draftToItem({
    name: "Distinctive Name",
    username: "distinctive-user@example.com",
    password: "distinctive-password",
    url: "distinctive.example",
    notes: "distinctive note text",
  });

  const serialised = JSON.stringify(await encryptItem(keyring, item));
  for (const secret of [
    "Distinctive Name",
    "distinctive-user@example.com",
    "distinctive-password",
    "distinctive.example",
    "distinctive note text",
  ]) {
    assert.ok(!serialised.includes(secret), `"${secret}" leaked into the ciphertext record`);
  }
});

await test("a record cannot be moved to another id", async () => {
  const phrase = createRecoveryPhrase();
  const { keyring } = await createKeyring(USER, phrase, "move-passphrase-1");

  const a = draftToItem({ name: "A", username: "a", password: "pw-a" });
  const b = draftToItem({ name: "B", username: "b", password: "pw-b" });
  const encryptedA = await encryptItem(keyring, a);

  // Relabel A's ciphertext with B's id — the AAD must make this fail.
  await assert.rejects(() => decryptItem(keyring, { ...encryptedA, id: b.id }));
});

await test("decryptAll isolates a corrupted record", async () => {
  const phrase = createRecoveryPhrase();
  const { keyring } = await createKeyring(USER, phrase, "partial-passphrase-1");

  const good = await encryptItem(
    keyring,
    draftToItem({ name: "Good", username: "g", password: "good-pw" }),
  );
  const other = await encryptItem(
    keyring,
    draftToItem({ name: "Also good", username: "g2", password: "good-pw-2" }),
  );

  const damagedBytes = fromBase64Url(good.payload.ct);
  damagedBytes[2] = damagedBytes[2]! ^ 0xff;
  const damaged = { ...good, payload: { ...good.payload, ct: toBase64Url(damagedBytes) } };

  const { items, failed } = await decryptAll(keyring, [damaged, other]);
  assert.equal(items.length, 1, "the intact record must still decrypt");
  assert.equal(items[0]!.name, "Also good");
  assert.deepEqual(failed, [damaged.id]);
});

// ----------------------------------------------------------------- generator

await test("generated passwords honour length and character classes", () => {
  for (const length of [8, 20, 64, 128]) {
    const password = generatePassword({ ...DEFAULT_GENERATOR_OPTIONS, length });
    assert.equal(password.length, length);
    assert.match(password, /[a-z]/);
    assert.match(password, /[A-Z]/);
    assert.match(password, /[0-9]/);
    assert.match(password, /[^A-Za-z0-9]/);
  }
});

await test("generated passwords are unique across many draws", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const password = generatePassword(DEFAULT_GENERATOR_OPTIONS);
    assert.ok(!seen.has(password), "repeat password generated");
    seen.add(password);
  }
});

await test("the guaranteed characters are not stuck at the front", () => {
  // Without the shuffle, position 0 would always be lowercase.
  const firstCharClasses = new Set<string>();
  for (let i = 0; i < 400; i++) {
    const first = generatePassword({ ...DEFAULT_GENERATOR_OPTIONS, length: 12 })[0]!;
    if (/[a-z]/.test(first)) firstCharClasses.add("lower");
    else if (/[A-Z]/.test(first)) firstCharClasses.add("upper");
    else if (/[0-9]/.test(first)) firstCharClasses.add("digit");
    else firstCharClasses.add("symbol");
  }
  assert.equal(firstCharClasses.size, 4, "first character should vary across all classes");
});

await test("ambiguous characters are excluded on request", () => {
  for (let i = 0; i < 200; i++) {
    const password = generatePassword({
      ...DEFAULT_GENERATOR_OPTIONS,
      length: 40,
      excludeAmbiguous: true,
    });
    assert.doesNotMatch(password, /[Il1O0o|`'"{}[\]()/\\~,;:.<>]/);
  }
});

await test("an empty alphabet is refused", () => {
  assert.throws(() =>
    generatePassword({
      length: 16,
      lowercase: false,
      uppercase: false,
      digits: false,
      symbols: false,
      excludeAmbiguous: false,
    }),
  );
});

await test("generator entropy matches the alphabet", () => {
  const bits = generatorEntropyBits({ ...DEFAULT_GENERATOR_OPTIONS, length: 20 });
  // 26+26+10+25 = 87 characters -> ~6.44 bits each.
  assert.ok(bits > 125 && bits < 133, `unexpected entropy: ${bits}`);
});

await test("strength estimates rank passwords sensibly", () => {
  const weak = estimateStrength("password123");
  const medium = estimateStrength("Tr0ub4dor&3");
  const strong = estimateStrength(generatePassword({ ...DEFAULT_GENERATOR_OPTIONS, length: 24 }));

  assert.ok(weak.score < medium.score, "breach-list password must rank below a random one");
  assert.ok(medium.score < strong.score, "24-char generated password must rank highest");
  assert.equal(estimateStrength("").score, 0);
  assert.ok(weak.warnings.length > 0);
});

await test("repeated characters do not inflate the score", () => {
  const repeated = estimateStrength("aaaaaaaaaaaaaaaaaaaaaaaa");
  assert.ok(repeated.bits < 40, `24 identical chars scored ${repeated.bits} bits`);
});

console.log(results.join("\n"));
console.log(
  process.exitCode ? "\nSOME TESTS FAILED" : `\nAll ${results.length} crypto checks passed.`,
);
