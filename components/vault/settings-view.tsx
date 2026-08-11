"use client";

import { AlertTriangle, Download } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, Notice, Separator } from "@/components/ui/primitives";
import { DEFAULT_KDF_PARAMS } from "@/lib/crypto/kdf";
import { useVault } from "@/lib/vault/provider";

const AUTO_LOCK_CHOICES = [
  { minutes: 1, label: "1 min" },
  { minutes: 5, label: "5 min" },
  { minutes: 10, label: "10 min" },
  { minutes: 30, label: "30 min" },
  { minutes: 0, label: "Never" },
];

export function SettingsView() {
  const { autoLockMinutes, setAutoLockMinutes, items, destroyVault, syncState, syncMessage } =
    useVault();

  const [confirmText, setConfirmText] = useState("");
  const [destroying, setDestroying] = useState(false);

  /**
   * Exports the vault as plaintext JSON.
   *
   * This is deliberately blunt: an export is a decrypted copy of everything,
   * and the only honest way to present it is with that stated plainly rather
   * than buried. It exists so users are never locked in.
   */
  const exportVault = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      warning: "PLAINTEXT EXPORT — this file is not encrypted. Store or delete it carefully.",
      items: items.map((item) => ({
        name: item.name,
        username: item.username,
        password: item.password,
        url: item.url ?? "",
        notes: item.notes ?? "",
      })),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `purbo-export-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <Card className="p-5 sm:p-6">
        <h2 className="text-[0.9375rem] font-semibold tracking-tight">Auto-lock</h2>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-muted">
          Locking clears the decryption key from memory. Anyone who reaches the tab afterwards
          needs the passphrase again.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {AUTO_LOCK_CHOICES.map((choice) => (
            <button
              key={choice.minutes}
              type="button"
              onClick={() => setAutoLockMinutes(choice.minutes)}
              aria-pressed={autoLockMinutes === choice.minutes}
              className={`rounded-[var(--radius-sm)] border px-3 py-1.5 text-[0.8125rem] font-medium transition-colors ${
                autoLockMinutes === choice.minutes
                  ? "border-ink bg-invert-bg text-invert-fg"
                  : "border-line text-ink-muted hover:border-line-strong hover:text-ink"
              }`}
            >
              {choice.label}
            </button>
          ))}
        </div>
        {autoLockMinutes === 0 ? (
          <Notice tone="caution" className="mt-4" icon={<AlertTriangle className="size-4" />}>
            With auto-lock off, the vault stays decrypted until you lock it or close the tab.
          </Notice>
        ) : null}
      </Card>

      <Card className="p-5 sm:p-6">
        <h2 className="text-[0.9375rem] font-semibold tracking-tight">Encryption</h2>
        <dl className="mt-4 space-y-3 text-[0.8125rem]">
          {[
            ["Entry cipher", "AES-256-GCM, 96-bit IV, context-bound"],
            [
              "Passphrase KDF",
              `Argon2id · ${DEFAULT_KDF_PARAMS.memoryKiB / 1024} MiB · ${DEFAULT_KDF_PARAMS.iterations} passes`,
            ],
            ["Key derivation", "HKDF-SHA-256, domain-separated"],
            ["Recovery", "BIP39, 24 words, 256-bit entropy"],
            ["Sync", syncMessage ?? `${syncState} — ciphertext only`],
          ].map(([term, detail]) => (
            <div key={term} className="flex flex-wrap justify-between gap-2 border-b border-line pb-3 last:border-0 last:pb-0">
              <dt className="text-ink-muted">{term}</dt>
              <dd className="font-mono text-[0.75rem] text-ink">{detail}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card className="p-5 sm:p-6">
        <h2 className="text-[0.9375rem] font-semibold tracking-tight">Export</h2>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-muted">
          Download every entry as JSON. The file is <strong className="text-ink">not
          encrypted</strong> — anyone who opens it reads your passwords. Move it somewhere
          safe or delete it as soon as you are done.
        </p>
        <Button variant="secondary" size="sm" className="mt-4" onClick={exportVault} disabled={items.length === 0}>
          <Download className="size-3.5" aria-hidden />
          Export {items.length} {items.length === 1 ? "entry" : "entries"}
        </Button>
      </Card>

      <Card className="border-critical/30 p-5 sm:p-6">
        <h2 className="text-[0.9375rem] font-semibold tracking-tight text-critical">
          Delete this vault
        </h2>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-muted">
          Erases the encrypted vault from the server and this device. Your recovery phrase
          cannot bring it back — there will be nothing left to decrypt.
        </p>

        <Separator className="my-5" />

        <Input
          label="Type DELETE to confirm"
          value={confirmText}
          onChange={(event) => setConfirmText(event.target.value)}
          placeholder="DELETE"
          autoComplete="off"
          className="font-mono"
        />

        <Button
          variant="danger"
          className="mt-4"
          disabled={confirmText !== "DELETE"}
          loading={destroying}
          onClick={async () => {
            setDestroying(true);
            try {
              await destroyVault();
            } finally {
              setDestroying(false);
              setConfirmText("");
            }
          }}
        >
          Delete vault permanently
        </Button>
      </Card>
    </div>
  );
}
