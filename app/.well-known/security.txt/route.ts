/**
 * RFC 9116 vulnerability disclosure pointer.
 *
 * Scanners and researchers check this exact path before anything else, so it
 * has to exist even though the substance lives in `SECURITY.md`. Built as a
 * route rather than a static `public/` file so `Canonical` always matches
 * wherever this instance is actually deployed, using the same origin
 * resolution as the Open Graph metadata in `app/layout.tsx` — a preview
 * deploy must not advertise a security contact for the wrong host.
 */

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

// RFC 9116 requires this field and rejects a file older than a year; kept
// well inside that so the file never silently goes stale.
const EXPIRES = "2027-01-01T00:00:00.000Z";

export const dynamic = "force-static";

export async function GET() {
  const body = [
    `Contact: https://github.com/wlylabs/purbo/security/advisories/new`,
    `Expires: ${EXPIRES}`,
    `Canonical: ${siteUrl}/.well-known/security.txt`,
    `Policy: https://github.com/wlylabs/purbo/blob/main/SECURITY.md`,
    `Preferred-Languages: en, id`,
  ].join("\n");

  return new Response(`${body}\n`, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
