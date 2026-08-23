"use client";

import {
  AlertTriangle,
  Check,
  Download,
  Fingerprint,
  KeyRound,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { InstallSection } from "@/components/pwa/install-prompt";
import { ThemeToggle } from "@/components/theme";
import { ApprovalCard } from "@/components/ui/approval";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/input";
import { Card, ChipRadioGroup, Notice } from "@/components/ui/primitives";
import { Trace, TraceStep } from "@/components/ui/trace";
import {
  PasskeyCancelledError,
  isPasskeySupported,
  listPasskeys,
} from "@/lib/auth/passkey";
import { DEFAULT_KDF_PARAMS } from "@/lib/crypto/kdf";
import { estimateStrength } from "@/lib/crypto/password";
import {
  UnrecognisedImportError,
  parseVaultImport,
  partitionDuplicates,
} from "@/lib/vault/import";
import { IncorrectPassphraseError } from "@/lib/vault/keyring";
import { useVault } from "@/lib/vault/provider";
import type { PasskeySummary, VaultItemDraft } from "@/lib/vault/types";
import { PassphraseFields, passphraseIsUsable } from "./passphrase-fields";
import { StepUp } from "./step-up";

/**
 * Passkeys, presented as what they are.
 *
 * It would be easy to describe this as "sign in with Face ID", but that would
 * be a lie about where the trust sits: the authenticator does not vouch for
 * who you are, it holds a secret that unwraps a copy of your root key. Saying
 * so is the difference between a user understanding that losing every
 * registered device is survivable (the phrase still works) and believing this
 * is a login they can reset.
 */
function PasskeySection() {
  const { addPasskey, forgetPasskeys } = useVault();

  const [supported, setSupported] = useState(false);
  const [passkeys, setPasskeys] = useState<PasskeySummary[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setPasskeys(await listPasskeys());
    } catch {
      setPasskeys([]);
    }
  }, []);

  useEffect(() => {
    setSupported(isPasskeySupported());
    void refresh();
  }, [refresh]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await addPasskey(passphrase);
      setPassphrase("");
      setAdding(false);
      setAdded(true);
      window.setTimeout(() => setAdded(false), 4000);
      await refresh();
    } catch (err) {
      if (!(err instanceof PasskeyCancelledError)) {
        setError(err instanceof Error ? err.message : "Could not register the passkey.");
      }
    } finally {
      setBusy(false);
    }
  };

  const count = passkeys?.length ?? 0;

  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-[0.9375rem] font-semibold tracking-tight">Passkeys</h2>
      <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-muted">
        A passkey stores a sealed copy of this vault&rsquo;s root key, openable only by
        your authenticator after a biometric or device PIN. It is a third way in
        alongside the passphrase and the recovery phrase — not a replacement for either,
        and not an account you could reset.
      </p>

      {!supported ? (
        <Notice tone="neutral" className="mt-4">
          This browser does not support WebAuthn, so a passkey cannot be registered
          here.
        </Notice>
      ) : (
        <>
          <p className="mt-4 text-[0.8125rem] text-ink-muted">
            {passkeys === null
              ? "Checking…"
              : count === 0
                ? "No passkeys registered."
                : `${count} passkey${count === 1 ? "" : "s"} registered to this vault.`}
          </p>

          {adding ? (
            <form onSubmit={submit} className="mt-4 space-y-4 border-t border-line pt-5">
              <p className="text-[0.8125rem] leading-relaxed text-ink-muted">
                Confirm your passphrase. Registering unwraps the root key for exactly as
                long as it takes to seal a copy under the new passkey.
              </p>
              <PasswordInput
                label="Passphrase"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                mono={false}
                autoFocus
                required
              />
              {error ? (
                <Notice tone="critical" icon={<AlertTriangle className="size-4" />}>
                  {error}
                </Notice>
              ) : null}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setAdding(false);
                    setPassphrase("");
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" loading={busy} disabled={!passphrase}>
                  Register passkey
                </Button>
              </div>
            </form>
          ) : (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
                {added ? (
                  <Check className="size-3.5 text-positive" aria-hidden />
                ) : (
                  <Fingerprint className="size-3.5" aria-hidden />
                )}
                {added ? "Passkey added" : "Add a passkey"}
              </Button>
              {count > 0 ? (
                <Button
                  variant="danger"
                  size="sm"
                  loading={removing}
                  onClick={async () => {
                    setRemoving(true);
                    setError(null);
                    try {
                      await forgetPasskeys();
                      await refresh();
                    } catch (err) {
                      setError(
                        err instanceof Error ? err.message : "Could not remove passkeys.",
                      );
                    } finally {
                      setRemoving(false);
                    }
                  }}
                >
                  Remove all
                </Button>
              ) : null}
              {error && !adding ? (
                <p className="w-full text-xs leading-relaxed text-critical">{error}</p>
              ) : null}
            </div>
          )}

          {count > 0 ? (
            <p className="mt-3 text-[0.6875rem] leading-relaxed text-ink-subtle">
              Removing them here deletes the sealed copies from the server. The passkeys
              themselves stay in your password manager until you delete them there too.
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}

/**
 * Rotating a passphrase that is not forgotten.
 *
 * The lock screen already has a "forgot it" path, and that one costs 24
 * words. This is the everyday case it does not cover: a passphrase that was
 * shoulder-surfed, shared once to get someone into an account, or simply
 * older than the user is comfortable with. Making that require the recovery
 * phrase would mean fetching the phrase out of the safe it belongs in — and
 * the phrase leaving its hiding place is a bigger risk than the passphrase
 * being a year old.
 */
function ChangePassphraseSection() {
  const { changePassphrase } = useVault();

  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reset = () => {
    setOpen(false);
    setCurrent("");
    setNext("");
    setConfirmation("");
    setError(null);
  };

  const strongEnough = passphraseIsUsable(next, estimateStrength(next).bits);
  const valid =
    current.length > 0 && strongEnough && next === confirmation && next !== current;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid) return;

    setBusy(true);
    setError(null);
    try {
      await changePassphrase(current, next);
      reset();
      setDone(true);
      window.setTimeout(() => setDone(false), 6000);
    } catch (err) {
      setError(
        err instanceof IncorrectPassphraseError
          ? "That is not the passphrase this vault is currently wrapped with."
          : err instanceof Error
            ? err.message
            : "Could not change the passphrase.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-[0.9375rem] font-semibold tracking-tight">Passphrase</h2>
      <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-muted">
        Changing it re-wraps the same root key under a new one. Nothing is re-encrypted, so
        your entries and every registered passkey keep working — only the thing that opens
        the wrap changes.
      </p>

      {open ? (
        <form onSubmit={submit} className="mt-5 space-y-5 border-t border-line pt-5">
          <PasswordInput
            label="Current passphrase"
            value={current}
            onChange={(event) => {
              setCurrent(event.target.value);
              if (error) setError(null);
            }}
            mono={false}
            autoFocus
            required
            hint="Proved by unwrapping for real, the same work an unlock does."
          />

          <PassphraseFields
            passphrase={next}
            confirmation={confirmation}
            onPassphrase={setNext}
            onConfirmation={setConfirmation}
            disabled={busy}
          />

          {next && next === current ? (
            <Notice tone="caution">That is the passphrase you already have.</Notice>
          ) : null}

          {error ? (
            <Notice tone="critical" icon={<AlertTriangle className="size-4" />}>
              {error}
            </Notice>
          ) : null}

          <Notice tone="neutral">
            Your other devices keep unlocking with the old passphrase until they next reach
            the server — they hold their own copy of the wrap, and it is the sync that
            replaces it.
          </Notice>

          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={reset}>
              Cancel
            </Button>
            <Button type="submit" size="sm" className="flex-1" loading={busy} disabled={!valid}>
              Change passphrase
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="secondary" size="sm" className="mt-4" onClick={() => setOpen(true)}>
          {done ? (
            <Check className="size-3.5 text-positive" aria-hidden />
          ) : (
            <KeyRound className="size-3.5" aria-hidden />
          )}
          {done ? "Passphrase changed" : "Change passphrase"}
        </Button>
      )}
    </Card>
  );
}

interface Staged {
  fresh: VaultItemDraft[];
  duplicates: VaultItemDraft[];
  skipped: number;
  format: string;
  filename: string;
}

const FORMAT_LABELS: Record<string, string> = {
  "purbo-json": "a Purbo export",
  "bitwarden-json": "a Bitwarden JSON export",
  csv: "a CSV export",
};

/**
 * Bringing a vault in from somewhere else.
 *
 * The file is read with `File.text()` and parsed in this tab. It is never
 * uploaded — an import that posted the CSV somewhere "to parse it properly"
 * would hand over, in one request, everything the rest of this app exists to
 * keep. What lands in the vault is encrypted before it is stored, like
 * anything typed in by hand.
 *
 * Nothing is written until the counts have been shown. An import that silently
 * doubled a vault because the file had been imported once already is the
 * failure everyone has had, and it is not undoable one entry at a time.
 */
function ImportSection() {
  const { importItems, items } = useVault();

  const inputRef = useRef<HTMLInputElement>(null);
  const [staged, setStaged] = useState<Staged | null>(null);
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<number | null>(null);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setImported(null);
    setIncludeDuplicates(false);

    try {
      const result = parseVaultImport(await file.text());
      const { fresh, duplicates } = partitionDuplicates(items, result.entries);
      setStaged({
        fresh,
        duplicates,
        skipped: result.skipped,
        format: result.format,
        filename: file.name,
      });
    } catch (err) {
      setStaged(null);
      setError(
        err instanceof UnrecognisedImportError
          ? err.message
          : err instanceof Error
            ? err.message
            : "That file could not be read.",
      );
    }
  };

  const confirm = async () => {
    if (!staged) return;
    const drafts = includeDuplicates
      ? [...staged.fresh, ...staged.duplicates]
      : staged.fresh;

    setBusy(true);
    setError(null);
    try {
      setImported(await importItems(drafts));
      setStaged(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the imported entries.");
    } finally {
      setBusy(false);
    }
  };

  const total = staged ? staged.fresh.length + (includeDuplicates ? staged.duplicates.length : 0) : 0;

  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-[0.9375rem] font-semibold tracking-tight">Import</h2>
      <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-muted">
        Bring entries in from Bitwarden, 1Password, LastPass, Chrome, or any CSV with a
        header row. The file is read and encrypted in this browser — it is never uploaded.
        Delete it afterwards: until you do, it is a plaintext copy of your passwords sitting
        in your downloads folder.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,.json,.txt,text/csv,application/json,text/plain"
        className="hidden"
        onChange={(event) => {
          void choose(event.target.files?.[0]);
          // Cleared so choosing the same file twice still fires a change.
          event.target.value = "";
        }}
      />

      {staged ? (
        <div className="mt-4 space-y-4 border-t border-line pt-5">
          <div className="space-y-1">
            <p className="text-[0.875rem] font-medium">
              {staged.filename} — read as {FORMAT_LABELS[staged.format] ?? "a CSV export"}
            </p>
            <ul className="space-y-0.5 text-[0.8125rem] leading-relaxed text-ink-muted">
              <li>
                <strong className="text-ink tabular-nums">{staged.fresh.length}</strong>{" "}
                {staged.fresh.length === 1 ? "entry is" : "entries are"} new to this vault.
              </li>
              {staged.duplicates.length > 0 ? (
                <li>
                  <strong className="text-ink tabular-nums">{staged.duplicates.length}</strong>{" "}
                  already {staged.duplicates.length === 1 ? "matches an entry" : "match entries"}{" "}
                  you have, by name and username.
                </li>
              ) : null}
              {staged.skipped > 0 ? (
                <li>
                  <strong className="text-ink tabular-nums">{staged.skipped}</strong>{" "}
                  {staged.skipped === 1 ? "row was" : "rows were"} skipped for having no name
                  or no password.
                </li>
              ) : null}
            </ul>
          </div>

          {staged.duplicates.length > 0 ? (
            <label className="flex cursor-pointer items-start gap-2.5 text-[0.8125rem] leading-relaxed text-ink-muted">
              <input
                type="checkbox"
                checked={includeDuplicates}
                onChange={(event) => setIncludeDuplicates(event.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--ink)]"
              />
              <span>
                <span className="block font-medium text-ink">Import the duplicates too</span>
                Off by default: two entries with the same name and username are almost always
                the same account imported twice, and telling them apart afterwards means
                opening both.
              </span>
            </label>
          ) : null}

          {error ? (
            <Notice tone="critical" icon={<AlertTriangle className="size-4" />}>
              {error}
            </Notice>
          ) : null}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setStaged(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="flex-1"
              loading={busy}
              disabled={total === 0}
              onClick={() => void confirm()}
            >
              {total === 0
                ? "Nothing new to import"
                : `Import ${total} ${total === 1 ? "entry" : "entries"}`}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <Button
            variant="secondary"
            size="sm"
            className="mt-4"
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="size-3.5" aria-hidden />
            Choose a file
          </Button>

          {imported !== null ? (
            <Notice tone="positive" className="mt-4" icon={<Check className="size-4" />}>
              {imported} {imported === 1 ? "entry" : "entries"} imported and encrypted.
            </Notice>
          ) : null}

          {error ? (
            <Notice tone="critical" className="mt-4" icon={<AlertTriangle className="size-4" />}>
              {error}
            </Notice>
          ) : null}
        </>
      )}
    </Card>
  );
}

const AUTO_LOCK_CHOICES = [
  { minutes: 1, label: "1 min" },
  { minutes: 5, label: "5 min" },
  { minutes: 10, label: "10 min" },
  { minutes: 30, label: "30 min" },
  { minutes: 0, label: "Never" },
];

export function SettingsView() {
  const {
    autoLockMinutes,
    setAutoLockMinutes,
    lockOnHidden,
    setLockOnHidden,
    privacyScreen,
    setPrivacyScreen,
    items,
    destroyVault,
    syncState,
    syncMessage,
    stepUpVerified,
  } = useVault();

  const [confirmingDestroy, setConfirmingDestroy] = useState(false);
  const [destroying, setDestroying] = useState(false);
  const [confirmingExport, setConfirmingExport] = useState(false);

  /**
   * Exports the vault as plaintext JSON.
   *
   * This is deliberately blunt: an export is a decrypted copy of everything,
   * and the only honest way to present it is with that stated plainly rather
   * than buried. It exists so users are never locked in.
   */
  const exportVault = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      warning: "PLAINTEXT EXPORT — this file is not encrypted. Store or delete it carefully.",
      items: items.map((item) => ({
        name: item.name,
        username: item.username,
        password: item.password,
        url: item.url ?? "",
        notes: item.notes ?? "",
        // Everything an entry holds, including the second factor: an export
        // that quietly dropped the authenticator secret would look complete
        // and leave the user locked out of the account it belongs to.
        totp: item.totp ?? "",
        tags: item.tags ?? [],
        favourite: item.favourite === true,
      })),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `purbo-export-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <Card className="p-5 sm:p-6">
        <h2 className="text-[0.9375rem] font-semibold tracking-tight">Auto-lock</h2>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-muted">
          Reloading this tab resumes where you left off. Locking ends that: the decryption
          key is dropped from memory and from the tab&rsquo;s cache, so anyone who reaches
          the tab afterwards needs your passphrase or passkey again.
        </p>
        <ChipRadioGroup
          label="Auto-lock delay"
          className="mt-4"
          value={autoLockMinutes}
          onChange={setAutoLockMinutes}
          options={AUTO_LOCK_CHOICES.map((choice) => ({
            value: choice.minutes,
            label: choice.label,
          }))}
        />
        {autoLockMinutes === 0 ? (
          <Notice tone="caution" className="mt-4" icon={<AlertTriangle className="size-4" />}>
            With auto-lock off, the vault stays decrypted until you lock it or close the tab.
          </Notice>
        ) : null}

        {/* The timer covers a vault left alone. This covers a vault left in
            front of someone — the case where the wait never elapses because
            the machine is being used, just not by you. */}
        <label className="mt-5 flex cursor-pointer items-start gap-2.5 border-t border-line pt-5 text-[0.8125rem] leading-relaxed text-ink-muted">
          <input
            type="checkbox"
            checked={lockOnHidden}
            onChange={(event) => setLockOnHidden(event.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-[var(--ink)]"
          />
          <span>
            <span className="block font-medium text-ink">
              Lock as soon as I switch away
            </span>
            Locks the moment this tab stops being what is on screen — another tab, another
            app, a locked phone. Worth it on a shared or public machine; on a phone it
            means glancing at a notification costs you an unlock.
          </span>
        </label>

        {/* The cheap half of the same idea. Locking answers "who can use the
            vault"; this answers "who can see it" — including in places the
            vault is on screen without this tab being in front of you. */}
        <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-[0.8125rem] leading-relaxed text-ink-muted">
          <input
            type="checkbox"
            checked={privacyScreen}
            onChange={(event) => setPrivacyScreen(event.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-[var(--ink)]"
          />
          <span>
            <span className="block font-medium text-ink">Blur the screen when I switch away</span>
            Blurs the vault while this tab is in the background — in the phone&rsquo;s app
            switcher, on a shared screen, or in the second before you look back. The app
            stays recognisable enough to pick out of a stack of them; nothing on it can be
            read. Coming back lifts it; no unlock, so this is about who can see the vault
            rather than who can use it. Phone app switchers snapshot on their own schedule,
            so treat that one as likely, not certain.
          </span>
        </label>
      </Card>

      {/*
        The key chain, shown rather than listed.
        A table of algorithm names says which primitives are used; it does not
        say what reaches the server. Laying the same facts out as a sequence
        makes the shape of the guarantee legible — two independent entry
        points, one root key, and a boundary the plaintext never crosses.
      */}
      <section>
        <h2 className="text-[0.9375rem] font-semibold tracking-tight">Key chain</h2>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-muted">
          How this vault gets from something you know to something the server cannot read.
          Open any step for the parameters.
        </p>

        <Trace className="mt-4">
          <TraceStep
            title="Recovery phrase"
            state="done"
            meta="BIP39 · 24 words"
            summary="256 bits of entropy generated in this browser."
          >
            The words are a human-readable encoding of the seed, not a password. They were
            drawn from WebCrypto randomness on your device and have never been transmitted,
            which is also why nobody can re-send them to you.
          </TraceStep>

          <TraceStep
            title="Identity"
            state="done"
            meta="HKDF · Ed25519"
            summary="The same phrase that decrypts also signs you in."
          >
            A separate HKDF branch turns the seed into an Ed25519 key pair. The server
            issues a nonce, this device signs it, and your account id is a hash of the
            public half. There is no identity provider and no password on any server — so
            &ldquo;signed in&rdquo; and &ldquo;can decrypt&rdquo; are the same fact rather
            than two that can drift apart.
          </TraceStep>

          <TraceStep
            title="Passphrase"
            state="done"
            meta={`Argon2id · ${DEFAULT_KDF_PARAMS.memoryKiB / 1024} MiB · ${DEFAULT_KDF_PARAMS.iterations} passes`}
            summary="The everyday path to the same root key."
          >
            Memory-hardness is the point: an attacker guessing offline pays{" "}
            {DEFAULT_KDF_PARAMS.memoryKiB / 1024} MiB of RAM per attempt, which is what
            removes the advantage GPU and ASIC cracking rigs have over a laptop. The result
            unwraps the stored root key; it is never itself the key.
          </TraceStep>

          <TraceStep
            title="Root key"
            state="done"
            meta="HKDF-SHA-256"
            summary="Reachable from either the phrase or the passphrase."
          >
            Domain-separated with distinct labels, so the key that wraps and the key that
            encrypts are different keys derived from one root. Losing the passphrase costs
            you nothing while you still hold the phrase.
          </TraceStep>

          <TraceStep
            title="Entries"
            state="done"
            meta="AES-256-GCM · 96-bit IV"
            summary="Name, username, URL and notes are all inside the ciphertext."
          >
            Each record is sealed with associated data binding it to your account and its own
            id, so moving a blob between records or between users fails to decrypt rather
            than succeeding quietly.
          </TraceStep>

          <TraceStep
            title="Sync"
            state={syncState === "error" ? "failed" : syncState === "syncing" ? "active" : "done"}
            meta={syncState === "idle" ? "ciphertext only" : syncState}
            summary={syncMessage ?? "The server holds opaque blobs and a revision counter."}
            last
          >
            What leaves this device: the wrapped root key with its public KDF parameters,
            the sealed entries, and a revision number used to resolve two devices writing
            at once. Requests carry a short-lived token minted from a signature — no
            cookie, no email, no third-party identifier. The server&rsquo;s entire record
            of you is a hash of a public key.
          </TraceStep>
        </Trace>
      </section>

      <ChangePassphraseSection />

      <PasskeySection />

      {/*
        The header carries this control too, but only from `sm` up — there is
        no room for it beside the sync state and the lock button on a phone.
        Installed on a phone is exactly where Purbo spends most of its life,
        so without a home here the theme would be unreachable on the device
        that uses it most.
      */}
      <Card className="flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
        <div className="min-w-0">
          <h2 className="text-[0.9375rem] font-semibold tracking-tight">Appearance</h2>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-muted">
            Stored in this browser only. &ldquo;System&rdquo; follows the device.
          </p>
        </div>
        <ThemeToggle />
      </Card>

      <Card className="p-5 sm:p-6">
        <InstallSection />
      </Card>

      <ImportSection />

      <Card className="p-5 sm:p-6">
        <h2 className="text-[0.9375rem] font-semibold tracking-tight">Export</h2>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-muted">
          Download every entry as JSON. The file is <strong className="text-ink">not
          encrypted</strong> — anyone who opens it reads your passwords. Move it somewhere
          safe or delete it as soon as you are done.
        </p>
        {/* The largest single disclosure the app can make, so it asks. */}
        {confirmingExport && !stepUpVerified ? (
          <div className="mt-4">
            <StepUp
              action="download a plaintext copy of every entry"
              onVerified={() => {
                setConfirmingExport(false);
                exportVault();
              }}
              onCancel={() => setConfirmingExport(false)}
            />
          </div>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            className="mt-4"
            disabled={items.length === 0}
            onClick={() => (stepUpVerified ? exportVault() : setConfirmingExport(true))}
          >
            <Download className="size-3.5" aria-hidden />
            Export {items.length} {items.length === 1 ? "entry" : "entries"}
          </Button>
        )}
      </Card>

      <Card className="border-critical/30 p-5 sm:p-6">
        <h2 className="text-[0.9375rem] font-semibold tracking-tight text-critical">
          Delete this vault
        </h2>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-muted">
          Erases the encrypted vault from the server and this device. Your recovery phrase
          cannot bring it back — there will be nothing left to decrypt.
        </p>

        {/* The gate is only raised once the user has asked for it. Leaving a
            typed confirmation field permanently on screen trains people to
            fill it in, which is the opposite of what it is for. */}
        {confirmingDestroy && !stepUpVerified ? (
          <div className="mt-5">
            <StepUp
              action="delete this vault and everything in it"
              onCancel={() => setConfirmingDestroy(false)}
            />
          </div>
        ) : confirmingDestroy ? (
          <ApprovalCard
            className="mt-5"
            title="Irreversible"
            question="Erase this vault and everything in it?"
            consequences={[
              `All ${items.length} ${items.length === 1 ? "entry is" : "entries are"} deleted from the server and from this device.`,
              "Your 24-word recovery phrase will no longer restore anything — it decrypts data that will not exist.",
              "Nobody, including us, can undo this. There is no backup we can read.",
            ]}
            confirmWord="DELETE"
            confirmLabel="Delete vault permanently"
            loading={destroying}
            onCancel={() => setConfirmingDestroy(false)}
            onConfirm={async () => {
              setDestroying(true);
              try {
                await destroyVault();
              } finally {
                setDestroying(false);
                setConfirmingDestroy(false);
              }
            }}
          />
        ) : (
          <Button variant="danger" className="mt-5" onClick={() => setConfirmingDestroy(true)}>
            Delete this vault
          </Button>
        )}
      </Card>
    </div>
  );
}
