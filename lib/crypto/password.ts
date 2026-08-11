/**
 * Password generation and strength estimation.
 *
 * Generation is uniform over the selected alphabet via rejection sampling
 * (`randomInt`), never `Math.random` and never `% alphabet.length` on a raw
 * byte — modulo bias on a 62-character set measurably skews the first few
 * characters, which is exactly the kind of structure a cracking rig exploits.
 */

import { randomInt, secureShuffle } from "./primitives";

export const CHARSETS = {
  lowercase: "abcdefghijklmnopqrstuvwxyz",
  uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{};:,.?/~",
} as const;

/** Characters that are easy to confuse when read aloud or off a screen. */
const AMBIGUOUS = new Set("Il1O0o|`'\"{}[]()/\\~,;:.<>".split(""));

export interface GeneratorOptions {
  length: number;
  lowercase: boolean;
  uppercase: boolean;
  digits: boolean;
  symbols: boolean;
  /** Drop visually ambiguous characters (Il1O0 …). */
  excludeAmbiguous: boolean;
}

export const DEFAULT_GENERATOR_OPTIONS: GeneratorOptions = {
  length: 20,
  lowercase: true,
  uppercase: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: false,
};

export const MIN_LENGTH = 8;
export const MAX_LENGTH = 128;

function buildPools(options: GeneratorOptions): string[] {
  const filter = (set: string) =>
    options.excludeAmbiguous
      ? set
          .split("")
          .filter((ch) => !AMBIGUOUS.has(ch))
          .join("")
      : set;

  const pools: string[] = [];
  if (options.lowercase) pools.push(filter(CHARSETS.lowercase));
  if (options.uppercase) pools.push(filter(CHARSETS.uppercase));
  if (options.digits) pools.push(filter(CHARSETS.digits));
  if (options.symbols) pools.push(filter(CHARSETS.symbols));
  return pools.filter((pool) => pool.length > 0);
}

/**
 * Generates a password that contains at least one character from every
 * selected class.
 *
 * Guaranteeing one of each costs a sliver of entropy versus pure uniform
 * sampling, but it is what stops the output from being rejected by sites
 * with composition rules. The guaranteed picks are shuffled into random
 * positions so their placement carries no information.
 */
export function generatePassword(options: GeneratorOptions): string {
  const length = Math.min(Math.max(Math.trunc(options.length), MIN_LENGTH), MAX_LENGTH);
  const pools = buildPools(options);
  if (pools.length === 0) {
    throw new Error("Select at least one character set.");
  }

  const chars: string[] = [];
  for (const pool of pools) {
    if (chars.length < length) chars.push(pool[randomInt(pool.length)]!);
  }

  const combined = pools.join("");
  while (chars.length < length) {
    chars.push(combined[randomInt(combined.length)]!);
  }

  return secureShuffle(chars).join("");
}

/** A memorable passphrase drawn from the BIP39 wordlist (~11 bits/word). */
export function generatePassphrase(
  wordlist: readonly string[],
  wordCount = 5,
  separator = "-",
  capitalise = true,
): string {
  const words: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    const word = wordlist[randomInt(wordlist.length)]!;
    words.push(capitalise ? word[0]!.toUpperCase() + word.slice(1) : word);
  }
  return words.join(separator);
}

/**
 * Shannon entropy of the *generator*, in bits — log2(alphabet^length).
 *
 * This is an honest number only for machine-generated passwords. For text a
 * human typed, `estimateStrength` below applies pattern penalties instead,
 * because "Password123!" has a 94-character alphabet and roughly no entropy.
 */
export function generatorEntropyBits(options: GeneratorOptions): number {
  const pools = buildPools(options);
  const alphabet = pools.reduce((n, p) => n + p.length, 0);
  if (alphabet <= 1) return 0;
  return Math.log2(alphabet) * options.length;
}

export type StrengthLabel = "very-weak" | "weak" | "fair" | "strong" | "excellent";

export interface StrengthResult {
  bits: number;
  label: StrengthLabel;
  /** 0–4, for meter rendering. */
  score: number;
  /** Human-readable crack-time estimate at 10^11 guesses/sec offline. */
  crackTime: string;
  warnings: string[];
}

/** ~100 billion guesses/sec: a well-funded offline attack on a fast hash. */
const GUESSES_PER_SECOND = 1e11;

