"use client";

import { AlertTriangle, Fingerprint, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/input";
import { PixelLoader } from "@/components/ui/loader";
import { Notice } from "@/components/ui/primitives";
import { PasskeyCancelledError, isPasskeySupported } from "@/lib/auth/passkey";
import { IncorrectPassphraseError } from "@/lib/vault/keyring";
import { useVault } from "@/lib/vault/provider";

/**
 * Asking again, at the point it is worth asking.
 *
 * Unlocking establishes who was there at the time. It says nothing about who
 * is there now — the laptop may have been carried into a meeting, the phone
 * handed over to show someone a photo. So the handful of actions that hand
 * over a plaintext secret or destroy the vault re-check, and everything else
 * stays out of the way.
 *
 * Both paths prove the same thing the unlock proved: the passphrase by
 * re-deriving and unwrapping for real, the passkey by a user-verified
 * assertion. Neither compares against anything kept in memory, because
 * nothing worth comparing against is kept.
 */
export function StepUp({
  action,
  onVerified,
  onCancel,
}: {
  /** Named in the prompt: "Confirm it is you to <action>." */
  action: string;
  onVerified?: () => void;
  onCancel?: () => void;
}) {
  const { verifyPassphrase, verifyPasskey, passkeyHint } = useVault();

  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passkeyOffered, setPasskeyOffered] = useState(false);

  useEffect(() => {
    setPasskeyOffered(passkeyHint && isPasskeySupported());
  }, [passkeyHint]);

  const withPasskey = async () => {
    setPasskeyBusy(true);
    setError(null);
    try {
      await verifyPasskey();
      onVerified?.();
    } catch (err) {
      if (!(err instanceof PasskeyCancelledError)) {
        setError(
          err instanceof Error ? err.message : "That passkey did not confirm anything.",
        );
      }
    } finally {
      setPasskeyBusy(false);
    }
  };

  const withPassphrase = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await verifyPassphrase(passphrase);
      setPassphrase("");
      onVerified?.();
    } catch (err) {
      setError(
        err instanceof IncorrectPassphraseError
          ? "That is not the passphrase for this vault."
          : err instanceof Error
            ? err.message
            : "Could not confirm.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="animate-fade rounded-[var(--radius)] border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1 space-y-4">
          <div className="space-y-1">
            <p className="text-[0.875rem] font-medium">Confirm it is you</p>
            <p className="text-[0.8125rem] leading-relaxed text-ink-muted">
              To {action}. Confirming covers the next couple of minutes, then the vault
              asks again.
            </p>
          </div>

          {passkeyOffered ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="w-full"
              loading={passkeyBusy}
              onClick={withPasskey}
            >
              <Fingerprint className="size-3.5" aria-hidden />
              Confirm with a passkey
            </Button>
          ) : null}

          <form onSubmit={withPassphrase} className="space-y-3">
            <PasswordInput
              label="Passphrase"
              value={passphrase}
              onChange={(event) => {
                setPassphrase(event.target.value);
                if (error) setError(null);
              }}
              mono={false}
              autoFocus={!passkeyOffered}
              required
            />

            {busy ? (
              <div className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-line bg-elevated px-3 py-2">
                <PixelLoader className="shrink-0" />
                <p className="text-[0.75rem] leading-relaxed text-ink-muted" role="status">
                  Re-deriving with Argon2id — the same work the unlock does.
                </p>
              </div>
            ) : null}

            {error ? (
              <Notice tone="critical" icon={<AlertTriangle className="size-4" />}>
                {error}
              </Notice>
            ) : null}

            <div className="flex gap-2">
              {onCancel ? (
                <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
                  Cancel
                </Button>
              ) : null}
              <Button
                type="submit"
                size="sm"
                className="flex-1"
                loading={busy}
                disabled={!passphrase}
              >
                Confirm
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
