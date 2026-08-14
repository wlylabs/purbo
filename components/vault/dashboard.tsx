"use client";

import { KeyRound, Settings, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { Generator } from "./generator";
import { SettingsView } from "./settings-view";
import { VaultView } from "./vault-view";

type Tab = "vault" | "generator" | "settings";

const TABS: { id: Tab; label: string; icon: typeof KeyRound }[] = [
  { id: "vault", label: "Vault", icon: KeyRound },
  { id: "generator", label: "Generator", icon: Wand2 },
  { id: "settings", label: "Settings", icon: Settings },
];

function isTab(value: string | null): value is Tab {
  return value === "vault" || value === "generator" || value === "settings";
}

export function Dashboard() {
  const [tab, setTab] = useState<Tab>("vault");

  // `?tab=` backs the manifest's app shortcuts, so "Password generator" on a
  // long-press of the installed icon lands somewhere useful. Read after mount
  // rather than during render: the server has no query string to match.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (isTab(requested)) setTab(requested);
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-5 pt-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-10 sm:pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
      <nav
        aria-label="Vault sections"
        className="mb-5 inline-flex rounded-[var(--radius-sm)] border border-line p-0.5 sm:mb-8"
      >
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
            className={cn(
              "inline-flex items-center gap-2 rounded-[calc(var(--radius-sm)-2px)] px-3 py-1.5",
              "text-[0.8125rem] font-medium transition-colors",
              tab === id ? "bg-invert-bg text-invert-fg" : "text-ink-muted hover:text-ink",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {label}
          </button>
        ))}
      </nav>

      {tab === "vault" ? <VaultView /> : null}
      {tab === "generator" ? (
        <div className="max-w-lg">
          <Generator />
        </div>
      ) : null}
      {tab === "settings" ? <SettingsView /> : null}
    </div>
  );
}
