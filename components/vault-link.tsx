"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { buttonStyles } from "@/components/ui/button-styles";
import { readActiveAccount } from "@/lib/storage/local";

/**
 * The way into the app.
 *
 * There is nothing to sign into, so this is a link rather than a button —
 * middle-click and "open in new tab" keep working, and it needs no
 * JavaScript to function. The only thing script adds is the label: a browser
 * that already holds a vault is greeted with "Open your vault" instead of
 * being invited to create a second one.
 */
export function VaultLink({
  label = "Create your vault",
  returningLabel = "Open your vault",
  showArrow = true,
  size = "md",
  variant = "primary",
  className,
}: {
  label?: string;
  returningLabel?: string;
  showArrow?: boolean;
  size?: "sm" | "md" | "lg";
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
}) {
  // Starts false on both server and client, so the first paint matches the
  // markup and the label settles a tick later.
  const [returning, setReturning] = useState(false);
  useEffect(() => setReturning(Boolean(readActiveAccount())), []);

  return (
    <Link href="/vault" className={buttonStyles({ variant, size, className })}>
      {returning ? returningLabel : label}
      {showArrow ? <ArrowRight className="size-4" aria-hidden /> : null}
    </Link>
  );
}
