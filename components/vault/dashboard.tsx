"use client";

import { KeyRound, Settings, Wand2 } from "lucide-react";
import { useState } from "react";

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

export function Dashboard() {
  const [tab, setTab] = useState<Tab>("vault");

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
      <nav
        aria-label="Vault sections"
        className="mb-8 inline-flex rounded-[var(--radius-sm)] border border-line p-0.5"
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
