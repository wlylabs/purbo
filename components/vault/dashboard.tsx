"use client";

import { KeyRound, Settings, Wand2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Tabs, tabIds, type TabItem } from "@/components/ui/tabs";
import { onLaunch } from "@/lib/pwa/launch";
import { useVault } from "@/lib/vault/provider";
import { CommandPalette } from "./command-palette";
import { Generator } from "./generator";
import { SettingsView } from "./settings-view";
import { VaultView, type VaultIntent } from "./vault-view";

type Tab = "vault" | "generator" | "settings";

function isTab(value: string | null): value is Tab {
  return value === "vault" || value === "generator" || value === "settings";
}

export function Dashboard() {
  const { items } = useVault();
  const [tab, setTab] = useState<Tab>("vault");
  /**
   * A request made from outside the vault panel — the command palette asking
   * for a new entry while the user is looking at Settings. It is state rather
   * than a call because the panel is keyed on the tab and therefore may not
   * be mounted yet at the moment the palette runs.
   */
  const [intent, setIntent] = useState<VaultIntent | null>(null);
  const clearIntent = useCallback(() => setIntent(null), []);

  // Stable between renders: the strip re-measures its marker whenever the
  // item list identity changes, and a fresh array every render would have it
  // tearing down its ResizeObserver on every keystroke elsewhere in the app.
  const tabs: TabItem<Tab>[] = useMemo(
    () => [
      { id: "vault", label: "Vault", icon: KeyRound, badge: items.length },
      { id: "generator", label: "Generator", icon: Wand2 },
      { id: "settings", label: "Settings", icon: Settings },
    ],
    [items.length],
  );

  /**
   * `?tab=` is a section's address, and it is read in both directions.
   *
   * Reading it is what makes the manifest's app shortcuts — "Password
   * generator" on a long-press of the installed icon — and any link to a
   * section land somewhere useful. It happens after mount rather than during
   * render, because the server has no query string to match.
   *
   * The launch subscription covers what mounting cannot. An installed app
   * that captures a link while it is already open is focused, not reloaded,
   * so the URL changes underneath a component that never remounts; without
   * this, following a link to the generator would raise a window still
   * showing the vault.
   */
  useEffect(() => {
    const applyUrl = () => {
      const requested = new URLSearchParams(window.location.search).get("tab");
      if (isTab(requested)) setTab(requested);
    };
    applyUrl();
    return onLaunch(applyUrl);
  }, []);

  /**
   * Writing it back keeps the address honest about what is on screen, so the
   * URL of the generator can be copied out of an app window and followed back
   * into one.
   *
   * `replaceState` rather than a router navigation, since the route has not
   * changed and there is nothing to re-fetch; and rather than a history
   * entry, because Back should leave a section the way it leaves any other,
   * not walk backwards through the tabs that were visited. The first run is
   * skipped: at mount the URL is the source of truth, not the copy.
   */
  const tabWritten = useRef(false);
  useEffect(() => {
    if (!tabWritten.current) {
      tabWritten.current = true;
      return;
    }
    const url = new URL(window.location.href);
    // "vault" is where the app opens, so it is spelled by its absence.
    if (tab === "vault") url.searchParams.delete("tab");
    else url.searchParams.set("tab", tab);
    if (url.href !== window.location.href) window.history.replaceState(null, "", url);
  }, [tab]);

  return (
    <div className="flex flex-1 flex-col">
      {/* A bar of its own rather than a control floating in the content well:
          the sections are the top level of this app, so their rule runs the
          full width of the window and the strip stays under the header on the
          way down the page — the way switching sections is one move from
          anywhere, not a scroll back to the top. */}
      <div className="sticky top-[calc(4rem+env(safe-area-inset-top))] z-20 border-b border-line bg-canvas/85 backdrop-blur-md">
        {/* The strip's own padding (`px-3`/`sm:px-4` on each tab) finishes the
            page gutter, so the first label starts on the same vertical as the
            content below it rather than a few pixels inside it. */}
        <div className="mx-auto max-w-6xl px-2">
          <Tabs
            name="dashboard"
            label="Vault sections"
            items={tabs}
            value={tab}
            onChange={setTab}
          />
        </div>
      </div>

      <div className="mx-auto w-full max-w-6xl px-5 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-8 sm:pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
        {tabs.map(({ id }) => {
          if (id !== tab) return null;
          const { tabId, panelId } = tabIds("dashboard", id);

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
              {id === "vault" ? (
                <VaultView intent={intent} onIntentHandled={clearIntent} />
              ) : null}
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

      <CommandPalette
        onNavigate={setTab}
        onNewEntry={() => setIntent({ kind: "new-entry" })}
      />
    </div>
  );
}
