"use client";

import { usePrivy } from "@privy-io/react-auth";
import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button, type ButtonProps } from "@/components/ui/button";
import { Modal, Notice } from "@/components/ui/primitives";

/**
 * The single entry point into the app.
 *
 * Privy is optional at build time so the marketing site deploys before the
 * app id exists; when it is missing this renders setup guidance rather than
 * a button that silently does nothing.
 */
export function AuthButton({
  label = "Create wallet",
  authenticatedLabel = "Open vault",
  showArrow = true,
  configured,
  ...buttonProps
}: {
  label?: string;
  authenticatedLabel?: string;
  showArrow?: boolean;
  configured: boolean;
} & Omit<ButtonProps, "onClick" | "children">) {
  if (!configured) return <SetupButton label={label} {...buttonProps} />;
  return (
    <PrivyAuthButton
      label={label}
      authenticatedLabel={authenticatedLabel}
      showArrow={showArrow}
      {...buttonProps}
    />
  );
}

function PrivyAuthButton({
  label,
  authenticatedLabel,
  showArrow,
  ...buttonProps
}: {
  label: string;
  authenticatedLabel: string;
  showArrow: boolean;
} & Omit<ButtonProps, "onClick" | "children">) {
  const { ready, authenticated, login } = usePrivy();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  // Once Privy reports an authenticated session after a login click, move on.
  useEffect(() => {
    if (pending && ready && authenticated) {
      router.push("/vault");
    }
  }, [pending, ready, authenticated, router]);

  return (
    <Button
      loading={!ready || pending}
      onClick={() => {
        if (authenticated) {
          router.push("/vault");
          return;
        }
        setPending(true);
        login();
      }}
      {...buttonProps}
    >
      {authenticated ? authenticatedLabel : label}
      {showArrow ? <ArrowRight className="size-4" aria-hidden /> : null}
    </Button>
  );
}

function SetupButton({
  label,
  ...buttonProps
}: { label: string } & Omit<ButtonProps, "onClick" | "children">) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} {...buttonProps}>
        {label}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Finish connecting Privy"
        description="Purbo uses Privy for sign-in. Add the keys below and redeploy."
      >
        <div className="space-y-4">
          <Notice tone="caution">
            This deployment has no <code className="font-mono">NEXT_PUBLIC_PRIVY_APP_ID</code>{" "}
            set, so sign-in is disabled.
          </Notice>
          <ol className="space-y-3 text-[0.8125rem] text-ink-muted leading-relaxed">
            <li>
              <span className="text-ink font-medium">1.</span> Create an app at{" "}
              <a
                className="text-ink underline underline-offset-4 hover:no-underline"
                href="https://dashboard.privy.io"
                target="_blank"
                rel="noreferrer noopener"
              >
                dashboard.privy.io
              </a>
              .
            </li>
            <li>
              <span className="text-ink font-medium">2.</span> In Vercel, add the environment
              variables <code className="font-mono text-ink">NEXT_PUBLIC_PRIVY_APP_ID</code> and{" "}
              <code className="font-mono text-ink">PRIVY_APP_SECRET</code>.
            </li>
            <li>
              <span className="text-ink font-medium">3.</span> Add{" "}
              <code className="font-mono text-ink">UPSTASH_REDIS_REST_URL</code> and{" "}
              <code className="font-mono text-ink">UPSTASH_REDIS_REST_TOKEN</code> so encrypted
              vaults sync across devices.
            </li>
            <li>
              <span className="text-ink font-medium">4.</span> Redeploy.
            </li>
          </ol>
        </div>
      </Modal>
    </>
  );
}
