/**
 * Reading someone else's export.
 *
 * Every byte of this runs in the browser, on a file the user picked, and what
 * comes out the far end goes straight into the same AES-GCM boxes everything
 * else lives in. Nothing is uploaded to be parsed — an import that posted a
 * plaintext CSV to a server "just to read the columns" would give away in one
 * request exactly what the rest of this app exists to protect.
 *
 * The formats here are the ones people actually arrive with: Purbo's own
 * export, Bitwarden's JSON and CSV, 1Password, LastPass, Chrome, and the
 * long tail of spreadsheets with a header row that means well.
 */

import { isValidTotpInput } from "@/lib/crypto/totp";
import { normaliseTags, parseTagList } from "./tags";
import type { VaultItem, VaultItemDraft } from "./types";

export type ImportFormat = "purbo-json" | "bitwarden-json" | "csv";

export interface ImportResult {
  entries: VaultItemDraft[];
  /** Rows that were understood but carry nothing this vault can store. */
  skipped: number;
  format: ImportFormat;
}

export class UnrecognisedImportError extends Error {
  constructor(message = "This file is not a password export Purbo can read.") {
    super(message);
    this.name = "UnrecognisedImportError";
  }
}

/** Bigger than any personal vault, small enough to parse without freezing. */
const MAX_ROWS = 20_000;

// --------------------------------------------------------------------- CSV

/**
 * RFC 4180, including the parts people forget.
 *
 * Quoted fields may hold commas, doubled quotes and newlines — and notes
 * fields routinely hold all three, which is exactly why splitting on `,` and
 * hoping is not good enough for a file the user is trusting with their
 * passwords.
 */
export function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let started = false;

  // A BOM survives every round-trip through a spreadsheet and would otherwise
  // become part of the first header's name.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const endField = () => {
    row.push(field);
    field = "";
    started = false;
  };

  const endRow = () => {
    endField();
    // A trailing newline is not an empty record.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && !started) {
      quoted = true;
      started = true;
    } else if (char === delimiter) {
      endField();
    } else if (char === "\n") {
      endRow();
    } else if (char === "\r") {
      // CRLF: the \n does the work.
    } else {
      field += char;
      started = true;
    }
  }

  if (quoted) throw new UnrecognisedImportError("The file ends inside a quoted value.");
  if (field !== "" || row.length > 0) endRow();

  return rows;
}

/**
 * Which delimiter this file actually uses.
 *
 * Locales that use a comma as the decimal separator export semicolon-separated
 * "CSV", and a French or Indonesian Excel is a completely ordinary place for a
 * password export to come from.
 */
function detectDelimiter(text: string): string {
  const start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const firstLine = text.slice(start).split(/\r?\n/)[0] ?? "";
  const counts = [",", ";", "\t"].map((candidate) => ({
    candidate,
    count: firstLine.split(candidate).length - 1,
  }));
  counts.sort((a, b) => b.count - a.count);
  return counts[0]!.count > 0 ? counts[0]!.candidate : ",";
}

/** Header aliases, in the spellings the common exporters actually emit. */
const COLUMNS = {
  name: ["name", "title", "item name", "display name", "account name", "entry"],
  username: ["username", "user name", "login_username", "login", "user", "email", "e-mail", "userid"],
  password: ["password", "login_password", "pass", "pwd"],
  url: ["url", "uri", "login_uri", "website", "web site", "site", "link", "hostname"],
  notes: ["notes", "note", "comment", "comments", "extra", "description"],
  totp: ["totp", "otp", "otpauth", "login_totp", "one-time password", "authenticator key", "2fa"],
  tags: ["tags", "tag", "folder", "grouping", "category", "group", "collection"],
  favourite: ["favourite", "favorite", "fav", "starred"],
} as const;

type ColumnKey = keyof typeof COLUMNS;

