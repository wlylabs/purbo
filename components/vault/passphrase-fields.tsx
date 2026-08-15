"use client";

import { Check, Copy, Dices } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/primitives";
import { BIP39_WORDLIST } from "@/lib/crypto/mnemonic";
import { generatePassphrase } from "@/lib/crypto/password";
import { StrengthMeter } from "./strength-meter";

/** Below this the passphrase is too weak to be the only thing in front of the vault. */
export const MIN_PASSPHRASE_BITS = 60;
export const MIN_PASSPHRASE_LENGTH = 10;

export function passphraseIsUsable(value: string, bits: number): boolean {
  return value.length >= MIN_PASSPHRASE_LENGTH && bits >= MIN_PASSPHRASE_BITS;
}

/**
 * Words drawn from the 2048-word list, so each one is worth log2(2048) bits.
 *
 * Six rather than five is deliberate. The meter below scores characters, which
 * reads generously for anything word-shaped — a five-word suggestion would
 * clear Purbo's own 60-bit bar on the meter's arithmetic while carrying 55
 * bits in fact. Six carries 66, so the suggestion passes the stated bar by
 * what it actually contains. The extra word costs a little typing, and the
 * passkey registered on the next screen is what makes that rare.
 */
const SUGGESTION_WORDS = 6;
const BITS_PER_WORD = 11;

/**
 * The passphrase pair, with a way out of inventing one.
 *
 * Asking someone to compose a strong passphrase on the spot is where good
 * intentions turn into a variation on a password they already use. Offering a
 * generated one is not a convenience so much as the difference between the
 * stated advice — four or five unrelated words — and something anyone will
 * actually follow at 3am on a phone.
 *
 * The suggestion fills both fields. There is nothing for a confirmation field
 * to catch in a value that was never typed, and the honest safeguard is not a
 * second box but telling the user plainly that this is the only screen the
 * passphrase will ever appear on.
 */
export function PassphraseFields({
  passphrase,
  confirmation,
  onPassphrase,
  onConfirmation,
  disabled,
  allowSuggestion = true,
}: {
  passphrase: string;
  confirmation: string;
  onPassphrase: (value: string) => void;
  onConfirmation: (value: string) => void;
  disabled?: boolean;
  /** Off on restore: that screen sets a passphrase the user already chose, not a fresh one. */
  allowSuggestion?: boolean;
}) {
  const [suggested, setSuggested] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const matches = passphrase.length > 0 && passphrase === confirmation;

  const suggest = () => {
    const value = generatePassphrase(BIP39_WORDLIST, SUGGESTION_WORDS);
    setSuggested(value);
    setCopied(false);
    setCopyFailed(false);
    onPassphrase(value);
    onConfirmation(value);
  };

  const copy = async () => {
    if (!suggested) return;
    try {
      await navigator.clipboard.writeText(suggested);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopyFailed(true);
    }
  };

  return (
    <div className="space-y-4">
      <PasswordInput
        label="Passphrase"
        value={passphrase}
        onChange={(event) => {
          onPassphrase(event.target.value);
          // Once it has been edited by hand it is no longer the suggestion,
          // and the notice below would be describing something else.
          if (suggested && event.target.value !== suggested) setSuggested(null);
        }}
        mono={false}
        required
        disabled={disabled}
        hint={`At least ${MIN_PASSPHRASE_LENGTH} characters and ${MIN_PASSPHRASE_BITS} bits of estimated entropy.`}
      />

      {allowSuggestion ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={suggest} disabled={disabled}>
            <Dices className="size-3.5" aria-hidden />
            {suggested ? "Suggest another" : "Suggest a passphrase"}
          </Button>
          {suggested ? (
            <Button type="button" variant="ghost" size="sm" onClick={copy} disabled={disabled}>
              {copied ? (
                <Check className="size-3.5 text-positive" aria-hidden />
              ) : (
                <Copy className="size-3.5" aria-hidden />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          ) : null}
        </div>
      ) : null}

      <StrengthMeter password={passphrase} />

      {suggested ? (
        <Notice tone="caution">
          {/* Wrapped at the hyphens rather than mid-word: the whole point of a
              word-based passphrase is that it can be read back off a screen. */}
          <span className="block font-mono text-[0.9375rem] break-words text-ink">{suggested}</span>
          <span className="mt-2 block">
            {SUGGESTION_WORDS} words drawn at random — {SUGGESTION_WORDS * BITS_PER_WORD} bits of
            real entropy, before Argon2id makes each guess expensive. The meter reads higher
            because it counts characters, which flatters anything built from words; the honest
            figure is this one.
          </span>
          <span className="mt-2 block">
            Write it down or put it in your password manager now. This is the only screen it
            appears on, and Purbo keeps no copy it could show you again.
          </span>
          {copyFailed ? (
            <span className="mt-2 block text-critical">
              The clipboard was blocked. Copy it by hand instead.
            </span>
          ) : null}
        </Notice>
      ) : null}

      <PasswordInput
        label="Confirm passphrase"
        value={confirmation}
        onChange={(event) => onConfirmation(event.target.value)}
        mono={false}
        required
        disabled={disabled}
        error={confirmation.length > 0 && !matches ? "Passphrases do not match." : null}
      />
    </div>
  );
}
