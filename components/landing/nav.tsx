"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { VaultLink } from "@/components/vault-link";
import { ThemeToggle } from "@/components/theme";
import { Wordmark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#security", label: "Security" },
  { href: "#features", label: "Features" },
  { href: "#faq", label: "FAQ" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  return (
    <header
      className={cn(
        "pt-safe sticky top-0 z-40 transition-colors duration-200",
        scrolled || menuOpen
          ? "bg-canvas/85 backdrop-blur-md border-b border-line"
          : "border-b border-transparent",
      )}
    >
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <div className="flex h-16 items-center justify-between gap-4">
          <Link href="/" className="shrink-0" aria-label="Purbo home">
            <Wordmark />
          </Link>

          <nav aria-label="Main" className="hidden md:flex items-center gap-1">
            {LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="rounded-md px-3 py-2 text-[0.8125rem] text-ink-muted transition-colors hover:text-ink"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="hidden md:flex items-center gap-3">
            <ThemeToggle />
            <VaultLink size="sm" showArrow={false} />
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          </Button>
        </div>
      </div>

      {menuOpen ? (
        <div className="md:hidden border-t border-line bg-canvas animate-fade">
          <nav aria-label="Mobile" className="mx-auto max-w-6xl px-5 py-4 space-y-1">
            {LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="block rounded-md px-3 py-2.5 text-sm text-ink-muted hover:bg-surface hover:text-ink"
              >
                {link.label}
              </a>
            ))}
            <div className="flex items-center justify-between gap-3 pt-3">
              <ThemeToggle />
              <VaultLink size="sm" className="flex-1" />
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
