"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input, PasswordInput, Textarea } from "@/components/ui/input";
import { PixelLoader } from "@/components/ui/loader";
import { Card, Notice } from "@/components/ui/primitives";
import {
  NoPasskeyRecordError,
  PasskeyCancelledError,
  isPasskeySupported,
} from "@/lib/auth/passkey";
import { createRecoveryPhrase, isValidRecoveryPhrase } from "@/lib/crypto/mnemonic";
import { estimateStrength } from "@/lib/crypto/password";
import { randomInt } from "@/lib/crypto/primitives";
import { NoVaultForPhraseError, useVault } from "@/lib/vault/provider";
import { cn } from "@/lib/utils";
import { StrengthMeter } from "./strength-meter";

type Route = "choose" | "create" | "restore";
type Step = "intro" | "phrase" | "verify" | "passphrase" | "passkey";

/** Below this the passphrase is too weak to be the only thing in front of the vault. */
const MIN_PASSPHRASE_BITS = 60;
const MIN_PASSPHRASE_LENGTH = 10;

function passphraseIsUsable(value: string): boolean {
  return (
    value.length >= MIN_PASSPHRASE_LENGTH &&
    estimateStrength(value).bits >= MIN_PASSPHRASE_BITS
  );
}

export function Onboarding() {
  const [route, setRoute] = useState<Route>("choose");

  return (
    <div className="mx-auto w-full max-w-xl px-5 py-8 sm:py-14">
      {route === "choose" ? <ChooseRoute onPick={setRoute} /> : null}
      {route === "create" ? <CreateFlow onBack={() => setRoute("choose")} /> : null}
      {route === "restore" ? <RestoreFlow onBack={() => setRoute("choose")} /> : null}
    </div>
  );
}

/**
 * The fork in the road.
 *
 * With no account system there is no "log in" to default to, and the three
 * ways in are genuinely different acts: minting a new root secret, bringing
 * an existing one back from paper, or letting an authenticator hold a copy.
 * Presenting them as peers avoids the failure where someone returning to
 * their own vault walks through vault *creation* and ends up with a second,
 * empty one.
 */
function ChooseRoute({ onPick }: { onPick: (route: Route) => void }) {
  const { unlockWithRegisteredPasskey } = useVault();

  const [passkeyAvailable, setPasskeyAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPasskeyAvailable(isPasskeySupported());
  }, []);

  const openWithPasskey = async () => {
    setBusy(true);
    setError(null);
    try {
      await unlockWithRegisteredPasskey();
    } catch (err) {
      if (!(err instanceof PasskeyCancelledError)) {
        setError(
          err instanceof NoPasskeyRecordError
            ? "That passkey is not registered with a Purbo vault."
            : err instanceof Error
              ? err.message
              : "Could not open the vault with a passkey.",
        );
      }
      setBusy(false);
    }
  };

  return (
    <Card className="p-5 sm:p-8">
      <div className="space-y-3">
        <ShieldCheck className="size-6" aria-hidden />
        <h1 className="text-display text-2xl">Open a vault</h1>
        <p className="text-[0.9375rem] leading-relaxed text-ink-muted">
          This browser is not holding a vault. Start a new one, or bring an existing
          vault back — there is no account to sign into, only keys you already have.
        </p>
      </div>

      <div className="mt-6 space-y-3">
        <RouteOption
          icon={Sparkles}
          title="Create a new vault"
          body="Generates a 24-word recovery phrase in this browser. About a minute, and you will need somewhere to write the words down."
          onClick={() => onPick("create")}
        />
        <RouteOption
          icon={KeyRound}
          title="I have a recovery phrase"
          body="Restores a vault you already own onto this device. Your entries come back exactly as you left them."
          onClick={() => onPick("restore")}
        />
        {passkeyAvailable ? (
          <RouteOption
            icon={Fingerprint}
            title="Use a passkey"
            body="If you registered this device's biometric with a vault, it can open it without the phrase."
            onClick={openWithPasskey}
            loading={busy}
          />
        ) : null}
      </div>

      {error ? (
        <Notice tone="critical" className="mt-5" icon={<AlertTriangle className="size-4" />}>
          {error}
        </Notice>
      ) : null}
    </Card>
  );
}

