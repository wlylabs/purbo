"use client";

import { KeyRound, Settings, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Segmented, segmentedIds, type SegmentedItem } from "@/components/ui/segmented";
import { Generator } from "./generator";
import { SettingsView } from "./settings-view";
import { VaultView } from "./vault-view";

type Tab = "vault" | "generator" | "settings";

const TABS: SegmentedItem<Tab>[] = [
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
      <Segmented
        name="dashboard"
        label="Vault sections"
        items={TABS}
        value={tab}
        onChange={setTab}
        className="mb-5 sm:mb-8"
      />

      {TABS.map(({ id }) => {
        if (id !== tab) return null;
        const { tabId, panelId } = segmentedIds("dashboard", id);

        return (
          // Keyed on the tab so React remounts rather than reconciles, which
          // is what lets the panel play its entrance each time.
          <div
            key={id}
            id={panelId}
            role="tabpanel"
            aria-labelledby={tabId}
            tabIndex={-1}
            className="animate-fade"
          >
            {id === "vault" ? <VaultView /> : null}
            {id === "generator" ? (
              <div className="max-w-lg">
                <Generator />
              </div>
            ) : null}
            {id === "settings" ? <SettingsView /> : null}
          </div>
        );
      })}
    </div>
  );
}
