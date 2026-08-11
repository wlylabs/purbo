"use client";

import { AlertTriangle, Lock } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { PasswordInput, Textarea } from "@/components/ui/input";
import { Card, Notice } from "@/components/ui/primitives";
import { isValidRecoveryPhrase } from "@/lib/crypto/mnemonic";
import { estimateStrength } from "@/lib/crypto/password";
import { useVault } from "@/lib/vault/provider";
import { StrengthMeter } from "./strength-meter";

export function LockScreen() {
  const { unlock, recoverWithPhrase, error, clearError } = useVault();

  const [mode, setMode] = useState<"unlock" | "recover">("unlock");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);

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
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-12">
      <Card className="p-6 sm:p-8">
        {mode === "unlock" ? (
          <form onSubmit={submitUnlock} className="space-y-6">
            <div className="space-y-3">
              <div className="grid size-10 place-items-center rounded-[var(--radius-sm)] border border-line bg-surface">
                <Lock className="size-4" aria-hidden />
              </div>
              <div className="space-y-1.5">
                <h1 className="text-display text-2xl">Vault locked</h1>
                <p className="text-[0.8125rem] leading-relaxed text-ink-muted">
                  Enter your passphrase to decrypt this vault in the browser.
                </p>
              </div>
            </div>

            <PasswordInput
              label="Passphrase"
              value={passphrase}
              onChange={(event) => {
                setPassphrase(event.target.value);
                if (error) clearError();
              }}
              mono={false}
              autoFocus
              required
              error={error}
            />

            <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!passphrase}>
              Unlock
            </Button>

            <button
              type="button"
              onClick={() => {
                setMode("recover");
                clearError();
              }}
              className="w-full text-center text-[0.8125rem] text-ink-muted underline underline-offset-4 transition-colors hover:text-ink"
            >
              Use recovery phrase instead
            </button>
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

            <Button
              type="submit"
              size="lg"
              className="w-full"
              loading={busy}
              disabled={!phraseValid || !newValid || !matches}
            >
              Recover vault
            </Button>

            <button
              type="button"
              onClick={() => {
                setMode("unlock");
                setRecoveryError(null);
              }}
              className="w-full text-center text-[0.8125rem] text-ink-muted underline underline-offset-4 transition-colors hover:text-ink"
            >
              Back to passphrase
            </button>
          </form>
        )}
      </Card>
    </div>
  );
}
