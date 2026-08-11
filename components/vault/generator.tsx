"use client";

import { Check, Copy, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/primitives";
import { BIP39_WORDLIST } from "@/lib/crypto/mnemonic";
import {
  DEFAULT_GENERATOR_OPTIONS,
  MAX_LENGTH,
  MIN_LENGTH,
  generatePassphrase,
  generatePassword,
  generatorEntropyBits,
  type GeneratorOptions,
} from "@/lib/crypto/password";
import { cn, copyWithAutoClear } from "@/lib/utils";
import { StrengthMeter } from "./strength-meter";

type Mode = "password" | "passphrase";

const TOGGLES: { key: keyof GeneratorOptions; label: string }[] = [
  { key: "uppercase", label: "A-Z" },
  { key: "lowercase", label: "a-z" },
  { key: "digits", label: "0-9" },
  { key: "symbols", label: "!@#" },
];

export function Generator({
  onUse,
  compact = false,
}: {
  /** Rendered as a "use this" action when supplied. */
  onUse?: (value: string) => void;
  compact?: boolean;
}) {
  const [mode, setMode] = useState<Mode>("password");
  const [options, setOptions] = useState<GeneratorOptions>(DEFAULT_GENERATOR_OPTIONS);
  const [wordCount, setWordCount] = useState(5);
  const [value, setValue] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const regenerate = useCallback(() => {
    try {
      setValue(
        mode === "password"
          ? generatePassword(options)
          : generatePassphrase(BIP39_WORDLIST, wordCount),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate a password.");
    }
  }, [mode, options, wordCount]);

  useEffect(regenerate, [regenerate]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const entropy = useMemo(
    () =>
      mode === "password"
        ? Math.round(generatorEntropyBits(options))
        : // log2(2048) = 11 bits per BIP39 word.
          Math.round(wordCount * Math.log2(BIP39_WORDLIST.length)),
    [mode, options, wordCount],
  );

  const toggle = (key: keyof GeneratorOptions) => {
    setOptions((current) => {
      const next = { ...current, [key]: !current[key] };
      // Refuse to empty the alphabet — the generator would have nothing to
      // draw from, and a disabled-everything state is never what was meant.
      const anySelected = next.lowercase || next.uppercase || next.digits || next.symbols;
      return anySelected ? next : current;
    });
  };

  const copy = async () => {
    try {
      await copyWithAutoClear(value);
      setCopied(true);
    } catch {
      setError("Clipboard access was blocked by the browser.");
    }
  };

  return (
    <Card className={cn("overflow-hidden", compact && "border-0 bg-transparent")}>
      {!compact ? (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[0.9375rem] font-semibold tracking-tight">Generator</h2>
            <p className="mt-0.5 text-xs text-ink-subtle">
              Uniform sampling from WebCrypto entropy
            </p>
          </div>
          <span className="font-mono text-[0.6875rem] text-ink-subtle">{entropy} bits</span>
        </header>
      ) : null}

      <div className={cn("space-y-5", compact ? "" : "p-5")}>
        <div className="inline-flex w-full rounded-[var(--radius-sm)] border border-line p-0.5">
          {(["password", "passphrase"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setMode(option)}
              aria-pressed={mode === option}
              className={cn(
                "flex-1 rounded-[calc(var(--radius-sm)-2px)] px-3 py-1.5 text-[0.8125rem] font-medium capitalize transition-colors",
                mode === option
                  ? "bg-invert-bg text-invert-fg"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              {option}
            </button>
          ))}
        </div>

        <div className="rounded-[var(--radius-sm)] border border-line bg-surface p-3">
          <output
            className="block break-all font-mono text-[0.9375rem] leading-relaxed text-ink"
            aria-live="polite"
          >
            {value || "—"}
          </output>
        </div>

        <StrengthMeter password={value} />

        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={regenerate} className="flex-1">
            <RefreshCw className="size-3.5" aria-hidden />
            Regenerate
          </Button>
          <Button variant="secondary" size="sm" onClick={copy} className="flex-1">
            {copied ? (
              <Check className="size-3.5 text-positive" aria-hidden />
            ) : (
              <Copy className="size-3.5" aria-hidden />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
          {onUse ? (
            <Button size="sm" onClick={() => onUse(value)} className="flex-1">
              Use
            </Button>
          ) : null}
        </div>

        {error ? <p className="text-xs text-critical">{error}</p> : null}

        {mode === "password" ? (
          <div className="space-y-4 border-t border-line pt-5">
            <div>
              <div className="flex items-baseline justify-between">
                <label htmlFor="gen-length" className="text-[0.8125rem] font-medium">
                  Length
                </label>
                <span className="font-mono text-[0.8125rem] text-ink-muted">
                  {options.length}
                </span>
              </div>
              <input
                id="gen-length"
                type="range"
                min={MIN_LENGTH}
                max={MAX_LENGTH}
                value={options.length}
                onChange={(event) =>
                  setOptions((current) => ({ ...current, length: Number(event.target.value) }))
                }
                className="mt-2.5 w-full accent-[var(--ink)]"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {TOGGLES.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggle(key)}
                  aria-pressed={Boolean(options[key])}
                  className={cn(
                    "rounded-[var(--radius-sm)] border px-3 py-1.5 font-mono text-xs transition-colors",
                    options[key]
                      ? "border-ink bg-invert-bg text-invert-fg"
                      : "border-line text-ink-subtle hover:border-line-strong hover:text-ink",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <label className="flex cursor-pointer items-center gap-2.5 text-[0.8125rem] text-ink-muted">
              <input
                type="checkbox"
                checked={options.excludeAmbiguous}
                onChange={(event) =>
                  setOptions((current) => ({
                    ...current,
                    excludeAmbiguous: event.target.checked,
                  }))
                }
                className="size-4 accent-[var(--ink)]"
              />
              Exclude look-alike characters (I l 1 O 0)
            </label>
          </div>
        ) : (
          <div className="border-t border-line pt-5">
            <div className="flex items-baseline justify-between">
              <label htmlFor="gen-words" className="text-[0.8125rem] font-medium">
                Words
              </label>
              <span className="font-mono text-[0.8125rem] text-ink-muted">{wordCount}</span>
            </div>
            <input
              id="gen-words"
              type="range"
              min={3}
              max={12}
              value={wordCount}
              onChange={(event) => setWordCount(Number(event.target.value))}
              className="mt-2.5 w-full accent-[var(--ink)]"
            />
            <p className="mt-2 text-xs text-ink-subtle">
              Drawn from the 2048-word BIP39 list — about 11 bits per word.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
