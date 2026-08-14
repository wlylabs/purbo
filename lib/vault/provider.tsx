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
  registerPasskey,
  unlockWithPasskey,
} from "@/lib/auth/passkey";
import { wipe } from "@/lib/crypto/primitives";
import {
  clearActiveAccount,
  clearLocalVault,
  readActiveAccount,
  readLocalVault,
  writeActiveAccount,
  writeLocalVault,
} from "@/lib/storage/local";
import {
  RemoteUnavailableError,
  RevisionConflictError,
  deleteRemoteVault,
  fetchRemoteVault,
  pushRemoteVault,
} from "@/lib/storage/remote";
import {
  IncorrectPassphraseError,
  createKeyring,
  exportRootMaterial,
  keyringFromRootMaterial,
  rewrapWithNewPassphrase,
  unlockWithPassphrase,
  unlockWithRecoveryPhrase,
  type Keyring,
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

  saveItem(draft: VaultItemDraft, id?: string): Promise<void>;
  removeItem(id: string): Promise<void>;
  destroyVault(): Promise<void>;

  autoLockMinutes: number;
  setAutoLockMinutes(minutes: number): void;
  clearError(): void;
}

const VaultContext = createContext<VaultContextValue | null>(null);

export type { VaultContextValue };

const AUTO_LOCK_STORAGE_KEY = "purbo:auto-lock-minutes";
const DEFAULT_AUTO_LOCK_MINUTES = 10;

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

  // Key material and ciphertext live in refs, never in state: state is
  // serialised into the React tree and can end up in devtools snapshots.
  const keyringRef = useRef<Keyring | null>(null);
  const envelopeRef = useRef<KeyEnvelope | null>(null);
  const encryptedRef = useRef<EncryptedItem[]>([]);
  const revisionRef = useRef(0);

  useEffect(() => {
    const stored = window.localStorage.getItem(AUTO_LOCK_STORAGE_KEY);
    const parsed = stored ? Number(stored) : NaN;
    if (Number.isFinite(parsed) && parsed >= 0) setAutoLockMinutesState(parsed);
  }, []);

  const setAutoLockMinutes = useCallback((minutes: number) => {
    setAutoLockMinutesState(minutes);
    window.localStorage.setItem(AUTO_LOCK_STORAGE_KEY, String(minutes));
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
    setItems([]);
    setCorrupted([]);
    setStatus(envelopeRef.current ? "locked" : "absent");
  }, []);

  /** Drops every trace of the session from memory. */
  const reset = useCallback(() => {
    keyringRef.current = null;
    clearAuthIdentity();
    envelopeRef.current = null;
    encryptedRef.current = [];
    revisionRef.current = 0;
    setItems([]);
    setCorrupted([]);
    setLastSyncedAt(null);
    setError(null);
  }, []);

  /**
   * What this browser knows before anyone has proved anything.
   *
   * There is no session to restore on load: with identity derived from the
   * recovery phrase, the server cannot tell us who we are — only the user
   * can, by unlocking. So startup is a purely local question: is there a
   * cached vault here, or is this a fresh start?
   */
  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      const stored = readActiveAccount();
      if (!stored) {
        if (!cancelled) setStatus("absent");
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
  }, []);

  const createVault = useCallback(
    async (recoveryPhrase: string, passphrase: string) => {
      setError(null);

      const { envelope, keyring } = await createKeyring(recoveryPhrase, passphrase);
      adoptKeyring(keyring);
      envelopeRef.current = envelope;
      encryptedRef.current = [];
      revisionRef.current = 0;
      setItems([]);
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
    const { material } = await unlockWithPasskey();

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
    } finally {
      // The root key was only needed to build the keyring; the identity's
      // secret is now owned by the session layer.
      wipe(material.rootKey);
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
      } finally {
        wipe(material.rootKey, material.authSecret);
      }
    },
    [],
  );

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
      createVault,
      restoreWithPhrase,
      unlock,
      unlockWithRegisteredPasskey,
      recoverWithPhrase,
      lock,
      forgetDevice,
      addPasskey,
      saveItem,
      removeItem,
      destroyVault,
      autoLockMinutes,
      setAutoLockMinutes,
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
      createVault,
      restoreWithPhrase,
      unlock,
      unlockWithRegisteredPasskey,
      recoverWithPhrase,
      lock,
      forgetDevice,
      addPasskey,
      saveItem,
      removeItem,
      destroyVault,
      autoLockMinutes,
      setAutoLockMinutes,
    ],
  );

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export function useVault(): VaultContextValue {
  const context = useContext(VaultContext);
  if (!context) throw new Error("useVault must be used inside <VaultProvider>.");
  return context;
}
