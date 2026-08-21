"use client";

import { AlertTriangle, Fingerprint, KeyRound, Lock } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { PasswordInput, Textarea } from "@/components/ui/input";
import { PixelLoader } from "@/components/ui/loader";
import { Card, Notice } from "@/components/ui/primitives";
import { Segmented, segmentedIds } from "@/components/ui/segmented";
import {
  NoPasskeyRecordError,
  PasskeyCancelledError,
  isPasskeySupported,
} from "@/lib/auth/passkey";
import { isValidRecoveryPhrase } from "@/lib/crypto/mnemonic";
import { estimateStrength } from "@/lib/crypto/password";
import { useVault } from "@/lib/vault/provider";
import { StrengthMeter } from "./strength-meter";

type Mode = "unlock" | "recover";

/**
 * What the browser is doing during the pause after "Unlock".
 *
 * Argon2id at 64 MiB is meant to be slow, and on a phone that is a visible
 * wait on a screen where a hang and a rejected passphrase look identical.
 * Naming the work turns dead time into evidence that the stretching is real.
 */
function DerivingNotice() {
  return (
    <div className="animate-fade flex items-center gap-3 rounded-[var(--radius-sm)] border border-line bg-surface px-3 py-2.5">
      <PixelLoader className="shrink-0" />
      <p className="text-[0.8125rem] leading-relaxed text-ink-muted" role="status">
        Stretching your passphrase with Argon2id. This is deliberately slow — it is what
        makes offline guessing expensive.
      </p>
    </div>
  );
}