function RouteOption({
  icon: Icon,
  title,
  body,
  onClick,
  loading,
}: {
  icon: typeof Sparkles;
  title: string;
  body: string;
  onClick: () => void;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={cn(
        "flex w-full items-start gap-3.5 rounded-[var(--radius)] border border-line bg-elevated p-4 text-left raised",
        "transition-[background-color,border-color,transform] duration-150",
        "hover:border-line-strong hover:bg-surface active:translate-y-px",
        "disabled:pointer-events-none disabled:opacity-60",
      )}
    >
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-line bg-surface">
        {loading ? (
          <PixelLoader />
        ) : (
          <Icon className="size-4" aria-hidden />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.9375rem] font-medium">{title}</span>
        <span className="mt-1 block text-[0.8125rem] leading-relaxed text-ink-muted">
          {body}
        </span>
      </span>
      <ArrowRight className="mt-1.5 size-4 shrink-0 text-ink-subtle" aria-hidden />
    </button>
  );
}

/** Restoring an existing vault: the phrase proves identity and opens it. */
function RestoreFlow({ onBack }: { onBack: () => void }) {
  const { restoreWithPhrase, setupPending, completeSetup } = useVault();

  const [phrase, setPhrase] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phraseValid = isValidRecoveryPhrase(phrase);
  const passphraseValid = passphraseIsUsable(passphrase);
  const matches = passphrase.length > 0 && passphrase === confirmation;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await restoreWithPhrase(phrase, passphrase);
      // The phrase has done its work; the passphrase is held a moment longer
      // in case the next screen registers a passkey with it.
      setPhrase("");
      setConfirmation("");
      setRestored(true);
    } catch (err) {
      setError(
        err instanceof NoVaultForPhraseError
          ? "No vault is stored for that phrase. Check the words, or create a new vault."
          : err instanceof Error
            ? err.message
            : "Could not restore the vault.",
      );
      setBusy(false);
    }
  };

  if (restored && setupPending) {
    return (
      <PasskeyOffer
        passphrase={passphrase}
        onDone={() => {
          setPassphrase("");
          completeSetup();
        }}
      />
    );
  }

  return (
    <Card className="p-5 sm:p-8">
      <form onSubmit={submit} className="space-y-6">
        <div className="space-y-2">
          <KeyRound className="size-6" aria-hidden />
          <h1 className="text-display text-2xl">Restore your vault</h1>
          <p className="text-[0.8125rem] leading-relaxed text-ink-muted">
            Your 24 words derive both the key that fetches the vault and the key that
            decrypts it. Neither is sent anywhere — the server sees a signature, never
            the phrase.
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
          <p className="text-[0.8125rem] leading-relaxed text-ink-muted">
            Set a passphrase for this device. It is what unlocks the vault here from now
            on, so you do not have to type 24 words every time.
          </p>
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
            error={confirmation.length > 0 && !matches ? "Passphrases do not match." : null}
          />
        </div>

        {error ? (
          <Notice tone="critical" icon={<AlertTriangle className="size-4" />}>
            {error}
          </Notice>
        ) : null}

        {busy ? (
          <WorkingNotice>
            Signing in with the key from your phrase, then stretching the new passphrase
            with Argon2id.
          </WorkingNotice>
        ) : null}

        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
            <ArrowLeft className="size-4" aria-hidden />
            Back
          </Button>
          <Button
            type="submit"
            className="flex-1"
            loading={busy}
            disabled={!phraseValid || !passphraseValid || !matches}
          >
            Restore vault
          </Button>
        </div>
      </form>
    </Card>
  );
}

/**
 * The passkey offer, made at the only moment it is nearly free.
 *
 * Registering unwraps the root key, which costs the passphrase — and this is
 * the one screen where the user has just typed it, so it need not be asked for
 * again. Left to Settings, this is a step almost nobody takes, and the whole
 * of "why do I keep typing a passphrase" traces back to that.
 *
 * Declining is a real answer and is presented as one. The passphrase and the
 * recovery phrase both still work; a passkey is a third way in, not an upgrade
 * that leaves the others behind.
 */
function PasskeyOffer({
  passphrase,
  onDone,
}: {
  passphrase: string;
  onDone: () => void;
}) {
  const { addPasskey } = useVault();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      await addPasskey(passphrase);
      onDone();
    } catch (err) {
      if (err instanceof PasskeyCancelledError) {
        setBusy(false);
        return;
      }
      setError(
        err instanceof Error ? err.message : "Could not register a passkey here.",
      );
      setBusy(false);
    }
  };

  return (
    <Card className="p-5 sm:p-8">
      <div className="space-y-6">
        <div className="space-y-3">
          <Fingerprint className="size-6" aria-hidden />
          <h1 className="text-display text-2xl">Open it with a touch</h1>
          <p className="text-[0.9375rem] leading-relaxed text-ink-muted">
            Your vault is ready. Register this device&rsquo;s biometric and coming back
            is a fingerprint instead of a passphrase — the key is sealed inside your
            authenticator, so only your face or PIN can release it.
          </p>
        </div>

        <Notice tone="neutral">
          Your passphrase and your 24 words keep working exactly as they do now. Losing
          this device costs you nothing but convenience.
        </Notice>

        {error ? (
          <Notice tone="critical" icon={<AlertTriangle className="size-4" />}>
            {error}
          </Notice>
        ) : null}

        <div className="flex gap-2">
          <Button variant="ghost" onClick={onDone} disabled={busy}>
            Not now
          </Button>
          <Button className="flex-1" loading={busy} onClick={enable}>
            <Fingerprint className="size-4" aria-hidden />
            Enable quick unlock
          </Button>
        </div>
      </div>
    </Card>
  );
}

function WorkingNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="animate-fade flex items-center gap-3 rounded-[var(--radius-sm)] border border-line bg-surface px-3 py-2.5">
      <PixelLoader className="shrink-0" />
      <p className="text-[0.8125rem] leading-relaxed text-ink-muted" role="status">
        {children}
      </p>
    </div>
  );
}

