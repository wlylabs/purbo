"use client";

import { Check, ClipboardPaste, Keyboard } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Input, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { BIP39_WORDLIST, normalisePhrase } from "@/lib/crypto/mnemonic";
import { randomInt } from "@/lib/crypto/primitives";
import { cn } from "@/lib/utils";

type Mode = "type" | "paste";

/** Enough to shorten the typing without turning the field into a word list. */
const MAX_SUGGESTIONS = 4;

/**
 * Confirming the user really has a copy of the phrase.
 *
 * What this can and cannot enforce is worth being clear about. Nothing here
 * can tell a phrase read off paper from one read off the previous screen —
 * the Back button has always allowed that, and removing it would only make
 * people screenshot the words instead. What it can do is catch the failure
 * that actually loses vaults: a copy that is wrong. A word transposed, a word
 * skipped, `flight` written where `flint` was shown.
 *
 * So there are two ways through, and the second checks more than the first:
 *
 *   Type three words   — the classic spot check. Fast, and enough to prove a
 *                        written copy is being read in the right order.
 *   Paste your copy    — validates all 24 words against all 24, and names the
 *                        positions that differ. Someone who saved the phrase
 *                        into a password manager retrieves it and gets a real
 *                        audit of their copy rather than a 12% sample.
 *
 * Everything is compared in memory against the phrase this browser just
 * generated. Nothing is sent anywhere, in either mode.
 */
export function PhraseVerify({
  words,
  onVerifiedChange,
}: {
  words: string[];
  /** Called whenever the verification state flips. */
  onVerifiedChange: (verified: boolean) => void;
}) {
  const [mode, setMode] = useState<Mode>("type");

  // Three positions, chosen once, so switching tabs does not reroll them.
  const challenge = useMemo(() => {
    const picked = new Set<number>();
    while (picked.size < 3) picked.add(randomInt(words.length));
    return [...picked].sort((a, b) => a - b);
  }, [words.length]);

  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [pasted, setPasted] = useState("");

  const typedOk = challenge.every(
    (index) => answers[index]?.trim().toLowerCase() === words[index],
  );

  const pastedWords = useMemo(() => {
    const trimmed = pasted.trim();
    return trimmed ? normalisePhrase(trimmed).split(" ") : [];
  }, [pasted]);

  /** Positions that differ, or null while the count is still wrong. */
  const mismatches = useMemo(() => {
    if (pastedWords.length !== words.length) return null;
    return words.reduce<number[]>((wrong, word, index) => {
      if (pastedWords[index] !== word) wrong.push(index);
      return wrong;
    }, []);
  }, [pastedWords, words]);

  const pastedOk = mismatches !== null && mismatches.length === 0;
  const verified = mode === "type" ? typedOk : pastedOk;

  useEffect(() => onVerifiedChange(verified), [verified, onVerifiedChange]);

  return (
    <div className="space-y-5">
      <Segmented
        name="verify"
        label="Ways to confirm your copy"
        fill
        items={[
          { id: "type", label: "Type words", icon: Keyboard },
          { id: "paste", label: "Paste copy", icon: ClipboardPaste },
        ]}
        value={mode}
        onChange={(next: Mode) => setMode(next)}
      />

      {mode === "type" ? (
        <div className="space-y-4">
          <p className="text-[0.8125rem] leading-relaxed text-ink-muted">
            Read these positions off your copy. Suggestions appear as you type — the phrase
            uses a fixed list of 2048 words, so a few letters is enough.
          </p>

          {challenge.map((index) => (
            <WordField
              key={index}
              position={index + 1}
              value={answers[index] ?? ""}
              expected={words[index]!}
              onChange={(value) =>
                setAnswers((current) => ({ ...current, [index]: value }))
              }
            />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[0.8125rem] leading-relaxed text-ink-muted">
            Paste the phrase back from wherever you saved it. All 24 words are checked against
            all 24 — this catches a word written in the wrong order or missed entirely, which a
            three-word spot check would sail past.
          </p>

          <Textarea
            label="Your saved phrase"
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            placeholder="word one two three …"
            rows={4}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="font-mono text-[0.8125rem]"
            error={
              mismatches && mismatches.length > 0
                ? `${mismatches.length === 1 ? "Word" : "Words"} ${mismatches
                    .map((index) => index + 1)
                    .join(", ")} ${mismatches.length === 1 ? "does" : "do"} not match what was shown.`
                : pastedWords.length > 0 && mismatches === null
                  ? `That is ${pastedWords.length} ${pastedWords.length === 1 ? "word" : "words"}, not ${words.length}.`
                  : null
            }
            hint={
              pastedOk
                ? "All 24 words match, in order."
                : "Nothing is sent anywhere — this is compared in the browser."
            }
          />

          {pastedOk ? (
            <p className="flex items-center gap-2 text-[0.8125rem] text-positive">
              <Check className="size-4 shrink-0" aria-hidden />
              Your copy is complete and correct.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * One word of the challenge, with the wordlist doing the typing.
 *
 * Twenty-four words is a lot to enter on a phone keyboard, and a mistyped one
 * reads as a failed verification rather than a typo. Prefix suggestions turn
 * each field into three or four taps and remove the ambiguity: BIP39 words are
 * uniquely identified by their first four letters by construction.
 */
function WordField({
  position,
  value,
  expected,
  onChange,
}: {
  position: number;
  value: string;
  expected: string;
  onChange: (value: string) => void;
}) {
  const normalised = value.trim().toLowerCase();
  const correct = normalised === expected;

  const suggestions = useMemo(() => {
    if (!normalised || correct) return [];
    const matches: string[] = [];
    for (const word of BIP39_WORDLIST) {
      if (word.startsWith(normalised)) matches.push(word);
      if (matches.length === MAX_SUGGESTIONS) break;
    }
    // A single exact match is already in the field; nothing to offer.
    return matches.length === 1 && matches[0] === normalised ? [] : matches;
  }, [normalised, correct]);

  return (
    <div className="space-y-2">
      <Input
        label={`Word ${position}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        inputMode="text"
        className="font-mono"
        error={normalised && !correct && suggestions.length === 0 ? "Not a word in the list." : null}
        hint={correct ? "Matches." : undefined}
      />

      {suggestions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((word) => (
            <button
              key={word}
              type="button"
              onClick={() => onChange(word)}
              className={cn(
                "rounded-full border border-line bg-elevated px-3 py-1 font-mono text-[0.75rem] text-ink-muted raised",
                "transition-[background-color,border-color,color,transform] duration-150",
                "hover:border-line-strong hover:text-ink active:translate-y-px",
              )}
            >
              {word}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
