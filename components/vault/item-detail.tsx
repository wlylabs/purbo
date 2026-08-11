"use client";

import { Check, Copy, ExternalLink, Eye, EyeOff, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Modal, Notice, Separator } from "@/components/ui/primitives";
import type { VaultItem } from "@/lib/vault/types";
import { copyWithAutoClear, formatRelativeTime, safeExternalUrl } from "@/lib/utils";
import { StrengthMeter } from "./strength-meter";

function CopyField({
  label,
  value,
  secret = false,
}: {
  label: string;
  value: string;
  secret?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await copyWithAutoClear(value);
      setCopied(true);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };

  return (
    <div className="space-y-1.5">
      <p className="text-label">{label}</p>
      <div className="flex items-center gap-2">
        <p
          className={`min-w-0 flex-1 truncate text-[0.9375rem] ${
            secret ? "font-mono tracking-tight" : ""
          }`}
        >
          {secret && !revealed ? "•".repeat(Math.min(value.length, 24)) : value || "—"}
        </p>
        {secret ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setRevealed((current) => !current)}
            aria-label={revealed ? `Hide ${label}` : `Show ${label}`}
          >
            {revealed ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          </Button>
        ) : null}
        <Button variant="ghost" size="icon" onClick={copy} aria-label={`Copy ${label}`}>
          {copied ? (
            <Check className="size-4 text-positive" aria-hidden />
          ) : (
            <Copy className="size-4" aria-hidden />
          )}
        </Button>
      </div>
      {failed ? (
        <p className="text-[0.6875rem] text-critical">Clipboard access was blocked.</p>
      ) : copied && secret ? (
        <p className="text-[0.6875rem] text-ink-subtle">
          Clipboard clears automatically in 30 seconds.
        </p>
      ) : null}
    </div>
  );
}

export function ItemDetail({
  item,
  onClose,
  onEdit,
  onDelete,
}: {
  item: VaultItem | null;
  onClose: () => void;
  onEdit: (item: VaultItem) => void;
  onDelete: (item: VaultItem) => Promise<void>;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setConfirmingDelete(false);
  }, [item?.id]);

  if (!item) return null;

  const href = safeExternalUrl(item.url);

  return (
    <Modal open={Boolean(item)} onClose={onClose} title={item.name}>
      <div className="space-y-5">
        {item.username ? <CopyField label="Username" value={item.username} /> : null}

        <Separator />

        <div className="space-y-3">
          <CopyField label="Password" value={item.password} secret />
          <StrengthMeter password={item.password} />
        </div>

        {href ? (
          <>
            <Separator />
            <div className="space-y-1.5">
              <p className="text-label">Website</p>
              <a
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 text-[0.9375rem] text-ink underline underline-offset-4 hover:no-underline"
              >
                {item.url}
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            </div>
          </>
        ) : null}

        {item.notes ? (
          <>
            <Separator />
            <div className="space-y-1.5">
              <p className="text-label">Notes</p>
              <p className="whitespace-pre-wrap text-[0.875rem] leading-relaxed text-ink-muted">
                {item.notes}
              </p>
            </div>
          </>
        ) : null}

        <Separator />

        <p className="font-mono text-[0.6875rem] text-ink-subtle">
          Updated {formatRelativeTime(item.updatedAt)} · created{" "}
          {formatRelativeTime(item.createdAt)}
        </p>

        {confirmingDelete ? (
          <Notice tone="critical">
            <p className="font-medium">Delete &ldquo;{item.name}&rdquo;?</p>
            <p className="mt-1">
              This removes it from every device. It cannot be undone.
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                variant="danger"
                size="sm"
                loading={deleting}
                onClick={async () => {
                  setDeleting(true);
                  try {
                    await onDelete(item);
                    onClose();
                  } finally {
                    setDeleting(false);
                  }
                }}
              >
                Delete permanently
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </Button>
            </div>
          </Notice>
        ) : (
          <div className="flex gap-2 border-t border-line pt-5">
            <Button className="flex-1" onClick={() => onEdit(item)}>
              <Pencil className="size-3.5" aria-hidden />
              Edit
            </Button>
            <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
              <Trash2 className="size-3.5" aria-hidden />
              Delete
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
