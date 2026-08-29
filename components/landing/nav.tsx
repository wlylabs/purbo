"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { VaultLink } from "@/components/vault-link";
import { ThemeToggle } from "@/components/theme";
import { Wordmark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/ui/primitives";
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
  const toggleRef = useRef<HTMLButtonElement>(null);
  const headerRef = useRef<HTMLElement>(null);

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

  /*
   * The two ways out of the menu that are not the button.
   *
   * Escape, because a panel over the page is expected to answer it. And the
   * breakpoint, because the panel is `md:hidden` while the scroll lock above
   * is not: turning a phone to landscape or widening a window hides the menu
   * and leaves the page unable to scroll, with the only control that would
   * have released it now hidden too. Closing on the crossing is what stops a
   * rotation from being a dead page.
   */
  useEffect(() => {
    if (!menuOpen) return;

    const dismiss = () => {
      setMenuOpen(false);
      toggleRef.current?.focus();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    // Tailwind's `md`, which is where the panel stops being rendered.
    const wide = window.matchMedia("(min-width: 48rem)");
    // No focus to restore here: the button the user would return to is the
    // one the breakpoint just took away.
    const onWiden = () => {
      if (wide.matches) setMenuOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    wide.addEventListener("change", onWiden);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      wide.removeEventListener("change", onWiden);
    };
  }, [menuOpen]);

  /*
   * Following a link out of the mobile menu, once the menu has got out of the
   * way.
   *
   * The panel folds down out of this header, and a sticky element still holds
   * its space in flow — so the panel is roughly 200px of page sitting above
   * every section it links to. Tapping a link closes the menu and jumps to the
   * fragment in the same tick: the browser picks its landing spot while the
   * panel is still open, the panel then collapses out from under it, and the
   * page arrives that far past the heading. `scroll-margin-top` cannot save
   * this — the offset is right and the measurement it was applied to is stale.
   *
   * So the jump waits for the fold. Waiting on the header settling rather than
   * on a duration means the two cannot drift apart if the close is ever
   * retimed, and it costs one extra frame when there is nothing to wait for.
   * `scrollIntoView()` is called bare on purpose: with no `behavior` it takes
   * the CSS one, which is what the reduced-motion block already turns off.
   */
  const followLink = (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    const target = document.querySelector(href);
    if (!target) return;

    event.preventDefault();
    setMenuOpen(false);
    // The fragment still belongs in the address bar; only the scroll it would
    // have done is being replaced.
    window.history.replaceState(null, "", href);

    let previous = -1;
    const settle = () => {
      const height = headerRef.current?.getBoundingClientRect().height ?? 0;
      if (height !== previous) {
        previous = height;
        requestAnimationFrame(settle);
        return;
      }
      target.scrollIntoView();
    };
    requestAnimationFrame(settle);
  };

  return (
    <header
      ref={headerRef}
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
                className="rounded-[var(--radius-sm)] px-3 py-2 text-[0.8125rem] text-ink-muted interactive hover:bg-tint hover:text-ink active:bg-tint-strong"
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
            ref={toggleRef}
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

      {/* The panel folds down out of the bar and folds back up, so tapping
          the same button twice is one gesture reversed rather than a page
          that grows and then blinks. */}
      <Reveal open={menuOpen} className="md:hidden border-t border-line bg-canvas">
        <nav aria-label="Mobile" className="mx-auto max-w-6xl space-y-1 px-5 py-4">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(event) => followLink(event, link.href)}
              className="block rounded-[var(--radius-sm)] px-3 py-2.5 text-sm text-ink-muted interactive hover:bg-tint hover:text-ink active:bg-tint-strong"
            >
              {link.label}
            </a>
          ))}
          <div className="flex items-center justify-between gap-3 pt-3">
            <ThemeToggle />
            <VaultLink size="sm" className="flex-1" />
          </div>
        </nav>
      </Reveal>
    </header>
  );
}
