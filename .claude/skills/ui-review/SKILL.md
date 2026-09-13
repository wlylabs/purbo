---
name: ui-review
description: Audit a Purbo screen against the project's UI standard by driving a real browser over MCP — accessibility tree, keyboard path, contrast, Core Web Vitals, dark mode, 400px width, reduced motion and the installed (standalone) shell. Use when asked to review, check, improve or verify any interface change, or when a screen "feels off" and the reason has to be found rather than guessed.
---

# Reviewing a Purbo screen

A design opinion is worth what it can be checked against. This project already
states its opinion — the tokens, the press curve and the reason for each of
them are written out in `app/globals.css` — so a review here is not a matter of
taste. It is a matter of loading the screen in a real browser and measuring the
things the stated opinion implies.

Two MCP servers do the loading (see `docs/ui-mcp.md` for how they are wired):

- **chrome-devtools** — the page as Chrome sees it. Computed styles, the
  console, network, and a real performance trace. Use it for anything that is
  a measurement.
- **playwright** — the page as a user drives it. Accessibility snapshots,
  keyboard and pointer input, resizes, screenshots. Use it for anything that is
  a journey.

## Before touching the browser

**Never sign into a real vault.** Every flow worth reviewing is reachable from
a throwaway one: create a vault, write the 24 words to the scratch directory if
a later step needs them, and let it be destroyed with the browser profile. Both
servers are configured `--isolated` precisely so that the review cannot reach a
profile that holds someone's passwords.

Start the app first — `npm run dev` on <http://localhost:3000> — and prefer a
production build (`npm run build && npm start`) whenever the finding is about
performance, because dev-mode numbers measure the dev server.

## The standard

Work the list. Each line is a claim the app already makes about itself; the
review is looking for the place where it stops being true.

**Structure and semantics.** Take a Playwright accessibility snapshot of the
screen rather than a screenshot, and read it as the page's outline. One `h1`
per view, headings that descend without skipping, landmarks (`main`, `nav`) in
place, every control carrying an accessible name — an icon-only button with no
name is invisible to a screen reader no matter how obvious the glyph is. A
`div` with an `onClick` is a finding.

**Keyboard.** Tab from the top with no pointer at all. Every interactive
element must be reachable, in an order that matches the visual one, with a
focus ring that is actually visible on the fill it lands on (the global
`:focus-visible` rule gives it 2px of `--ring` — check it was not overridden
away). Dialogs trap focus and return it to the opener on close; `Escape`
dismisses; the command palette opens and closes on its own shortcut. A control
that can be clicked but not tabbed to is a bug, not a style choice.

**Contrast.** WCAG 2.2 AA: 4.5:1 for text, 3:1 for large text and for the edge
of a control. Read computed styles through chrome-devtools rather than trusting
the token names — `--line-control` exists because the boundary of a flat
control is the only thing saying where it ends, so it is the first thing to
verify after any border change. Check both themes.

**Both themes, and the toggle.** The dark palette is declared twice on purpose
— once under `prefers-color-scheme`, once under `[data-theme]`. Verify both
paths: flip the OS preference through the CDP emulation, then flip the in-app
toggle against the opposite OS setting. Colour is reserved for meaning here
(strength, sync state, danger); a new hue that means nothing is a finding.

**400px.** Resize to 400x844 and look for a horizontal scrollbar, a control
under 44px of touch target, a truncated label that matters, and a sticky bar
that eats the heading a fragment link just jumped to. Then check the safe-area
padding still holds under a simulated notch.

**Motion.** Enable `prefers-reduced-motion` and confirm every transition still
*lands* — reduced motion removes travel, never state. Then, with motion on,
confirm the press is instant and only the release eases: a button whose pressed
fill is a smear is the exact bug `.interactive` exists to prevent.

**Core Web Vitals.** Record a chrome-devtools performance trace over the real
interaction, not an idle page. LCP under 2.5s, CLS under 0.1, INP under 200ms.
Unlocking a vault runs Argon2id at 64 MiB and *will* dominate the main thread —
that cost is deliberate and not a finding; what is a finding is the interface
failing to say it is working while the cost is paid.

**The installed shell.** Purbo is a PWA. Check the manifest parses, the service
worker registers, the offline route answers an uncached navigation, and nothing
in the standalone display mode sits under the system bars.

**The console.** Any error, any React key warning, any hydration mismatch, any
CSP violation. A nonce-based CSP is one of the app's stated properties; a
console full of violations means it is being worked around somewhere.

## Writing the finding

Say what is broken, where, and what it costs the user — in that order, one
sentence each. Attach the measurement (the ratio, the millisecond figure, the
snapshot line), because a review that cannot be re-run is an opinion again.

Rank by whether a user is blocked, then by how many screens share the cause.

## Fixing it

Fix the cause in the design system, not the symptom at the call site: a
one-off colour in a component is how a system stops being one.

- New colours go in `app/globals.css` as tokens, in both palettes, or they do
  not go in at all.
- Shared shapes belong in `components/ui/`; the button's variants live in
  `button-styles.ts` so that anchors can share them and stay real anchors.
- Do not reach for a component library. The primitives here are deliberate and
  documented in place — read the comment above a component before changing it,
  because most of them record a bug that was already fixed once.
- Re-run the measurement that produced the finding and quote the new number.
  `npm run typecheck` and `npm test` before you call it done.