function CreateFlow({ onBack }: { onBack: () => void }) {
  const { createVault, setupPending, completeSetup } = useVault();

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

  const passphraseValid = passphraseIsUsable(passphrase);
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
      // Whether this screen is ever seen is the provider's call: if a passkey
      // cannot be registered here, the workspace has already swapped this
      // flow out for the vault itself.
      setStep("passkey");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not create the vault. Try again.",
      );
      setSubmitting(false);
    }
  };

  if (step === "passkey" && setupPending) {
    return (
      <PasskeyOffer
        passphrase={passphrase}
        onDone={() => {
          setPassphrase("");
          setConfirmation("");
          completeSetup();
        }}
      />
    );
  }

  return (
    <>
      <StepIndicator step={step} />

      <Card className="mt-5 p-5 sm:mt-6 sm:p-8">
        {step === "intro" ? (
          <div className="space-y-6">
            <div className="space-y-3">
              <ShieldCheck className="size-6" aria-hidden />
              <h1 className="text-display text-2xl">Create your vault</h1>
              <p className="text-[0.9375rem] leading-relaxed text-ink-muted">
                Purbo is about to generate a 24-word recovery phrase in this browser. It
                is the root of your vault — everything you save is encrypted under it, and
                it is also what identifies you to the server.
              </p>
            </div>

            <Notice tone="caution" icon={<AlertTriangle className="size-4" />}>
              The phrase is never sent anywhere, so it cannot be re-sent to you. If you
              lose both the phrase and your passphrase, the vault cannot be opened by
              anyone, including us. Have paper and a pen ready.
            </Notice>

            <div className="flex gap-2">
              <Button variant="ghost" onClick={onBack}>
                <ArrowLeft className="size-4" aria-hidden />
                Back
              </Button>
              <Button className="flex-1" onClick={() => setStep("phrase")}>
                Generate recovery phrase
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            </div>
          </div>
        ) : null}

        {step === "phrase" ? (
          <div className="space-y-6">
            <div className="space-y-2">
              <h1 className="text-display text-2xl">Your recovery phrase</h1>
              <p className="text-[0.8125rem] leading-relaxed text-ink-muted">
                Write these 24 words down in order and store them somewhere physical. Do
                not photograph them, and do not put them in another password manager.
              </p>
            </div>

            <div className="relative">
              <ol
                // Remounted on reveal so the words arrive in sequence rather
                // than appearing all at once behind a lifting blur — the
                // ordering is the thing that has to be copied correctly.
                key={revealed ? "revealed" : "hidden"}
                className={cn(
                  "grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius)] border border-line bg-line raised sm:grid-cols-3",
                  revealed ? "stagger" : "blur-sm select-none",
                )}
                aria-hidden={!revealed}
              >
                {words.map((word, index) => (
                  <li
                    key={`${index}-${word}`}
                    style={{ "--stagger-index": index } as React.CSSProperties}
                    className="flex items-baseline gap-2 bg-elevated px-3 py-2.5"
                  >
                    <span className="w-5 shrink-0 text-right font-mono text-[0.6875rem] tabular-nums text-ink-subtle">
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
                  className="absolute inset-0 grid place-items-center rounded-[var(--radius)] bg-canvas/40"
                >
                  <span className="inline-flex items-center gap-2 rounded-full border border-line bg-elevated px-4 py-2 text-[0.8125rem] font-medium raised-float">
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

            {submitting ? (
              <WorkingNotice>
                Deriving your keys with Argon2id and sealing the vault. This happens
                entirely in this tab.
              </WorkingNotice>
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
    </>
  );
}

const STEPS: { id: Step; label: string }[] = [
  { id: "intro", label: "Brief" },
  { id: "phrase", label: "Phrase" },
  { id: "verify", label: "Verify" },
  { id: "passphrase", label: "Passphrase" },
];

/**
 * Progress with the destinations named.
 *
 * Four anonymous bars say how far along you are but not what is still coming,
 * and this particular flow has a step people must prepare for — writing down
 * 24 words. Naming the stages up front is the difference between reaching
 * that screen ready and reaching it looking for a pen.
 */
function StepIndicator({ step }: { step: Step }) {
  const current = STEPS.findIndex((item) => item.id === step);

  return (
    <div aria-label={`Step ${current + 1} of ${STEPS.length}`}>
      <ol className="flex items-center gap-2">
        {STEPS.map((item, index) => {
          const done = index < current;
          const active = index === current;

          return (
            <li key={item.id} className="flex-1" aria-current={active ? "step" : undefined}>
              <span
                className={cn(
                  "block h-0.5 rounded-full transition-colors duration-300",
                  done || active ? "bg-ink" : "bg-line",
                )}
              />
              <span
                className={cn(
                  "mt-2 block text-[0.6875rem] font-mono uppercase tracking-wide transition-colors",
                  active ? "text-ink" : "text-ink-subtle",
                )}
              >
                {item.label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
