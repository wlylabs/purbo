import type { Metadata } from "next";

import { VaultWorkspace } from "./workspace";

export const metadata: Metadata = {
  title: "Vault",
  robots: { index: false, follow: false, nocache: true },
};

export default function VaultPage() {
  return <VaultWorkspace />;
}
