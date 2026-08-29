"use client";

import { Star, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input, PasswordInput, Textarea } from "@/components/ui/input";
import { Chip, Modal, Notice, Reveal } from "@/components/ui/primitives";
import { isValidTotpInput } from "@/lib/crypto/totp";
import { normaliseTags } from "@/lib/vault/tags";
import type { VaultItem, VaultItemDraft } from "@/lib/vault/types";
import { copyWithAutoClear } from "@/lib/utils";
import { Generator } from "./generator";
import { StrengthMeter } from "./strength-meter";
import { TagInput } from "./tag-input";
import { TotpCode } from "./totp-code";

const EMPTY: VaultItemDraft = {
  name: "",
  username: "",
  password: "",
  url: "",
  notes: "",
  totp: "",
  tags: [],
};

export function ItemForm({
  open,
  item,
  tagSuggestions = [],
  onClose,
  onSave,
}: {
  open: boolean;
  /** Present when editing; absent when creating. */
  item?: VaultItem | null;
  /** Tags already used elsewhere in this vault, most-used first. */
  tagSuggestions?: string[];
  onClose: () => void;
  onSave: (draft: VaultItemDraft, id?: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<VaultItemDraft>(EMPTY);
  const [showGenerator, setShowGenerator] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed whenever the dialog opens so a previous entry's values never
  // linger in a form the user thinks is blank.
  useEffect(() => {
    if (!open) return;
    setDraft(
      item
        ? {
            name: item.name,
            username: item.username,
            password: item.password,
            url: item.url ?? "",
            notes: item.notes ?? "",
            totp: item.totp ?? "",
            tags: item.tags ?? [],
            favourite: item.favourite,
          }
        : EMPTY,
    );
    setShowGenerator(false);
    setError(null);
  }, [open, item]);

  const update = <K extends keyof VaultItemDraft>(key: K, value: VaultItemDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const totp = draft.totp?.trim() ?? "";
  // Checked as typed rather than only on submit: pasting a secret is where
  // this goes wrong, and finding out at save time means finding out after the
  // clipboard has moved on.
  const totpValid = useMemo(() => totp === "" || isValidTotpInput(totp), [totp]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.name.trim() || !draft.password || !totpValid) return;

    setSaving(true);
    setError(null);
    try {
      const tags = normaliseTags(draft.tags);
      await onSave(
        {
          ...draft,
          name: draft.name.trim(),
          username: draft.username.trim(),
          url: draft.url?.trim() || undefined,
          notes: draft.notes?.trim() || undefined,
          totp: totp || undefined,
          tags: tags.length > 0 ? tags : undefined,
          favourite: draft.favourite || undefined,
        },
        item?.id,
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this entry.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={item ? "Edit entry" : "New entry"}
      description="Encrypted in this browser before it is saved."
    >
      <form onSubmit={submit} className="space-y-5">
        <Input
          label="Name"
          value={draft.name}
          onChange={(event) => update("name", event.target.value)}
          placeholder="GitHub"
          required
          autoFocus
        />

        <Input
          label="Username or email"
          value={draft.username}
          onChange={(event) => update("username", event.target.value)}
          placeholder="you@example.com"
          autoComplete="off"
        />

        <div className="space-y-3">
          <PasswordInput
            label="Password"
            value={draft.password}
            onChange={(event) => update("password", event.target.value)}
            required
          />
          <StrengthMeter password={draft.password} />

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setShowGenerator((value) => !value)}
          >
            <Wand2 className="size-3.5" aria-hidden />
            {showGenerator ? "Hide generator" : "Generate a password"}
          </Button>

          {/* The generator unfolds under the button that asked for it and
              folds away again when a password is taken from it, so "Use"
              visibly hands the value up to the field rather than blinking the
              panel out of existence. */}
          <Reveal open={showGenerator}>
            <div className="rounded-[var(--radius-sm)] border border-line bg-surface p-4">
              <Generator
                compact
                onUse={(value) => {
                  update("password", value);
                  setShowGenerator(false);
                }}
              />
            </div>
          </Reveal>
        </div>

        <Input
          label="Website"
          value={draft.url ?? ""}
          onChange={(event) => update("url", event.target.value)}
          placeholder="github.com"
          inputMode="url"
          autoComplete="off"
        />

        {/* The second factor, kept with the first. Worth being plain about:
            a vault holding both is one thing to steal rather than two, and
            the trade is that a code within reach is a code people turn on. */}
        <div className="space-y-3">
          <Input
            label="Authenticator secret"
            value={draft.totp ?? ""}
            onChange={(event) => update("totp", event.target.value)}
            placeholder="JBSWY3DPEHPK3PXP or otpauth://totp/…"
            autoComplete="off"
            spellCheck={false}
            className="font-mono tracking-tight"
            error={totpValid ? null : "Not a base32 secret or an otpauth:// URI."}
            hint={
              totpValid
                ? "Optional. Paste the setup key a site shows beside its QR code — codes are computed on this device."
                : undefined
            }
          />
          {totp && totpValid ? (
            <TotpCode secret={totp} onCopy={(code) => copyWithAutoClear(code)} />
          ) : null}
        </div>

        <TagInput
          value={draft.tags ?? []}
          onChange={(tags) => update("tags", tags)}
          suggestions={tagSuggestions}
          disabled={saving}
        />

        <Textarea
          label="Notes"
          value={draft.notes ?? ""}
          onChange={(event) => update("notes", event.target.value)}
          placeholder="Recovery codes, security questions, anything else."
          rows={3}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Chip
            selected={draft.favourite === true}
            aria-pressed={draft.favourite === true}
            onClick={() => update("favourite", !draft.favourite)}
            disabled={saving}
          >
            <Star
              key={draft.favourite ? "on" : "off"}
              className={
                draft.favourite
                  ? "animate-pop mr-1.5 inline size-3.5 align-[-2px] fill-current"
                  : "mr-1.5 inline size-3.5 align-[-2px]"
              }
              aria-hidden
            />
            Favourite
          </Chip>
          <span className="text-xs text-ink-subtle">Keeps this entry at the top of the list.</span>
        </div>

        {error ? <Notice tone="critical">{error}</Notice> : null}

        <div className="flex gap-2 border-t border-line pt-5">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="submit"
            className="flex-1"
            loading={saving}
            disabled={!draft.name.trim() || !draft.password || !totpValid}
          >
            {item ? "Save changes" : "Add entry"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
