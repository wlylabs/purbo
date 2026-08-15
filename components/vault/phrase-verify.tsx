"use client";

import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { BIP39_WORDLIST } from "@/lib/crypto/mnemonic";
import { randomInt } from "@/lib/crypto/primitives";
import { cn } from "@/lib/utils";

/** Enough to shorten the typing without turning the field into a word list. */
const MAX_SUGGESTIONS = 4;

/**
 * Confirming the user really has a copy of the phrase.
 *
 * Three positions, chosen at random, typed back. What this can enforce is
 * worth being clear about: nothing here can tell a phrase read off paper from
 * one read off the previous screen — the Back button has always allowed that,
 * and removing it would only get people to screenshot the words instead. What
 * it does catch is the failure that actually loses vaults, a copy written down
 * wrong: a word transposed, a word skipped, `flight` where `flint` was shown.
 *
 * The comparison happens in memory against the phrase this browser just
 * generated. Nothing is sent anywhere.
 */
export function PhraseVerify({
  words,
  onVerifiedChange,
}: {
  words: string[];
  /** Called whenever the verification state flips. */
  onVerifiedChange: (verified: boolean) => void;
}) {
  const challenge = useMemo(() => {
    const picked = new Set<number>();
    while (picked.size < 3) picked.add(randomInt(words.length));
    return [...picked].sort((a, b) => a - b);
  }, [words.length]);

  const [answers, setAnswers] = useState<Record<number, string>>({});

  const update = (index: number, value: string) => {
    const next = { ...answers, [index]: value };
    setAnswers(next);
    onVerifiedChange(
      challenge.every(
        (position) => next[position]?.trim().toLowerCase() === words[position],
      ),
    );
  };

  return (
    <div className="space-y-4">
      <p className="text-[0.8125rem] leading-relaxed text-ink-muted">
        Read these positions off your copy. Suggestions appear as you type — the phrase uses a
        fixed list of 2048 words, so a few letters is enough.
      </p>

      {challenge.map((index) => (
        <WordField
          key={index}
          position={index + 1}
          value={answers[index] ?? ""}
          expected={words[index]!}
          onChange={(value) => update(index, value)}
        />
      ))}
    </div>
  );
}

/**
 * One word of the challenge, with the wordlist doing the typing.
 *
 * Entering words on a phone keyboard is where this step goes wrong, and a
 * mistyped word reads as a failed verification rather than as a typo. Prefix
 * suggestions turn each field into three or four taps and remove the
 * ambiguity: BIP39 words are uniquely identified by their first four letters
 * by construction.
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
  const correct = normalised.length > 0 && normalised === expected;
  // Red the moment typing diverges from the expected word, not only once a
  // full word lands — that live signal is what replaces flipping back to the
  // previous screen (or a copy sitting in another tab) to re-check by eye.
  const wrong = normalised.length > 0 && !correct && !expected.startsWith(normalised);

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
        className={cn(
          "font-mono",
          correct && "border-positive/40 bg-positive/5",
          wrong && "border-critical/40 bg-critical/5",
        )}
        error={
          normalised && !correct && suggestions.length === 0 ? "Not a word in the list." : null
        }
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