function headerKey(value: string): string {
  return value.trim().toLowerCase().replace(/["']/g, "");
}

function mapHeaders(header: string[]): Partial<Record<ColumnKey, number>> {
  const mapping: Partial<Record<ColumnKey, number>> = {};

  header.forEach((raw, index) => {
    const key = headerKey(raw);
    for (const [column, aliases] of Object.entries(COLUMNS) as [ColumnKey, readonly string[]][]) {
      // First match wins. Exports routinely carry two columns that both
      // qualify — a `notes` beside an `extra` — and the leftmost is the one
      // the exporter treats as primary.
      if (mapping[column] === undefined && aliases.includes(key)) mapping[column] = index;
    }
  });

  return mapping;
}

function truthy(value: string | undefined): boolean {
  if (!value) return false;
  const normalised = value.trim().toLowerCase();
  return normalised === "1" || normalised === "true" || normalised === "yes" || normalised === "y";
}

function importCsv(text: string): ImportResult {
  const rows = parseCsv(text, detectDelimiter(text));
  if (rows.length < 2) throw new UnrecognisedImportError("The file has no rows to import.");

  const [header, ...body] = rows as [string[], ...string[][]];
  const mapping = mapHeaders(header);

  if (mapping.password === undefined && mapping.totp === undefined) {
    throw new UnrecognisedImportError(
      "No password column was found. Expected a header row naming one.",
    );
  }

  const entries: VaultItemDraft[] = [];
  let skipped = 0;

  for (const row of body.slice(0, MAX_ROWS)) {
    const at = (column: ColumnKey) => {
      const index = mapping[column];
      return index === undefined ? undefined : row[index];
    };

    const draft = buildDraft({
      name: at("name"),
      username: at("username"),
      password: at("password"),
      url: at("url"),
      notes: at("notes"),
      totp: at("totp"),
      tags: at("tags") ? parseTagList(at("tags")!) : undefined,
      favourite: truthy(at("favourite")),
    });

    if (draft) entries.push(draft);
    else if (row.some((cell) => cell.trim() !== "")) skipped++;
  }

  return { entries, skipped, format: "csv" };
}

// -------------------------------------------------------------------- JSON

interface LooseRecord {
  [key: string]: unknown;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function importBitwardenJson(items: LooseRecord[]): ImportResult {
  const entries: VaultItemDraft[] = [];
  let skipped = 0;

  for (const item of items.slice(0, MAX_ROWS)) {
    const login = (item.login ?? {}) as LooseRecord;
    const uris = Array.isArray(login.uris) ? (login.uris as LooseRecord[]) : [];

    const draft = buildDraft({
      name: asString(item.name),
      username: asString(login.username),
      password: asString(login.password),
      url: asString(uris[0]?.uri),
      notes: asString(item.notes),
      totp: asString(login.totp),
      favourite: item.favorite === true,
    });

    if (draft) entries.push(draft);
    else skipped++;
  }

  return { entries, skipped, format: "bitwarden-json" };
}

function importPurboJson(items: LooseRecord[]): ImportResult {
  const entries: VaultItemDraft[] = [];
  let skipped = 0;

  for (const item of items.slice(0, MAX_ROWS)) {
    const draft = buildDraft({
      name: asString(item.name),
      username: asString(item.username),
      password: asString(item.password),
      url: asString(item.url),
      notes: asString(item.notes),
      totp: asString(item.totp),
      tags: Array.isArray(item.tags) ? (item.tags as unknown[]).filter(isString) : undefined,
      favourite: item.favourite === true,
    });

    if (draft) entries.push(draft);
    else skipped++;
  }

  return { entries, skipped, format: "purbo-json" };
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

// ------------------------------------------------------------------ shared

/**
 * One row, turned into something this vault can hold — or nothing at all.
 *
 * An entry with no name or no password is not an entry here; importing it
 * would produce a nameless row the user cannot search for, holding a secret
 * that is not there. Those are counted and reported rather than invented into
 * shape.
 */
function buildDraft(fields: {
  name?: string;
  username?: string;
  password?: string;
  url?: string;
  notes?: string;
  totp?: string;
  tags?: string[];
  favourite?: boolean;
}): VaultItemDraft | null {
  const name = fields.name?.trim() ?? "";
  const password = fields.password ?? "";
  if (!name || !password) return null;

  const totp = fields.totp?.trim();
  const tags = normaliseTags(fields.tags);

  return {
    name,
    username: fields.username?.trim() ?? "",
    password,
    url: fields.url?.trim() || undefined,
    notes: fields.notes?.trim() || undefined,
    // A secret that will not produce codes is dropped rather than stored: it
    // would sit in the entry looking like a working second factor.
    totp: totp && isValidTotpInput(totp) ? totp : undefined,
    tags: tags.length > 0 ? tags : undefined,
    favourite: fields.favourite || undefined,
  };
}

/** Reads an export file. Throws `UnrecognisedImportError` on anything else. */
export function parseVaultImport(text: string): ImportResult {
  const trimmed = text.trim();
  if (!trimmed) throw new UnrecognisedImportError("The file is empty.");

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new UnrecognisedImportError("The file looks like JSON but could not be parsed.");
    }

    const items = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as LooseRecord).items)
        ? ((parsed as LooseRecord).items as unknown[])
        : null;

    if (!items) throw new UnrecognisedImportError("No entry list was found in this file.");

    const records = items.filter(
      (item): item is LooseRecord => typeof item === "object" && item !== null,
    );

    // Bitwarden nests the credentials under `login`; Purbo keeps them flat.
    const bitwarden = records.some((item) => typeof item.login === "object" && item.login !== null);
    return bitwarden ? importBitwardenJson(records) : importPurboJson(records);
  }

  return importCsv(trimmed);
}

/**
 * What is genuinely new.
 *
 * Same name and same username is the only comparison worth making: matching
 * on the password would treat a rotated credential as a different account,
 * and matching on the name alone would collapse two accounts on one site —
 * which is the case people import twice by accident precisely because they
 * have it.
 */
export function partitionDuplicates(
  existing: readonly VaultItem[],
  incoming: readonly VaultItemDraft[],
): { fresh: VaultItemDraft[]; duplicates: VaultItemDraft[] } {
  const key = (item: { name: string; username: string }) =>
    `${item.name.trim().toLowerCase()}\u0000${item.username.trim().toLowerCase()}`;

  const seen = new Set(existing.map(key));
  const fresh: VaultItemDraft[] = [];
  const duplicates: VaultItemDraft[] = [];

  for (const draft of incoming) {
    const id = key(draft);
    // Duplicates within the file itself count too — an export merged from two
    // sources is the usual way one file holds the same login twice.
    if (seen.has(id)) duplicates.push(draft);
    else {
      seen.add(id);
      fresh.push(draft);
    }
  }

  return { fresh, duplicates };
}
