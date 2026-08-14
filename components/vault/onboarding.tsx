"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Eye,
  EyeOff,
  ShieldCheck,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input, PasswordInput } from "@/components/ui/input";
import { Card, Notice } from "@/components/ui/primitives";
import { createRecoveryPhrase } from "@/lib/crypto/mnemonic";
import { estimateStrength } from "@/lib/crypto/password";
import { randomInt } from "@/lib/crypto/primitives";
import { useVault } from "@/lib/vault/provider";
import { cn } from "@/lib/utils";
import { StrengthMeter } from "./strength-meter";

type Step = "intro" | "phrase" | "verify" | "passphrase";

/** Below this the passphrase is too weak to be the only thing in front of the vault. */
const MIN_PASSPHRASE_BITS = 60;
const MIN_PASSPHRASE_LENGTH = 10;

export function Onboarding() {
  const { createVault } = useVault();

  const [step, setStep] = useState<Step>("intro");
  // Generated once, lazily, and held only for the duration of onboarding.
  const [phrase] = useState(() => createRecoveryPhrase());
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const words = useMemo(() => phrase.split(" "), [phrase]);

  // Three positions the user must retype, chosen once per session.
  const challenge = useMemo(() => {
    const picked = new Set<number>();
    while (picked.size < 3) picked.add(randomInt(words.length));
    return [...picked].sort((a, b) => a - b);
  }, [words.length]);

  const [answers, setAnswers] = useState<Record<number, string>>({});
  const verified = challenge.every(
    (index) => answers[index]?.trim().toLowerCase() === words[index],
  );

  const strength = estimateStrength(passphrase);
  const passphraseValid =
    passphrase.length >= MIN_PASSPHRASE_LENGTH && strength.bits >= MIN_PASSPHRASE_BITS;
  const matches = passphrase.length > 0 && passphrase === confirmation;

  const copyPhrase = async () => {
    try {
      await navigator.clipboard.writeText(phrase);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Clipboard was blocked. Write the words down by hand instead.");
    }
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await createVault(phrase, passphrase);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not create the vault. Try again.",
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-xl px-5 py-8 sm:py-14">
      <StepIndicator step={step} />

      <Card className="mt-5 p-5 sm:mt-6 sm:p-8">
        {step === "intro" ? (
          <div className="space-y-6">
            <div className="space-y-3">
              <ShieldCheck className="size-6" aria-hidden />
              <h1 className="text-display text-2xl">Create your vault</h1>
              <p className="text-[0.9375rem] leading-relaxed text-ink-muted">
                Purbo is about to generate a 24-word recovery phrase in this browser. It is
                the root of your vault — everything you save is encrypted under it.
              </p>
            </div>

            <Notice tone="caution" icon={<AlertTriangle className="size-4" />}>
              The phrase is never sent anywhere, so it cannot be re-sent to you. If you lose
              both the phrase and your passphrase, the vault cannot be opened by anyone,
              including us. Have paper and a pen ready.
            </Notice>

            <Button size="lg" className="w-full" onClick={() => setStep("phrase")}>
              Generate recovery phrase
              <ArrowRight className="size-4" aria-hidden />
            </Button>
          </div>
        ) : null}

        {step === "phrase" ? (
          <div className="space-y-6">
            <div className="space-y-2">
              <h1 className="text-display text-2xl">Your recovery phrase</h1>
              <p className="text-[0.8125rem] leading-relaxed text-ink-muted">
                Write these 24 words down in order and store them somewhere physical. Do not
                photograph them, and do not put them in another password manager.
              </p>
            </div>

            <div className="relative">
              <ol
                className={cn(
                  "grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-sm)] border border-line bg-line sm:grid-cols-3",
                  !revealed && "blur-sm select-none",
                )}
                aria-hidden={!revealed}
              >
                {words.map((word, index) => (
                  <li
                    key={`${index}-${word}`}
                    className="flex items-baseline gap-2 bg-elevated px-3 py-2.5"
                  >
                    <span className="w-5 shrink-0 text-right font-mono text-[0.6875rem] text-ink-subtle">
                      {index + 1}
                    </span>
                    <span className="font-mono text-[0.8125rem]">{word}</span>
                  </li>
                ))}
              </ol>

              {!revealed ? (
                <button
                  type="button"
                  onClick={() => setRevealed(true)}
                  className="absolute inset-0 grid place-items-center rounded-[var(--radius-sm)] bg-canvas/40"
                >
                  <span className="inline-flex items-center gap-2 rounded-full border border-line bg-elevated px-4 py-2 text-[0.8125rem] font-medium">
                    <Eye className="size-4" aria-hidden />
                    Tap to reveal
                  </span>
                </button>
              ) : null}
            </div>

            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="flex-1"
                onClick={() => setRevealed((value) => !value)}
              >
                {revealed ? (
                  <EyeOff className="size-3.5" aria-hidden />
                ) : (
                  <Eye className="size-3.5" aria-hidden />
                )}
                {revealed ? "Hide" : "Reveal"}
              </Button>
              <Button variant="secondary" size="sm" className="flex-1" onClick={copyPhrase}>
                {copied ? (
                  <Check className="size-3.5 text-positive" aria-hidden />
                ) : (
                  <Copy className="size-3.5" aria-hidden />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>

            <label className="flex cursor-pointer items-start gap-2.5 text-[0.8125rem] leading-relaxed text-ink-muted">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--ink)]"
              />
              I have written down all 24 words and understand they cannot be recovered.
            </label>

            {error ? <p className="text-xs text-critical">{error}</p> : null}

            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep("intro")}>
                <ArrowLeft className="size-4" aria-hidden />
                Back
              </Button>
              <Button
                className="flex-1"
                disabled={!acknowledged || !revealed}
                onClick={() => setStep("verify")}
              >
                Continue
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            </div>
          </div>
        ) : null}

        {step === "verify" ? (
          <div className="space-y-6">
            <div className="space-y-2">
              <h1 className="text-display text-2xl">Confirm the phrase</h1>
              <p className="text-[0.8125rem] leading-relaxed text-ink-muted">
                Type the words at these positions to confirm your copy is correct.
              </p>
            </div>

            <div className="space-y-4">
              {challenge.map((index) => (
                <Input
                  key={index}
                  label={`Word ${index + 1}`}
                  value={answers[index] ?? ""}
                  onChange={(event) =>
                    setAnswers((current) => ({ ...current, [index]: event.target.value }))
                  }
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  className="font-mono"
                  error={
                    answers[index] && answers[index]!.trim().toLowerCase() !== words[index]
                      ? "Does not match."
                      : null
                  }
                />
              ))}
            </div>

            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep("phrase")}>
                <ArrowLeft className="size-4" aria-hidden />
                Back
              </Button>
              <Button className="flex-1" disabled={!verified} onClick={() => setStep("passphrase")}>
                Continue
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            </div>
          </div>
        ) : null}

        {step === "passphrase" ? (
          <div className="space-y-6">
            <div className="space-y-2">
              <h1 className="text-display text-2xl">Set your passphrase</h1>
              <p className="text-[0.8125rem] leading-relaxed text-ink-muted">
                This unlocks the vault day to day. It is stretched with Argon2id in your
                browser and never leaves this device.
              </p>
            </div>

            <div className="space-y-4">
              <PasswordInput
                label="Passphrase"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                mono={false}
                required
                hint={`At least ${MIN_PASSPHRASE_LENGTH} characters and ${MIN_PASSPHRASE_BITS} bits of estimated entropy.`}
              />
              <StrengthMeter password={passphrase} />
              <PasswordInput
                label="Confirm passphrase"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                mono={false}
                required
                error={
                  confirmation.length > 0 && !matches ? "Passphrases do not match." : null
                }
              />
            </div>

            <Notice tone="neutral">
              A memorable passphrase of four or five unrelated words beats a short scramble —
              it is easier to recall and harder to guess.
            </Notice>

            {error ? (
              <Notice tone="critical" icon={<AlertTriangle className="size-4" />}>
                {error}
              </Notice>
            ) : null}

            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep("verify")} disabled={submitting}>
                <ArrowLeft className="size-4" aria-hidden />
                Back
              </Button>
              <Button
                className="flex-1"
                loading={submitting}
                disabled={!passphraseValid || !matches}
                onClick={submit}
              >
                Create vault
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function StepIndicator({ step }: { step: Step }) {
  const steps: Step[] = ["intro", "phrase", "verify", "passphrase"];
  const current = steps.indexOf(step);

  return (
    <div className="flex items-center gap-2" aria-label={`Step ${current + 1} of ${steps.length}`}>
      {steps.map((item, index) => (
        <span
          key={item}
          className={cn(
            "h-0.5 flex-1 rounded-full transition-colors duration-300",
            index <= current ? "bg-ink" : "bg-line",
          )}
        />
      ))}
    </div>
  );
}
