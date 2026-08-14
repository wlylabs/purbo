"use client";

import { AlertTriangle, Check, Download, Fingerprint } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { InstallSection } from "@/components/pwa/install-prompt";
import { ApprovalCard } from "@/components/ui/approval";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/input";
import { Card, Notice } from "@/components/ui/primitives";
import { Trace, TraceStep } from "@/components/ui/trace";
import {
  PasskeyCancelledError,
  isPasskeySupported,
  listPasskeys,
} from "@/lib/auth/passkey";
import { DEFAULT_KDF_PARAMS } from "@/lib/crypto/kdf";
import { useVault } from "@/lib/vault/provider";
import { cn } from "@/lib/utils";
import type { PasskeySummary } from "@/lib/vault/types";

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

const AUTO_LOCK_CHOICES = [
  { minutes: 1, label: "1 min" },
  { minutes: 5, label: "5 min" },
  { minutes: 10, label: "10 min" },
  { minutes: 30, label: "30 min" },
  { minutes: 0, label: "Never" },
];

export function SettingsView() {
  const { autoLockMinutes, setAutoLockMinutes, items, destroyVault, syncState, syncMessage } =
    useVault();

  const [confirmingDestroy, setConfirmingDestroy] = useState(false);
  const [destroying, setDestroying] = useState(false);

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
        <div role="radiogroup" aria-label="Auto-lock delay" className="mt-4 flex flex-wrap gap-2">
          {AUTO_LOCK_CHOICES.map((choice) => (
            <button
              key={choice.minutes}
              type="button"
              role="radio"
              aria-checked={autoLockMinutes === choice.minutes}
              tabIndex={autoLockMinutes === choice.minutes ? 0 : -1}
              onClick={() => setAutoLockMinutes(choice.minutes)}
              className={cn(
                "rounded-[var(--radius-sm)] border px-3 py-1.5 text-[0.8125rem] font-medium",
                "transition-[background-color,border-color,color,transform] duration-150 active:translate-y-px",
                autoLockMinutes === choice.minutes
                  ? "border-transparent bg-invert-bg text-invert-fg raised"
                  : "border-line bg-elevated text-ink-muted raised hover:border-line-strong hover:text-ink",
              )}
            >
              {choice.label}
            </button>
          ))}
        </div>
        {autoLockMinutes === 0 ? (
          <Notice tone="caution" className="mt-4" icon={<AlertTriangle className="size-4" />}>
            With auto-lock off, the vault stays decrypted until you lock it or close the tab.
          </Notice>
        ) : null}
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

      <PasskeySection />

      <Card className="p-5 sm:p-6">
        <InstallSection />
      </Card>

      <Card className="p-5 sm:p-6">
        <h2 className="text-[0.9375rem] font-semibold tracking-tight">Export</h2>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-muted">
          Download every entry as JSON. The file is <strong className="text-ink">not
          encrypted</strong> — anyone who opens it reads your passwords. Move it somewhere
          safe or delete it as soon as you are done.
        </p>
        <Button variant="secondary" size="sm" className="mt-4" onClick={exportVault} disabled={items.length === 0}>
          <Download className="size-3.5" aria-hidden />
          Export {items.length} {items.length === 1 ? "entry" : "entries"}
        </Button>
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
        {confirmingDestroy ? (
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
