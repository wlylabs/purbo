"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { identityFromRecoveryPhrase } from "@/lib/auth/identity";
import { clearAuthIdentity, setAuthIdentity } from "@/lib/auth/session";
import {
  NoPasskeyRecordError,
  isPasskeyPromptOpen,
  isPasskeySupported,
  registerPasskey,
  removeAllPasskeys,
  unlockWithPasskey,
} from "@/lib/auth/passkey";
import { wipe } from "@/lib/crypto/primitives";
import {
  clearActiveAccount,
  clearLocalVault,
  clearPasskeyHint,
  readActiveAccount,
  readLocalVault,
  readPasskeyHint,
  writeActiveAccount,
  writeLocalVault,
  writePasskeyHint,
} from "@/lib/storage/local";
import {
  clearSessionKeys,
  loadSessionKeys,
  saveSessionKeys,
} from "@/lib/storage/session-keys";
import {
  RemoteUnavailableError,
  RevisionConflictError,
  deleteRemoteVault,
  fetchRemoteVault,
  pushRemoteVault,
} from "@/lib/storage/remote";
import {
  AccountMismatchError,
  IncorrectPassphraseError,
  createKeyring,
  exportRootMaterial,
  keyringFromRootMaterial,
  keyringFromSessionKeys,
  rewrapWithNewPassphrase,
  rewrapWithPassphrase,
  unlockWithPassphrase,
  unlockWithRecoveryPhrase,
  type Keyring,
  type RootMaterial,
} from "./keyring";
import { applyDraft, decryptAll, draftToItem, encryptItem } from "./records";
import type {
  EncryptedItem,
  EncryptedVault,
  KeyEnvelope,
  VaultItem,
  VaultItemDraft,
  VaultStatus,
} from "./types";

export type SyncState = "idle" | "syncing" | "offline" | "error";

interface VaultContextValue {
  status: VaultStatus;
  items: VaultItem[];
  error: string | null;
  syncState: SyncState;
  syncMessage: string | null;
  /** When the server last confirmed a read or write, for the header's clock. */
  lastSyncedAt: number | null;
  /** Ids of records that failed authentication and could not be decrypted. */
  corrupted: string[];
  /** The account this device is holding, once one is known. */
  accountId: string | null;
  /**
   * Whether this device has a passkey to reach for. Drives the lock screen's
   * decision to ask the authenticator on its own rather than waiting.
   */
  passkeyHint: boolean;
  /**
   * Set while a freshly created or restored vault still has an onboarding
   * step to finish. The vault is open and usable underneath; this only keeps
   * the setup flow on screen long enough to offer a passkey.
   */
  setupPending: boolean;
  completeSetup(): void;

  createVault(recoveryPhrase: string, passphrase: string): Promise<void>;
  /** First open on a device that has never held this vault. */
  restoreWithPhrase(recoveryPhrase: string, passphrase: string): Promise<void>;
  unlock(passphrase: string): Promise<void>;
  unlockWithRegisteredPasskey(): Promise<void>;
  /** Forgotten passphrase, with the encrypted vault already on this device. */
  recoverWithPhrase(recoveryPhrase: string, newPassphrase: string): Promise<void>;
  lock(): void;
  /** Drops this device's copy without touching the server's. */
  forgetDevice(): Promise<void>;

  addPasskey(passphrase: string): Promise<void>;
  /** Revokes every passkey on the account and stops offering that path here. */
  forgetPasskeys(): Promise<void>;

  /**
   * Whether a recent confirmation is still standing.
   *
   * An unlocked tab is not by itself proof that the person in front of it is
   * the owner — that was established minutes or hours ago, possibly before
   * the laptop was left in a meeting room. Reading a stored password, taking
   * a plaintext export, or deleting the vault asks again.
   */
  stepUpVerified: boolean;
  /** Re-proves ownership with the passphrase. Throws if it does not match. */
  verifyPassphrase(passphrase: string): Promise<void>;
  /** Re-proves ownership with a registered passkey. */
  verifyPasskey(): Promise<void>;

  /**
   * Rotates the passphrase without touching the root key.
   *
   * Distinct from `recoverWithPhrase`, which is for a passphrase that is
   * gone. This one proves the current passphrase instead, so rotating does
   * not mean fetching the 24 words out of wherever they are kept.
   */
  changePassphrase(currentPassphrase: string, newPassphrase: string): Promise<void>;

