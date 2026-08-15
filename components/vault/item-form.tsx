"use client";

import { Wand2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input, PasswordInput, Textarea } from "@/components/ui/input";
import { Modal, Notice } from "@/components/ui/primitives";
import type { VaultItem, VaultItemDraft } from "@/lib/vault/types";
import { Generator } from "./generator";
import { StrengthMeter } from "./strength-meter";

const EMPTY: VaultItemDraft = {
  name: "",
  username: "",
  password: "",
  url: "",
  notes: "",
};

export function ItemForm({
  open,
  item,
  onClose,
  onSave,
}: {
  open: boolean;
  /** Present when editing; absent when creating. */
  item?: VaultItem | null;
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
            favourite: item.favourite,
          }
        : EMPTY,
    );
    setShowGenerator(false);
    setError(null);
  }, [open, item]);

  const update = <K extends keyof VaultItemDraft>(key: K, value: VaultItemDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.name.trim() || !draft.password) return;

    setSaving(true);
    setError(null);
    try {
      await onSave(
        {
          ...draft,
          name: draft.name.trim(),
          username: draft.username.trim(),
          url: draft.url?.trim() || undefined,
          notes: draft.notes?.trim() || undefined,
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

          {showGenerator ? (
            <div className="rounded-[var(--radius-sm)] border border-line bg-surface p-4">
              <Generator
                compact
                onUse={(value) => {
                  update("password", value);
                  setShowGenerator(false);
                }}
              />
            </div>
          ) : null}
        </div>

        <Input
          label="Website"
          value={draft.url ?? ""}
          onChange={(event) => update("url", event.target.value)}
          placeholder="github.com"
          inputMode="url"
          autoComplete="off"
        />

        <Textarea
          label="Notes"
          value={draft.notes ?? ""}
          onChange={(event) => update("notes", event.target.value)}
          placeholder="Recovery codes, security questions, anything else."
          rows={3}
        />

        {error ? <Notice tone="critical">{error}</Notice> : null}

        <div className="flex gap-2 border-t border-line pt-5">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="submit"
            className="flex-1"
            loading={saving}
            disabled={!draft.name.trim() || !draft.password}
          >
            {item ? "Save changes" : "Add entry"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
