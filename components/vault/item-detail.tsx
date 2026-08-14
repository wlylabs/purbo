"use client";

import { ExternalLink, Lock, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { ApprovalCard } from "@/components/ui/approval";
import { Button } from "@/components/ui/button";
import { CopyRow } from "@/components/ui/copy-row";
import { Modal, Separator } from "@/components/ui/primitives";
import { useVault } from "@/lib/vault/provider";
import type { VaultItem } from "@/lib/vault/types";
import { formatRelativeTime, safeExternalUrl } from "@/lib/utils";
import { StepUp } from "./step-up";
import { StrengthMeter } from "./strength-meter";

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
  const { stepUpVerified } = useVault();

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingReveal, setConfirmingReveal] = useState(false);

  useEffect(() => {
    setConfirmingDelete(false);
    setConfirmingReveal(false);
  }, [item?.id]);

  if (!item) return null;

  const href = safeExternalUrl(item.url);

  return (
    <Modal open={Boolean(item)} onClose={onClose} title={item.name}>
      <div className="space-y-4">
        {item.username ? <CopyRow label="Username" value={item.username} /> : null}

        {/* The password is the one field worth a second question. Everything
            else on this screen is metadata the vault already showed in the
            list behind it. */}
        {stepUpVerified ? (
          <div className="space-y-3">
            <CopyRow label="Password" value={item.password} secret />
            <StrengthMeter password={item.password} className="px-1" />
          </div>
        ) : confirmingReveal ? (
          <StepUp
            action="reveal this password"
            onCancel={() => setConfirmingReveal(false)}
          />
        ) : (
          <div className="flex items-center gap-3 rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-label">Password</p>
              <p className="mt-1 select-none font-mono text-[0.9375rem] leading-snug tracking-tight text-ink-muted">
                {"•".repeat(16)}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="shrink-0"
              onClick={() => setConfirmingReveal(true)}
            >
              <Lock className="size-3.5" aria-hidden />
              Reveal
            </Button>
          </div>
        )}

        {href ? (
          <div className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5">
            <p className="text-label">Website</p>
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1 inline-flex items-center gap-1.5 break-all text-[0.9375rem] text-ink underline underline-offset-4 hover:no-underline"
            >
              {item.url}
              <ExternalLink className="size-3.5 shrink-0" aria-hidden />
            </a>
          </div>
        ) : null}

        {item.notes ? (
          <div className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5">
            <p className="text-label">Notes</p>
            <p className="mt-1 whitespace-pre-wrap text-[0.875rem] leading-relaxed text-ink-muted">
              {item.notes}
            </p>
          </div>
        ) : null}

        <Separator />

        <p className="text-meta">
          Updated {formatRelativeTime(item.updatedAt)} · created{" "}
          {formatRelativeTime(item.createdAt)}
        </p>

        {confirmingDelete ? (
          <ApprovalCard
            title="Confirm deletion"
            question={`Delete “${item.name}” from your vault?`}
            consequences={[
              "The entry is removed from this device and from every other device on the next sync.",
              "The stored password is not recoverable — it exists nowhere else in Purbo.",
            ]}
            confirmLabel="Delete permanently"
            loading={deleting}
            onCancel={() => setConfirmingDelete(false)}
            onConfirm={async () => {
              setDeleting(true);
              try {
                await onDelete(item);
                onClose();
              } finally {
                setDeleting(false);
              }
            }}
          />
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