  saveItem(draft: VaultItemDraft, id?: string): Promise<void>;
  removeItem(id: string): Promise<void>;
  /** Pins an entry to the top of the list, without counting as an edit. */
  toggleFavourite(id: string): Promise<void>;
  /** Adds a batch of entries in one encrypt-and-push. Returns how many. */
  importItems(drafts: VaultItemDraft[]): Promise<number>;
  destroyVault(): Promise<void>;

  autoLockMinutes: number;
  setAutoLockMinutes(minutes: number): void;
  /** Lock as soon as the tab stops being the thing on screen. */
  lockOnHidden: boolean;
  setLockOnHidden(value: boolean): void;
  /** Cover the vault while the tab is not what is on screen. */
  privacyScreen: boolean;
  setPrivacyScreen(value: boolean): void;
  clearError(): void;
}

const VaultContext = createContext<VaultContextValue | null>(null);

export type { VaultContextValue };

const AUTO_LOCK_STORAGE_KEY = "purbo:auto-lock-minutes";
const DEFAULT_AUTO_LOCK_MINUTES = 10;

const LOCK_ON_HIDDEN_STORAGE_KEY = "purbo:lock-on-hidden";

const PRIVACY_SCREEN_STORAGE_KEY = "purbo:privacy-screen";

/**
 * How long a step-up confirmation lasts.
 *
 * Long enough to read a password, copy it, and go back for the username
 * without being asked twice; short enough that a tab left open on a desk does
 * not stay quotable. Re-confirming costs an Argon2id derivation or a
 * fingerprint, so this cannot be generous.
 */
const STEP_UP_WINDOW_MS = 2 * 60_000;

/** Activity that counts as "the user is still here". */
const ACTIVITY_EVENTS = ["mousedown", "keydown", "touchstart", "scroll"] as const;

export class NoVaultForPhraseError extends Error {
  constructor() {
    super("No vault is stored for that recovery phrase.");
    this.name = "NoVaultForPhraseError";
  }
}

