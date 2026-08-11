import type { Metadata } from "next";

import { VaultWorkspace } from "./workspace";

export const metadata: Metadata = {
  title: "Vault",
  robots: { index: false, follow: false, nocache: true },
};

export default function VaultPage() {
  const configured = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);
  return <VaultWorkspace configured={configured} />;
}
