# Connecting MCP for interface work

Purbo's design system is written down — the tokens, the press curve, the reason
a control has a 3:1 edge rather than a shadow, all of it sits in comments in
`app/globals.css` and `components/ui/`. What was missing was a way for an agent
to *check* any of it. An assistant that can only read the source can tell you
what the CSS says; it cannot tell you that the disabled button on the unlock
screen lands at 2.9:1 against its card, or that the vault list shifts 0.14 of a
viewport while the icons load.

Two MCP servers close that gap. They are checked in, so cloning the repository
is all the setup there is.

| Server | What it is for |
| --- | --- |
| `chrome-devtools` | The page as Chrome sees it — computed styles, console, network, and real performance traces (LCP, CLS, INP) |
| `playwright` | The page as a user drives it — accessibility snapshots, keyboard and pointer input, resizes, screenshots |

They overlap on purpose and answer different questions. "Is this contrast
ratio right" is a measurement, and belongs to chrome-devtools. "Can this dialog
be closed without a mouse" is a journey, and belongs to Playwright's
accessibility tree, which returns roles and names rather than pixels — so the
agent reasons about a *button named "Copy password"* instead of about a dark
rectangle near the top right.

## Setup

`.mcp.json` in the repository root declares both servers; `.claude/settings.json`
marks them enabled and pre-approves their tools so a review is not forty
permission prompts. You need Node 20+ and a Chrome or Chromium on the machine.

```bash
claude            # from the repo root — it reads .mcp.json on start
/mcp              # both servers should list as connected
```

If Playwright reports no browser, bring one along once:

```bash
npx playwright install chromium
```

Other MCP clients read the same file. VS Code, Cursor and Claude Desktop each
accept the `mcpServers` block verbatim; the Claude Code CLI can also register
them per-user instead of per-project:

```bash
claude mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest --isolated
claude mcp add playwright -- npx -y @playwright/mcp@latest --isolated
```

### `--isolated` is not optional here

Both servers are launched with a throwaway browser profile, and for this
project that is a security setting rather than a preference. Without it the
agent drives *your* Chrome, with your sessions in it — which for a password
manager means a real unlocked vault sitting one `take_snapshot` call away from
a transcript. Review against a throwaway vault on `localhost`, and let it be
destroyed with the profile.

`.claude/settings.json` also denies reads of `.env*` files, for the same
reason: nothing in a UI review needs the session secret.

## Using it

```bash
npm run dev       # the servers need something to load
```

Then ask for the review. The project skill in `.claude/skills/ui-review/` holds
the standard being checked — accessibility tree, keyboard path, contrast in
both themes, Core Web Vitals, 400px, reduced motion, the installed shell — and
how a finding gets written up and fixed:

```
> /ui-review the vault dashboard
> check the unlock screen at 400px in dark mode
> trace what happens between clicking Unlock and the list appearing
```

A useful shape for the loop: measure, fix the *cause* in the design system,
re-measure, quote the new number. A fix that cannot be re-measured is a
preference.

## Servers deliberately not included

**A component generator** (shadcn's registry MCP and friends). The primitives
in `components/ui/` are hand-built and each one records a decision — why the
press is not animated, why a chip's ARIA role is set at the call site, why the
button's styles live outside the client component. Dropping in generated
components would quietly replace that with someone else's defaults, which is
the opposite of a consistent interface. Add it if you want a reference to read;
do not let it write.

**Figma Dev Mode** (`http://127.0.0.1:3845/mcp`). Genuinely useful if the
design lives in Figma, useless otherwise, and it needs the desktop app running
locally — so it belongs in your own `.mcp.json` rather than in the repository's:

```json
{
  "mcpServers": {
    "figma": { "type": "http", "url": "http://127.0.0.1:3845/mcp" }
  }
}
```

Per-user additions go in `.claude/settings.local.json` (gitignored) or your
user-scoped config, so the shared file stays the set everyone agrees on.