export function VaultProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<VaultStatus>("loading");
  const [items, setItems] = useState<VaultItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [corrupted, setCorrupted] = useState<string[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [autoLockMinutes, setAutoLockMinutesState] = useState(DEFAULT_AUTO_LOCK_MINUTES);
  const [passkeyHint, setPasskeyHint] = useState(false);
  const [setupPending, setSetupPending] = useState(false);
  const [lockOnHidden, setLockOnHiddenState] = useState(false);
  // On unless turned off: unlike locking on the same signal, a cover costs
  // the user nothing to be wrong about — coming back lifts it.
  const [privacyScreen, setPrivacyScreenState] = useState(true);
  const [verifiedAt, setVerifiedAt] = useState<number | null>(null);

  // Key material and ciphertext live in refs, never in state: state is
  // serialised into the React tree and can end up in devtools snapshots.
  const keyringRef = useRef<Keyring | null>(null);
  const envelopeRef = useRef<KeyEnvelope | null>(null);
  const encryptedRef = useRef<EncryptedItem[]>([]);
  const revisionRef = useRef(0);
  /**
   * The in-flight write of this tab's session cache.
   *
   * Caching happens in the background so unlocking is not held up by it, which
   * leaves one ordering that matters: locking immediately after unlocking must
   * not delete the record before the write lands and then leave it behind.
   * Locking chains onto this instead of racing it.
   */
  const sessionWriteRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const stored = window.localStorage.getItem(AUTO_LOCK_STORAGE_KEY);
    const parsed = stored ? Number(stored) : NaN;
    if (Number.isFinite(parsed) && parsed >= 0) setAutoLockMinutesState(parsed);
    setLockOnHiddenState(window.localStorage.getItem(LOCK_ON_HIDDEN_STORAGE_KEY) === "1");
    setPrivacyScreenState(window.localStorage.getItem(PRIVACY_SCREEN_STORAGE_KEY) !== "0");
  }, []);

  const setAutoLockMinutes = useCallback((minutes: number) => {
    setAutoLockMinutesState(minutes);
    window.localStorage.setItem(AUTO_LOCK_STORAGE_KEY, String(minutes));
  }, []);

  const setLockOnHidden = useCallback((value: boolean) => {
    setLockOnHiddenState(value);
    window.localStorage.setItem(LOCK_ON_HIDDEN_STORAGE_KEY, value ? "1" : "0");
  }, []);

  const setPrivacyScreen = useCallback((value: boolean) => {
    setPrivacyScreenState(value);
    window.localStorage.setItem(PRIVACY_SCREEN_STORAGE_KEY, value ? "1" : "0");
  }, []);

  /** Records a confirmed round-trip to the server. */
  const markSynced = useCallback(() => {
    setSyncState("idle");
    setSyncMessage(null);
    setLastSyncedAt(Date.now());
  }, []);

  /**
   * Locking drops the identity along with the keys.
   *
   * The signing secret is the same secret that decrypts, so leaving it live
   * behind a lock screen would mean a locked tab could still read and write
   * the vault on the server. Re-authenticating costs one round-trip on the
   * next unlock, which nobody notices.
   */
  const lock = useCallback(() => {
    keyringRef.current = null;
    clearAuthIdentity();
    // The cached copy goes with it, or auto-lock would be theatre: a locked
    // tab whose keys are still sitting in storage is not locked.
    sessionWriteRef.current = sessionWriteRef.current
      .catch(() => undefined)
      .then(clearSessionKeys);
    setItems([]);
    setCorrupted([]);
    setSetupPending(false);
    setVerifiedAt(null);
    setStatus(envelopeRef.current ? "locked" : "absent");
  }, []);

  /** Drops every trace of the session from memory. */
  const reset = useCallback(() => {
    keyringRef.current = null;
    clearAuthIdentity();
    sessionWriteRef.current = sessionWriteRef.current
      .catch(() => undefined)
      .then(clearSessionKeys);
    envelopeRef.current = null;
    encryptedRef.current = [];
    revisionRef.current = 0;
    setItems([]);
    setCorrupted([]);
    setLastSyncedAt(null);
    setSetupPending(false);
    setVerifiedAt(null);
    setError(null);
  }, []);

  const decryptInto = useCallback(async (keyring: Keyring) => {
    const { items: decrypted, failed } = await decryptAll(keyring, encryptedRef.current);
    decrypted.sort((a, b) => b.updatedAt - a.updatedAt);
    setItems(decrypted);
    setCorrupted(failed);
  }, []);

  /** Encrypts current state and persists it locally, then remotely. */
  const persist = useCallback(
    async (nextEncrypted: EncryptedItem[]) => {
      const keyring = keyringRef.current;
      const envelope = envelopeRef.current;
      if (!keyring || !envelope) return;

      const revision = revisionRef.current + 1;
      const vault: EncryptedVault = {
        envelope,
        items: nextEncrypted,
        revision,
        updatedAt: Date.now(),
      };

      encryptedRef.current = nextEncrypted;
      revisionRef.current = revision;

      // Local first: an offline save must still survive a reload.
      await writeLocalVault(keyring.accountId, vault);

      setSyncState("syncing");
      try {
        await pushRemoteVault({ envelope, items: nextEncrypted, revision });
        markSynced();
      } catch (err) {
        if (err instanceof RevisionConflictError) {
          // Another device wrote while we were editing. Re-base onto the
          // server's revision and retry once, rather than clobbering it.
          revisionRef.current = err.currentRevision;
          try {
            await pushRemoteVault({
              envelope,
              items: nextEncrypted,
              revision: err.currentRevision + 1,
            });
            revisionRef.current = err.currentRevision + 1;
            markSynced();
            return;
          } catch {
            setSyncState("error");
            setSyncMessage("Another device changed this vault. Reload to merge.");
            return;
          }
        }
        setSyncState("offline");
        setSyncMessage(
          err instanceof RemoteUnavailableError
            ? err.message
            : "Saved on this device — sync will retry.",
        );
      }
    },
    [markSynced],
  );

  /**
   * Reconciles with the server once the vault is open.
   *
   * This can only run after unlocking, because authenticating *is* unlocking:
   * the key that signs the login challenge comes out of the same envelope as
   * the key that decrypts. The higher revision wins, so a device that was
   * offline while another one wrote does not resurrect stale data.
   */
  const syncAfterUnlock = useCallback(
    async (keyring: Keyring) => {
      setSyncState("syncing");
      try {
        const remote = await fetchRemoteVault();

        if (remote && remote.revision > revisionRef.current) {
          envelopeRef.current = remote.envelope;
          encryptedRef.current = remote.items;
          revisionRef.current = remote.revision;
          await writeLocalVault(keyring.accountId, remote);
          await decryptInto(keyring);
          markSynced();
          return;
        }

        if (!remote || remote.revision < revisionRef.current) {
          // This device is ahead — an offline edit, or a vault that has never
          // reached the server. Push rather than silently diverge.
          const envelope = envelopeRef.current;
          if (envelope) {
            await pushRemoteVault({
              envelope,
              items: encryptedRef.current,
              revision: revisionRef.current + 1,
            });
            revisionRef.current += 1;
          }
        }
        markSynced();
      } catch (err) {
        setSyncState("offline");
        setSyncMessage(
          err instanceof RemoteUnavailableError
            ? err.message
            : "Working offline — changes are saved on this device.",
        );
      }
    },
    [decryptInto, markSynced],
  );

  /** Everything that has to happen the moment a keyring exists. */
  const adoptKeyring = useCallback((keyring: Keyring) => {
    keyringRef.current = keyring;
    setAuthIdentity(keyring.identity);
    setAccountId(keyring.accountId);
    writeActiveAccount(keyring.accountId);

    // Hand the tab what it needs to come back from a reload without a second
    // of Argon2id. A copy of the secret, because the identity's own buffer is
    // wiped the moment the vault locks and this write is asynchronous.
    const authSecret = Uint8Array.from(keyring.identity.secret);
    sessionWriteRef.current = sessionWriteRef.current
      .catch(() => undefined)
      .then(() =>
        saveSessionKeys({
          accountId: keyring.accountId,
          dataKey: keyring.dataKey,
          authSecret,
        }).finally(() => wipe(authSecret)),
      );
  }, []);

  /**
   * What this browser knows before anyone has proved anything.
   *
   * Three questions, in order. Is this tab resuming — a reload, a followed
   * link, a return from the OS — in which case its keys are still cached and
   * there is nothing to ask for. Failing that, is there an encrypted vault on
   * this device to unlock. Failing that, this is a fresh start.
   *
   * None of them involve the server. With identity derived from the recovery
   * phrase there is no session for it to restore: it cannot tell us who we
   * are, only the user can, by unlocking.
   */
  useEffect(() => {
    let cancelled = false;

    const resume = async (): Promise<boolean> => {
      const cached = await loadSessionKeys();
      if (!cached) return false;

      try {
        if (cancelled) return false;

        const local = await readLocalVault(cached.accountId);
        if (cancelled) return false;
        if (!local) {
          // Keys for a vault this device no longer holds — a sign-out in
          // another tab, or an evicted cache. They open nothing.
          await clearSessionKeys();
          return false;
        }

        const keyring = await keyringFromSessionKeys(
          cached.accountId,
          cached.dataKey,
          cached.authSecret,
        );
        if (cancelled) return false;

        adoptKeyring(keyring);
        envelopeRef.current = local.envelope;
        encryptedRef.current = local.items;
        revisionRef.current = local.revision;
        await decryptInto(keyring);
        setStatus("unlocked");
        void syncAfterUnlock(keyring);
        return true;
      } catch {
        // Half-adopted is worse than not adopted: leave nothing behind for
        // the lock screen to inherit.
        keyringRef.current = null;
        clearAuthIdentity();
        await clearSessionKeys();
        return false;
      } finally {
        // The keyring holds its own copy; this one has served its purpose.
        wipe(cached.authSecret);
      }
    };

    const boot = async () => {
      setPasskeyHint(readPasskeyHint());

      if (await resume()) return;
      if (cancelled) return;

      const stored = readActiveAccount();
      if (!stored) {
        setStatus("absent");
        return;
      }

      const local = await readLocalVault(stored);
      if (cancelled) return;

      if (!local) {
        // The pointer outlived the cache — a cleared site storage, or a
        // partial eviction. Nothing here can be unlocked, so this device is
        // back to needing the recovery phrase.
        clearActiveAccount();
        setStatus("absent");
        return;
      }

      envelopeRef.current = local.envelope;
      encryptedRef.current = local.items;
      revisionRef.current = local.revision;
      setAccountId(stored);
      setStatus("locked");
    };

    void boot();
    return () => {
      cancelled = true;
    };
  }, [adoptKeyring, decryptInto, syncAfterUnlock]);

  const createVault = useCallback(
    async (recoveryPhrase: string, passphrase: string) => {
      setError(null);

      const { envelope, keyring } = await createKeyring(recoveryPhrase, passphrase);
      adoptKeyring(keyring);
      envelopeRef.current = envelope;
      encryptedRef.current = [];
      revisionRef.current = 0;
      setItems([]);
      // Offered here rather than left to Settings: registering costs the
      // passphrase, and this is the one moment the user has just typed it.
      setSetupPending(isPasskeySupported() && !readPasskeyHint());
      setStatus("unlocked");

      await persist([]);
    },
    [adoptKeyring, persist],
  );

  /**
   * First open on a new device.
   *
   * The phrase does double duty here: it derives the identity that fetches
   * the encrypted vault, then unwraps it. Setting a passphrase at the same
   * time is not an extra step so much as the point — it is what makes the
   * next unlock on this device fast.
   */
  const restoreWithPhrase = useCallback(
    async (recoveryPhrase: string, passphrase: string) => {
      setError(null);

      setAuthIdentity(await identityFromRecoveryPhrase(recoveryPhrase));

      const remote = await fetchRemoteVault();
      if (!remote) {
        clearAuthIdentity();
        throw new NoVaultForPhraseError();
      }

      const keyring = await unlockWithRecoveryPhrase(remote.envelope, recoveryPhrase);
      const envelope = await rewrapWithNewPassphrase(
        remote.envelope,
        recoveryPhrase,
        passphrase,
      );

      adoptKeyring(keyring);
      envelopeRef.current = envelope;
      encryptedRef.current = remote.items;
      revisionRef.current = remote.revision;
      await decryptInto(keyring);
      setSetupPending(isPasskeySupported() && !readPasskeyHint());
      setStatus("unlocked");

      await persist(remote.items);
    },
    [adoptKeyring, decryptInto, persist],
  );

  const unlock = useCallback(
    async (passphrase: string) => {
      const envelope = envelopeRef.current;
      const stored = accountId ?? readActiveAccount();
      if (!envelope || !stored) throw new Error("No vault to unlock.");

      setError(null);
      try {
        const keyring = await unlockWithPassphrase(stored, envelope, passphrase);
        adoptKeyring(keyring);
        await decryptInto(keyring);
        setStatus("unlocked");
        void syncAfterUnlock(keyring);
      } catch (err) {
        if (err instanceof IncorrectPassphraseError) {
          setError(err.message);
        } else {
          setError("Unlock failed. Check your passphrase and try again.");
        }
        throw err;
      }
    },
    [accountId, adoptKeyring, decryptInto, syncAfterUnlock],
  );

  /**
   * Opens the vault with a passkey.
   *
   * This works on a device that holds nothing at all: the authenticator's PRF
   * secret unwraps a stored copy of the root key, which yields both the data
   * key and the identity needed to fetch the vault.
   */
  const unlockWithRegisteredPasskey = useCallback(async () => {
    setError(null);

    let material: RootMaterial;
    try {
      ({ material } = await unlockWithPasskey());
    } catch (err) {
      if (err instanceof NoPasskeyRecordError) {
        // The hint was stale — a passkey deleted from the OS keychain, or a
        // vault removed from the server. Stop reaching for it on every visit.
        clearPasskeyHint();
        setPasskeyHint(false);
      }
      throw err;
    }

    try {
      const keyring = await keyringFromRootMaterial(material);
      adoptKeyring(keyring);

      const remote = await fetchRemoteVault();
      const local = await readLocalVault(keyring.accountId);
      const chosen =
        remote && local
          ? remote.revision >= local.revision
            ? remote
            : local
          : (remote ?? local);

      if (!chosen) {
        clearAuthIdentity();
        keyringRef.current = null;
        throw new Error(
          "That passkey opens an account with no vault left on the server.",
        );
      }

      envelopeRef.current = chosen.envelope;
      encryptedRef.current = chosen.items;
      revisionRef.current = chosen.revision;
      if (chosen === remote) await writeLocalVault(keyring.accountId, chosen);

      await decryptInto(keyring);
      setStatus("unlocked");
      markSynced();

      // Confirmed working, so the next visit can reach for it unprompted.
      writePasskeyHint();
      setPasskeyHint(true);
    } finally {
      // Both were only needed to build the keyring, which holds its own copy
      // of the identity. Nothing downstream reads this material again.
      wipe(material.rootKey, material.authSecret);
    }
  }, [adoptKeyring, decryptInto, markSynced]);

  /**
   * Recovery path: prove ownership with the phrase, then set a new
   * passphrase. The root key is unchanged, so existing entries stay readable.
   */
  const recoverWithPhrase = useCallback(
    async (recoveryPhrase: string, newPassphrase: string) => {
      const envelope = envelopeRef.current;
      if (!envelope) throw new Error("No vault to recover.");

      setError(null);
      const keyring = await unlockWithRecoveryPhrase(envelope, recoveryPhrase);
      const nextEnvelope = await rewrapWithNewPassphrase(
        envelope,
        recoveryPhrase,
        newPassphrase,
      );

      adoptKeyring(keyring);
      envelopeRef.current = nextEnvelope;
      await decryptInto(keyring);
      setStatus("unlocked");
      await persist(encryptedRef.current);
    },
    [adoptKeyring, decryptInto, persist],
  );

  /**
   * Registers a passkey against this vault.
   *
   * The passphrase is asked for again rather than reusing the open session:
   * adding a way into the vault deserves to be an explicit re-authorisation,
   * and it keeps the root key out of memory for everything except this call.
   */
  const addPasskey = useCallback(
    async (passphrase: string) => {
      const envelope = envelopeRef.current;
      const keyring = keyringRef.current;
      if (!envelope || !keyring) throw new Error("Unlock the vault first.");

      const material = await exportRootMaterial(keyring.accountId, envelope, passphrase);
      try {
        await registerPasskey(keyring.accountId, material);
        writePasskeyHint();
        setPasskeyHint(true);
      } finally {
        wipe(material.rootKey, material.authSecret);
      }
    },
    [],
  );

  /**
   * Revokes every passkey on the account.
   *
   * The hint goes with them. Leaving it set would have the lock screen open a
   * biometric prompt on the next visit for credentials the server no longer
   * has a sealed record for.
   */
  const forgetPasskeys = useCallback(async () => {
    await removeAllPasskeys();
    clearPasskeyHint();
    setPasskeyHint(false);
  }, []);

  /** Leaves the setup flow and hands the user their vault. */
  const completeSetup = useCallback(() => setSetupPending(false), []);

  /**
   * Step-up, by the passphrase.
   *
   * The check is a real unwrap rather than a comparison against something
   * remembered from the last unlock: nothing about "the right passphrase" is
   * kept in memory to compare against, and paying for the Argon2id derivation
   * is what makes this a proof rather than a formality. The keyring it
   * produces is discarded — the live one is already open and unaffected.
   */
  const verifyPassphrase = useCallback(async (passphrase: string) => {
    const envelope = envelopeRef.current;
    const current = keyringRef.current;
    if (!envelope || !current) throw new Error("The vault is locked.");

    const proof = await unlockWithPassphrase(current.accountId, envelope, passphrase);
    wipe(proof.identity.secret);
    setVerifiedAt(Date.now());
  }, []);

  /** Step-up, by an authenticator this account has registered. */
  const verifyPasskey = useCallback(async () => {
    const current = keyringRef.current;
    if (!current) throw new Error("The vault is locked.");

    const { accountId: confirmed, material } = await unlockWithPasskey();
    try {
      // A passkey belonging to some other vault proves nothing about this one.
      if (confirmed !== current.accountId) throw new AccountMismatchError();
      setVerifiedAt(Date.now());
    } finally {
      wipe(material.rootKey, material.authSecret);
    }
  }, []);

  /**
   * A confirmation expires on its own, without anything having to happen.
   *
   * Tying it to the next interaction would mean a tab nobody touched keeps
   * its window open indefinitely, which is exactly the tab this protects
   * against.
   */
  useEffect(() => {
    if (verifiedAt === null) return;
    const remaining = verifiedAt + STEP_UP_WINDOW_MS - Date.now();
    if (remaining <= 0) {
      setVerifiedAt(null);
      return;
    }
    const timer = window.setTimeout(() => setVerifiedAt(null), remaining);
    return () => window.clearTimeout(timer);
  }, [verifiedAt]);

  const saveItem = useCallback(
    async (draft: VaultItemDraft, id?: string) => {
      const keyring = keyringRef.current;
      if (!keyring) throw new Error("Vault is locked.");

      const existing = id ? items.find((item) => item.id === id) : undefined;
      const item = existing ? applyDraft(existing, draft) : draftToItem(draft);
      const encrypted = await encryptItem(keyring, item);

      const nextItems = existing
        ? items.map((current) => (current.id === item.id ? item : current))
        : [item, ...items];
      nextItems.sort((a, b) => b.updatedAt - a.updatedAt);
      setItems(nextItems);

      const nextEncrypted = existing
        ? encryptedRef.current.map((current) =>
            current.id === encrypted.id ? encrypted : current,
          )
        : [encrypted, ...encryptedRef.current];

      await persist(nextEncrypted);
    },
    [items, persist],
  );

  const removeItem = useCallback(
    async (id: string) => {
      if (!keyringRef.current) throw new Error("Vault is locked.");
      setItems((current) => current.filter((item) => item.id !== id));
      await persist(encryptedRef.current.filter((item) => item.id !== id));
    },
    [persist],
  );

  /**
   * Favouriting is not editing.
   *
   * `updatedAt` is deliberately left alone: it answers "when did this
   * credential last change", and a star that reset it would make every
   * ageing check and every "updated just now" line a lie about the password.
   */
  const toggleFavourite = useCallback(
    async (id: string) => {
      const keyring = keyringRef.current;
      if (!keyring) throw new Error("Vault is locked.");

      const existing = items.find((item) => item.id === id);
      if (!existing) return;

      const next: VaultItem = { ...existing, favourite: !existing.favourite };
      const encrypted = await encryptItem(keyring, next);

      setItems(items.map((item) => (item.id === id ? next : item)));
      await persist(
        encryptedRef.current.map((record) => (record.id === id ? encrypted : record)),
      );
    },
    [items, persist],
  );

  /**
   * A whole import as one write.
   *
   * Saving entries one at a time would mean one Argon2id-free but still
   * round-tripping push per row — a thousand-row export would spend minutes
   * of network on a vault that is one blob. Everything is encrypted first,
   * then persisted once.
   */
  const importItems = useCallback(
    async (drafts: VaultItemDraft[]) => {
      const keyring = keyringRef.current;
      if (!keyring) throw new Error("Vault is locked.");
      if (drafts.length === 0) return 0;

      const created = drafts.map(draftToItem);
      const encrypted = await Promise.all(
        created.map((item) => encryptItem(keyring, item)),
      );

      const nextItems = [...created, ...items];
      nextItems.sort((a, b) => b.updatedAt - a.updatedAt);
      setItems(nextItems);

      await persist([...encrypted, ...encryptedRef.current]);
      return created.length;
    },
    [items, persist],
  );

  /**
   * Rotating the passphrase, with the old one as the proof.
   *
   * Only the envelope changes, so this costs one write rather than a
   * re-encryption of the vault — and every passkey keeps working, because
   * what they seal is the root key, which is untouched.
   */
  const changePassphrase = useCallback(
    async (currentPassphrase: string, newPassphrase: string) => {
      const envelope = envelopeRef.current;
      const keyring = keyringRef.current;
      if (!envelope || !keyring) throw new Error("The vault is locked.");

      const next = await rewrapWithPassphrase(
        keyring.accountId,
        envelope,
        currentPassphrase,
        newPassphrase,
      );

      envelopeRef.current = next;
      // The entries are unchanged, but the envelope only reaches storage
      // through a write, and until it does the old passphrase is still the
      // one this device would unlock with after a reload.
      await persist(encryptedRef.current);
    },
    [persist],
  );

  const destroyVault = useCallback(async () => {
    const current = keyringRef.current?.accountId ?? accountId;
    if (!current) return;
    try {
      await deleteRemoteVault();
    } catch {
      // Local wipe proceeds regardless — the user asked for this device to
      // forget the vault, and a network failure must not block that.
    }
    await clearLocalVault(current);
    clearActiveAccount();
    clearPasskeyHint();
    setPasskeyHint(false);
    reset();
    setAccountId(null);
    setStatus("absent");
  }, [accountId, reset]);

  /**
   * Removes this device's copy, leaving the server's untouched.
   *
   * The honest name for "sign out" in a system with no sessions to end: there
   * is nothing to revoke, so what this actually does is delete the cached
   * ciphertext and forget which account it belonged to. Coming back needs the
   * recovery phrase or a passkey.
   */
  const forgetDevice = useCallback(async () => {
    const current = keyringRef.current?.accountId ?? accountId;
    if (current) await clearLocalVault(current);
    clearActiveAccount();
    clearPasskeyHint();
    setPasskeyHint(false);
    reset();
    setAccountId(null);
    setStatus("absent");
  }, [accountId, reset]);

  // ---- Auto-lock -------------------------------------------------------
  // A vault left open on an unattended screen is the most realistic way this
  // app leaks. The timer resets on genuine interaction only.
  useEffect(() => {
    if (status !== "unlocked" || autoLockMinutes <= 0) return;

    let timer: number;
    const reschedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(lock, autoLockMinutes * 60_000);
    };

    reschedule();
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, reschedule, { passive: true });
    }

    return () => {
      window.clearTimeout(timer);
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, reschedule);
      }
    };
  }, [status, autoLockMinutes, lock]);

  /**
   * Lock the moment this tab stops being what is on screen.
   *
   * Off by default, because it is genuinely disruptive: on a phone, glancing
   * at the message that just arrived would lock the vault. For a shared or
   * public machine it is the setting that matters most, so it is offered
   * rather than assumed.
   */
  useEffect(() => {
    if (!lockOnHidden || status !== "unlocked") return;

    const onVisibilityChange = () => {
      // An authenticator's sheet can hide the page. Locking then would cancel
      // the very gesture the user is in the middle of making.
      if (document.visibilityState === "hidden" && !isPasskeyPromptOpen()) lock();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [lockOnHidden, status, lock]);

  const value = useMemo<VaultContextValue>(
    () => ({
      status,
      items,
      error,
      syncState,
      syncMessage,
      lastSyncedAt,
      corrupted,
      accountId,
      passkeyHint,
      setupPending,
      completeSetup,
      createVault,
      restoreWithPhrase,
      unlock,
      unlockWithRegisteredPasskey,
      recoverWithPhrase,
      lock,
      forgetDevice,
      addPasskey,
      forgetPasskeys,
      stepUpVerified: verifiedAt !== null,
      verifyPassphrase,
      verifyPasskey,
      changePassphrase,
      saveItem,
      removeItem,
      toggleFavourite,
      importItems,
      destroyVault,
      autoLockMinutes,
      setAutoLockMinutes,
      lockOnHidden,
      setLockOnHidden,
      privacyScreen,
      setPrivacyScreen,
      clearError: () => setError(null),
    }),
    [
      status,
      items,
      error,
      syncState,
      syncMessage,
      lastSyncedAt,
      corrupted,
      accountId,
      passkeyHint,
      setupPending,
      completeSetup,
      createVault,
      restoreWithPhrase,
      unlock,
      unlockWithRegisteredPasskey,
      recoverWithPhrase,
      lock,
      forgetDevice,
      addPasskey,
      forgetPasskeys,
      verifiedAt,
      verifyPassphrase,
      verifyPasskey,
      changePassphrase,
      saveItem,
      removeItem,
      toggleFavourite,
      importItems,
      destroyVault,
      autoLockMinutes,
      setAutoLockMinutes,
      lockOnHidden,
      setLockOnHidden,
      privacyScreen,
      setPrivacyScreen,
    ],
  );

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export function useVault(): VaultContextValue {
  const context = useContext(VaultContext);
  if (!context) throw new Error("useVault must be used inside <VaultProvider>.");
  return context;
}