const COMMON_PATTERNS: { re: RegExp; penalty: number; warning: string }[] = [
  {
    re: /^(?:password|passw0rd|letmein|welcome|admin|qwerty|iloveyou|monkey|dragon|abc123)/i,
    penalty: 24,
    warning: "Starts with a password found in every breach wordlist.",
  },
  {
    re: /(.)\1{2,}/,
    penalty: 8,
    warning: "Contains a repeated character run.",
  },
  {
    re: /(?:0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef|qwer|asdf|zxcv)/i,
    penalty: 10,
    warning: "Contains a keyboard or numeric sequence.",
  },
  {
    re: /(?:19|20)\d{2}$/,
    penalty: 6,
    warning: "Ends with something that looks like a year.",
  },
];

/** log2 of the binomial coefficient, summed in log space to avoid overflow. */
function log2Binomial(n: number, k: number): number {
  if (k <= 0 || k >= n) return 0;
  const chosen = Math.min(k, n - k);
  let bits = 0;
  for (let i = 1; i <= chosen; i++) {
    bits += Math.log2(n - chosen + i) - Math.log2(i);
  }
  return bits;
}

function alphabetSizeOf(password: string): number {
  let size = 0;
  if (/[a-z]/.test(password)) size += 26;
  if (/[A-Z]/.test(password)) size += 26;
  if (/[0-9]/.test(password)) size += 10;
  if (/[^A-Za-z0-9]/.test(password)) size += 33;
  return size;
}

function formatCrackTime(bits: number): string {
  if (bits <= 0) return "instantly";
  // Expected work is half the keyspace.
  const seconds = Math.pow(2, Math.min(bits, 1024)) / 2 / GUESSES_PER_SECOND;
  if (seconds < 1) return "instantly";
  const units: [number, string, string][] = [
    [60, "second", "seconds"],
    [60, "minute", "minutes"],
    [24, "hour", "hours"],
    [365, "day", "days"],
    [100, "year", "years"],
    [1e3, "century", "centuries"],
  ];

  let value = seconds;
  let [, singular, plural] = units[0]!;
  for (const [factor, one, many] of units) {
    singular = one;
    plural = many;
    if (value < factor) break;
    value /= factor;
  }

  // Past a few million centuries the exact figure stops meaning anything;
  // say so rather than printing an exponent the reader has to parse.
  if (value >= 1e6) return `far longer than the age of the universe`;

  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded.toLocaleString()} ${rounded === 1 ? singular : plural}`;
}

/**
 * Heuristic strength estimate for human-entered passwords.
 *
 * Deliberately conservative: it starts from raw alphabet entropy, then
 * subtracts for the patterns real crackers enumerate first. It is a UI hint,
 * not a security guarantee — the vault's actual resistance comes from
 * Argon2id, not from this score.
 */
export function estimateStrength(password: string): StrengthResult {
  if (!password) {
    return { bits: 0, label: "very-weak", score: 0, crackTime: "instantly", warnings: [] };
  }

  const alphabet = alphabetSizeOf(password);
  let bits = alphabet > 1 ? Math.log2(alphabet) * password.length : 0;
  const warnings: string[] = [];

  for (const { re, penalty, warning } of COMMON_PATTERNS) {
    if (re.test(password)) {
      bits -= penalty;
      warnings.push(warning);
    }
  }

  // A password built from few distinct characters has less real entropy than
  // its length suggests. Cap it by the size of the space it actually occupies:
  // choosing which `d` symbols are used, then arranging `length` of them.
  //
  //   bits <= log2(C(alphabet, d)) + length * log2(d)
  //
  // The first term matters — dropping it would penalise every password whose
  // length is near its distinct-character count, which is the normal case for
  // a randomly generated one.
  const distinct = new Set(password.split("")).size;
  const occupancyBits =
    log2Binomial(Math.max(alphabet, distinct), distinct) + password.length * Math.log2(distinct);
  bits = Math.min(bits, occupancyBits);

  if (password.length < 12) {
    warnings.push("Under 12 characters — short enough to brute-force offline.");
  }

  bits = Math.max(0, Math.round(bits));

  let label: StrengthLabel;
  let score: number;
  if (bits < 40) {
    label = "very-weak";
    score = 0;
  } else if (bits < 60) {
    label = "weak";
    score = 1;
  } else if (bits < 80) {
    label = "fair";
    score = 2;
  } else if (bits < 110) {
    label = "strong";
    score = 3;
  } else {
    label = "excellent";
    score = 4;
  }

  return { bits, label, score, crackTime: formatCrackTime(bits), warnings };
}

export const STRENGTH_LABELS: Record<StrengthLabel, string> = {
  "very-weak": "Very weak",
  weak: "Weak",
  fair: "Fair",
  strong: "Strong",
  excellent: "Excellent",
};
