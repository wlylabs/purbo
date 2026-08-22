/**
 * Tags, kept deliberately thin.
 *
 * A tag is a label inside the entry's ciphertext, not a structure the server
 * knows about — there is no folder record, no tag index, nothing for the
 * server to count but the same opaque blobs it already held. That rules out
 * hierarchy: a tree needs somewhere to live and something to keep consistent,
 * and neither can exist outside a decrypted vault without telling the server
 * how the user organises their life.
 */

import type { VaultItem } from "./types";

/** Long enough for "work · shared", short enough to stay a chip. */
export const MAX_TAG_LENGTH = 24;
/** Beyond this a tag list is a notes field wearing a costume. */
export const MAX_TAGS_PER_ITEM = 12;

/**
 * One canonical spelling per tag.
 *
 * Case and inner whitespace are collapsed so "Work", "work" and "work " are
 * one tag rather than three that filter differently — the failure mode of
 * every free-text tag field that skips this step.
 */
export function normaliseTag(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_TAG_LENGTH);
}

function tagKey(value: string): string {
  return value.toLocaleLowerCase();
}

/** Normalises, drops blanks and case-duplicates, and caps the count. */
export function normaliseTags(values: readonly string[] | undefined): string[] {
  if (!values) return [];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of values) {
    const tag = normaliseTag(raw);
    if (!tag) continue;
    const key = tagKey(tag);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS_PER_ITEM) break;
  }

  return out;
}

/** Appends a tag if it is new. Returns the same array when nothing changed. */
export function addTag(tags: readonly string[], value: string): string[] {
  const tag = normaliseTag(value);
  if (!tag) return [...tags];
  if (tags.some((existing) => tagKey(existing) === tagKey(tag))) return [...tags];
  if (tags.length >= MAX_TAGS_PER_ITEM) return [...tags];
  return [...tags, tag];
}

export function removeTag(tags: readonly string[], value: string): string[] {
  return tags.filter((existing) => tagKey(existing) !== tagKey(value));
}

export function hasTag(item: Pick<VaultItem, "tags">, value: string): boolean {
  return (item.tags ?? []).some((existing) => tagKey(existing) === tagKey(value));
}

/**
 * Every tag in the vault, most-used first, then alphabetically.
 *
 * Frequency ordering is what makes the filter row useful without a scroll: the
 * tags someone actually files things under sit at the front, and the one they
 * used once a year ago sits at the back where it belongs.
 */
export function collectTags(items: readonly VaultItem[]): { tag: string; count: number }[] {
  const counts = new Map<string, { tag: string; count: number }>();

  for (const item of items) {
    for (const tag of item.tags ?? []) {
      const key = tagKey(tag);
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { tag, count: 1 });
    }
  }

  return [...counts.values()].sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag),
  );
}

/** Splits a comma- or semicolon-separated list, as an import file writes them. */
export function parseTagList(value: string): string[] {
  return normaliseTags(value.split(/[,;]/));
}
