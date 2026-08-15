import { ImageResponse } from "next/og";

/**
 * The card every link preview shows — X, Slack, WhatsApp, Discord.
 *
 * Rendered by Satori at build time rather than committed as a binary, so the
 * copy stays editable as text and no image toolchain joins the dependency
 * tree. Only the default font is used: loading a webfont here would mean a
 * network fetch during the build for one image.
 *
 * The palette is the app's own dark theme, lifted from app/globals.css.
 */
export const alt = "Purbo — a password vault only you can open";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const CANVAS = "#09090b";
const ELEVATED = "#141418";
const LINE = "#1f1f25";
const INK = "#fafafa";
const INK_MUTED = "#a1a1aa";
const POSITIVE = "#34d399";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: CANVAS,
          padding: "72px 80px",
        }}
      >
        {/* The mark, drawn as the same keyhole the app uses. */}
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <svg width="64" height="64" viewBox="0 0 32 32">
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M6 3.5h20A2.5 2.5 0 0 1 28.5 6v20a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 26V6A2.5 2.5 0 0 1 6 3.5Zm10 6.25a4 4 0 0 0-1.75 7.6V22a1.75 1.75 0 0 0 3.5 0v-4.65a4 4 0 0 0-1.75-7.6Z"
              fill={INK}
            />
          </svg>
          <span style={{ color: INK, fontSize: 44, fontWeight: 700, letterSpacing: -1 }}>
            Purbo
          </span>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginLeft: 12,
              padding: "10px 20px",
              borderRadius: 999,
              border: `1px solid ${LINE}`,
              background: ELEVATED,
              color: INK_MUTED,
              fontSize: 22,
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: POSITIVE,
              }}
            />
            Zero-knowledge by design
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <span
            style={{
              color: INK,
              fontSize: 84,
              fontWeight: 700,
              letterSpacing: -3,
              lineHeight: 1.05,
            }}
          >
            A password vault
          </span>
          <span
            style={{
              color: INK,
              fontSize: 84,
              fontWeight: 700,
              letterSpacing: -3,
              lineHeight: 1.05,
            }}
          >
            only you can open.
          </span>
          <span style={{ marginTop: 28, color: INK_MUTED, fontSize: 30, lineHeight: 1.4 }}>
            Encrypted in your browser before it touches the network.
          </span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 32,
            borderTop: `1px solid ${LINE}`,
            color: INK_MUTED,
            fontSize: 24,
          }}
        >
          <span>AES-256-GCM · Argon2id · BIP39 · Passkeys</span>
          <span>purbo.vercel.app</span>
        </div>
      </div>
    ),
    size,
  );
}
