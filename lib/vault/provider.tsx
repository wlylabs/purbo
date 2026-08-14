"use client";

import { usePrivy } from "@privy-io/react-auth";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { clearLocalVault, readLocalVault, writeLocalVault } from "@/lib/storage/local";
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

  createVault(recoveryPhrase: string, passphrase: string): Promise<void>;
  unlock(passphrase: string): Promise<void>;
  recoverWithPhrase(recoveryPhrase: string, newPassphrase: string): Promise<void>;
  lock(): void;

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

export function VaultProvider({ children }: { children: React.ReactNode }) {
  const { authenticated, user, ready } = usePrivy();

  const [status, setStatus] = useState<VaultStatus>("loading");
  const [items, setItems] = useState<VaultItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [corrupted, setCorrupted] = useState<string[]>([]);
  const [autoLockMinutes, setAutoLockMinutesState] = useState(DEFAULT_AUTO_LOCK_MINUTES);

  // Key material and ciphertext live in refs, never in state: state is
  // serialised into the React tree and can end up in devtools snapshots.
  const keyringRef = useRef<Keyring | null>(null);
  const envelopeRef = useRef<KeyEnvelope | null>(null);
  const encryptedRef = useRef<EncryptedItem[]>([]);
  const revisionRef = useRef(0);

  const userId = authenticated && user ? user.id : null;

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

  const lock = useCallback(() => {
    keyringRef.current = null;
    setItems([]);
    setCorrupted([]);
    setStatus(envelopeRef.current ? "locked" : "absent");
  }, []);

  /** Drops every trace of the session, e.g. on logout. */
  const reset = useCallback(() => {
    keyringRef.current = null;
    envelopeRef.current = null;
    encryptedRef.current = [];
    revisionRef.current = 0;
    setItems([]);
    setCorrupted([]);
    setLastSyncedAt(null);
    setError(null);
    setStatus("loading");
  }, []);

  /**
   * Loads the encrypted vault for the signed-in user.
   *
   * Remote is authoritative when reachable; the local copy is a cache that
   * keeps the vault openable offline. The higher revision wins, so a device
   * that was offline while another one wrote does not resurrect stale data.
   */
  const loadVault = useCallback(async (id: string) => {
    setStatus("loading");
    setSyncState("syncing");

    const local = await readLocalVault(id);
    let remote: EncryptedVault | null = null;

    try {
      remote = await fetchRemoteVault();
      markSynced();
    } catch (err) {
      setSyncState("offline");
      setSyncMessage(
        err instanceof RemoteUnavailableError
          ? err.message
          : "Working offline — changes are saved on this device.",
      );
    }

    const chosen =
      remote && local ? (remote.revision >= local.revision ? remote : local) : (remote ?? local);

    if (!chosen) {
      envelopeRef.current = null;
      encryptedRef.current = [];
      revisionRef.current = 0;
      setStatus("absent");
      return;
    }

    envelopeRef.current = chosen.envelope;
    encryptedRef.current = chosen.items;
    revisionRef.current = chosen.revision;
    setStatus("locked");

    if (remote && (!local || remote.revision > local.revision)) {
      await writeLocalVault(id, remote);
    }
  }, [markSynced]);

  useEffect(() => {
    if (!ready) return;
    if (!userId) {
      reset();
      setStatus("absent");
      return;
    }
    void loadVault(userId).catch(() => {
      setStatus("absent");
      setError("Could not load your vault. Refresh to try again.");
    });
  }, [ready, userId, loadVault, reset]);

  /** Encrypts current state and persists it locally, then remotely. */
  const persist = useCallback(
    async (nextEncrypted: EncryptedItem[]) => {
      const id = userId;
      const envelope = envelopeRef.current;
      if (!id || !envelope) return;

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
      await writeLocalVault(id, vault);

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
    [userId, markSynced],
  );

  const createVault = useCallback(
    async (recoveryPhrase: string, passphrase: string) => {
      if (!userId) throw new Error("Sign in first.");
      setError(null);

      const { envelope, keyring } = await createKeyring(userId, recoveryPhrase, passphrase);
      keyringRef.current = keyring;
      envelopeRef.current = envelope;
      encryptedRef.current = [];
      revisionRef.current = 0;
      setItems([]);
      setStatus("unlocked");

      await persist([]);
    },
    [userId, persist],
  );

  const decryptInto = useCallback(async (keyring: Keyring) => {
    const { items: decrypted, failed } = await decryptAll(keyring, encryptedRef.current);
    decrypted.sort((a, b) => b.updatedAt - a.updatedAt);
    setItems(decrypted);
    setCorrupted(failed);
  }, []);

  const unlock = useCallback(
    async (passphrase: string) => {
      if (!userId) throw new Error("Sign in first.");
      const envelope = envelopeRef.current;
      if (!envelope) throw new Error("No vault to unlock.");

      setError(null);
      try {
        const keyring = await unlockWithPassphrase(userId, envelope, passphrase);
        keyringRef.current = keyring;
        await decryptInto(keyring);
        setStatus("unlocked");
      } catch (err) {
        if (err instanceof IncorrectPassphraseError) {
          setError(err.message);
        } else {
          setError("Unlock failed. Check your passphrase and try again.");
        }
        throw err;
      }
    },
    [userId, decryptInto],
  );

  /**
   * Recovery path: prove ownership with the phrase, then set a new
   * passphrase. The root key is unchanged, so existing entries stay readable.
   */
  const recoverWithPhrase = useCallback(
    async (recoveryPhrase: string, newPassphrase: string) => {
      if (!userId) throw new Error("Sign in first.");
      const envelope = envelopeRef.current;
      if (!envelope) throw new Error("No vault to recover.");

      setError(null);
      const keyring = await unlockWithRecoveryPhrase(userId, envelope, recoveryPhrase);
      const nextEnvelope = await rewrapWithNewPassphrase(
        userId,
        envelope,
        recoveryPhrase,
        newPassphrase,
      );

      keyringRef.current = keyring;
      envelopeRef.current = nextEnvelope;
      await decryptInto(keyring);
      setStatus("unlocked");
      await persist(encryptedRef.current);
    },
    [userId, decryptInto, persist],
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
    if (!userId) return;
    try {
      await deleteRemoteVault();
    } catch {
      // Local wipe proceeds regardless — the user asked for this device to
      // forget the vault, and a network failure must not block that.
    }
    await clearLocalVault(userId);
    reset();
    setStatus("absent");
  }, [userId, reset]);

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
      createVault,
      unlock,
      recoverWithPhrase,
      lock,
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
      createVault,
      unlock,
      recoverWithPhrase,
      lock,
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