export function LockScreen() {
  const {
    unlock,
    unlockWithRegisteredPasskey,
    recoverWithPhrase,
    error,
    clearError,
    passkeyHint,
  } = useVault();

  const [mode, setMode] = useState<Mode>("unlock");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);

  const [passkeyAvailable, setPasskeyAvailable] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  /** True only for the prompt this screen opened by itself. */
  const [autoPrompting, setAutoPrompting] = useState(false);

  /**
   * `auto` marks the attempt nobody asked for.
   *
   * A dismissed prompt is an answer — "not now, let me type it" — and
   * reporting it as a failure would put an error on screen for doing exactly
   * what the button below offers. Only an attempt the user initiated explains
   * itself when it goes wrong.
   */
  const submitPasskey = useCallback(
    async ({ auto = false }: { auto?: boolean } = {}) => {
      setPasskeyBusy(true);
      setAutoPrompting(auto);
      setPasskeyError(null);
      try {
        await unlockWithRegisteredPasskey();
      } catch (err) {
        if (!auto && !(err instanceof PasskeyCancelledError)) {
          setPasskeyError(
            err instanceof NoPasskeyRecordError
              ? "No passkey on this device is registered with a Purbo vault."
              : err instanceof Error
                ? err.message
                : "Could not unlock with a passkey.",
          );
        }
      } finally {
        setPasskeyBusy(false);
        setAutoPrompting(false);
      }
    },
    [unlockWithRegisteredPasskey],
  );

  /**
   * Reach for the authenticator on arrival, when this device has one.
   *
   * This is the whole of "why am I typing a passphrase again" — a returning
   * user with a registered passkey should meet a biometric prompt, not a form.
   * Browsers differ on whether a WebAuthn call may open without a preceding
   * gesture; where it may not, the prompt is refused, this falls through
   * silently, and the button below is one tap away.
   */
  const attempted = useRef(false);
  useEffect(() => {
    const supported = isPasskeySupported();
    setPasskeyAvailable(supported);

    if (!supported || !passkeyHint || attempted.current) return;
    attempted.current = true;
    void submitPasskey({ auto: true });
  }, [passkeyHint, submitPasskey]);

  const [phrase, setPhrase] = useState("");
  const [newPassphrase, setNewPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  const phraseValid = isValidRecoveryPhrase(phrase);
  const newStrength = estimateStrength(newPassphrase);
  const newValid = newPassphrase.length >= 10 && newStrength.bits >= 60;
  const matches = newPassphrase.length > 0 && newPassphrase === confirmation;

  const submitUnlock = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await unlock(passphrase);
      setPassphrase("");
    } catch {
      // The provider surfaces the message; keep the field for a retry.
    } finally {
      setBusy(false);
    }
  };

  const submitRecovery = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setRecoveryError(null);
    try {
      await recoverWithPhrase(phrase, newPassphrase);
      setPhrase("");
      setNewPassphrase("");
      setConfirmation("");
    } catch (err) {
      setRecoveryError(
        err instanceof Error
          ? "That recovery phrase does not match this vault."
          : "Recovery failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-8 sm:py-12">
      {/* Recovery is promoted from a footnote to a peer of unlocking. It is
          the documented answer to a forgotten passphrase, and burying it under
          the failing field is the moment people conclude they are locked out. */}
      <Segmented
        name="lock"
        label="Ways to open this vault"
        fill
        items={[
          { id: "unlock", label: "Passphrase", icon: Lock },
          { id: "recover", label: "Recovery phrase", icon: KeyRound },
        ]}
        value={mode}
        onChange={(next: Mode) => {
          setMode(next);
          clearError();
          setRecoveryError(null);
        }}
        className="mb-4"
      />

      <Card
        className="p-5 sm:p-8"
        id={segmentedIds("lock", mode).panelId}
        role="tabpanel"
        aria-labelledby={segmentedIds("lock", mode).tabId}
      >
        {mode === "unlock" ? (
          <form onSubmit={submitUnlock} className="space-y-6">
            <div className="space-y-3">
              <div className="grid size-10 place-items-center rounded-[var(--radius)] border border-line bg-surface">
                <Lock className="size-4" aria-hidden />
              </div>
              <div className="space-y-1.5">
                <h1 className="text-display text-2xl">Vault locked</h1>
                <p className="text-[0.8125rem] leading-relaxed text-ink-muted">
                  {autoPrompting
                    ? "Confirm with your passkey to decrypt this vault, or use your passphrase below."
                    : "Enter your passphrase to decrypt this vault in the browser."}
                </p>
              </div>
            </div>

            {/* The passkey sits above the field rather than below it: for a
                device that has one registered it is the faster path, and
                burying it under the passphrase input means it is only found
                by people who already knew it was there. */}
            {passkeyAvailable ? (
              <div className="space-y-3">
                <Button
                  type="button"
                  variant="secondary"
                  size="lg"
                  className="w-full"
                  loading={passkeyBusy}
                  onClick={() => void submitPasskey()}
                >
                  <Fingerprint className="size-4" aria-hidden />
                  Unlock with a passkey
                </Button>
                {passkeyError ? (
                  <p className="text-xs leading-relaxed text-critical">{passkeyError}</p>
                ) : null}
                <div className="flex items-center gap-3">
                  <span className="h-px flex-1 bg-line" />
                  <span className="text-[0.6875rem] uppercase tracking-wide text-ink-subtle">
                    or
                  </span>
                  <span className="h-px flex-1 bg-line" />
                </div>
              </div>
            ) : null}

            <PasswordInput
              label="Passphrase"
              value={passphrase}
              onChange={(event) => {
                setPassphrase(event.target.value);
                if (error) clearError();
              }}
              mono={false}
              // Not while a passkey prompt is up: on a phone, focusing the
              // field throws the keyboard over the system sheet.
              autoFocus={!autoPrompting}
              required
              error={error}
            />

            {busy ? <DerivingNotice /> : null}

            <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!passphrase}>
              Unlock
            </Button>
          </form>
        ) : (
          <form onSubmit={submitRecovery} className="space-y-6">
            <div className="space-y-1.5">
              <h1 className="text-display text-2xl">Recover with your phrase</h1>
              <p className="text-[0.8125rem] leading-relaxed text-ink-muted">
                Enter all 24 words. Your entries stay readable — only the passphrase that
                wraps the key is replaced.
              </p>
            </div>

            <Textarea
              label="Recovery phrase"
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              placeholder="word one two three …"
              rows={4}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className="font-mono text-[0.8125rem]"
              error={phrase.length > 0 && !phraseValid ? "Not a valid 24-word phrase." : null}
              hint={phraseValid ? "Phrase checksum is valid." : "Separate each word with a space."}
            />

            <div className="space-y-4 border-t border-line pt-5">
              <PasswordInput
                label="New passphrase"
                value={newPassphrase}
                onChange={(event) => setNewPassphrase(event.target.value)}
                mono={false}
                required
              />
              <StrengthMeter password={newPassphrase} />
              <PasswordInput
                label="Confirm new passphrase"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                mono={false}
                required
                error={confirmation.length > 0 && !matches ? "Passphrases do not match." : null}
              />
            </div>

            {recoveryError ? (
              <Notice tone="critical" icon={<AlertTriangle className="size-4" />}>
                {recoveryError}
              </Notice>
            ) : null}

            {busy ? <DerivingNotice /> : null}

            <Button
              type="submit"
              size="lg"
              className="w-full"
              loading={busy}
              disabled={!phraseValid || !newValid || !matches}
            >
              Recover vault
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
