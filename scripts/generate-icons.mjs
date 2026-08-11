/**
 * Generates the PWA icon set from the Purbo mark.
 *
 * The mark is three analytic shapes — a rounded square, a circle and a
 * capsule — so it can be rasterised from signed distance fields with exact
 * anti-aliasing and written out as PNG with nothing but `node:zlib`. That
 * keeps a build-time image toolchain (and its transitive dependency tree)
 * out of a project whose whole point is a small, auditable surface.
 *
 *   node scripts/generate-icons.mjs
 *
 * Output lands in public/icons/ and is committed, so a deploy never depends
 * on this script having run.
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/** Manifest icons are plain public assets, referenced by URL from app/manifest.ts. */
const ICON_DIR = join(ROOT, "public", "icons");
/** The Apple touch icon is a Next metadata file convention, so it lives in app/. */
const APP_DIR = join(ROOT, "app");

/** Identity colours. Fixed, not theme-dependent: an installed icon is one icon. */
const BACKGROUND = [0x09, 0x09, 0x0b];
const GLYPH = [0xfa, 0xfa, 0xfa];

/* ------------------------------------------------------------------ *
 * Signed distance fields. Negative inside, positive outside, in the
 * units of whatever space they are evaluated in.
 * ------------------------------------------------------------------ */

function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

function sdRoundedRect(px, py, cx, cy, halfW, halfH, r) {
  const qx = Math.abs(px - cx) - halfW + r;
  const qy = Math.abs(py - cy) - halfH + r;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return Math.min(Math.max(qx, qy), 0) + outside - r;
}

/**
 * The keyhole, in the same 32-unit space as components/logo.tsx: a circle
 * with a capsule stem dropping out of it.
 */
function sdGlyph(x, y) {
  const bowl = sdCircle(x, y, 16, 13.75, 4);
  const stem = sdRoundedRect(x, y, 16, 17, 1.75, 5, 1.75);
  return Math.min(bowl, stem);
}

/** Distance in pixels → ink coverage in [0, 1]. */
function coverage(distance) {
  return Math.min(Math.max(0.5 - distance, 0), 1);
}

function overlay(base, ink, alpha) {
  return Math.round(base * (1 - alpha) + ink * alpha);
}

/* ------------------------------------------------------------------ *
 * Raster
 * ------------------------------------------------------------------ */

/**
 * @param {number} size      Edge length in pixels.
 * @param {object} options
 * @param {number} options.cornerRadius  Background corner radius, 0–0.5 of size.
 * @param {number} options.glyphScale    Glyph size as a fraction of the canvas.
 */
function render(size, { cornerRadius, glyphScale }) {
  const pixels = Buffer.alloc(size * size * 4);

  // The glyph's 32-unit space, mapped to a centred box of `glyphScale`.
  const unit = (size * glyphScale) / 32;
  const origin = (size - size * glyphScale) / 2;

  const radiusPx = cornerRadius * size;
  const half = size / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // Sample at pixel centres.
      const px = x + 0.5;
      const py = y + 0.5;

      const backdrop = coverage(
        sdRoundedRect(px, py, half, half, half, half, radiusPx),
      );
      // The glyph SDF is in glyph units; scale it back to pixels so the
      // anti-aliasing ramp stays one pixel wide at every icon size.
      const glyph = coverage(sdGlyph((px - origin) / unit, (py - origin) / unit) * unit);

      const offset = (y * size + x) * 4;
      // Glyph is punched over the backdrop, never outside it.
      const ink = Math.min(glyph, backdrop);
      pixels[offset] = overlay(BACKGROUND[0], GLYPH[0], ink);
      pixels[offset + 1] = overlay(BACKGROUND[1], GLYPH[1], ink);
      pixels[offset + 2] = overlay(BACKGROUND[2], GLYPH[2], ink);
      pixels[offset + 3] = Math.round(backdrop * 255);
    }
  }

  return pixels;
}

/* ------------------------------------------------------------------ *
 * PNG container
 * ------------------------------------------------------------------ */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // truecolour with alpha
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  // One filter byte per scanline; flat colour compresses fine unfiltered.
  const stride = size * 4;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ *
 * Output set
 * ------------------------------------------------------------------ */

const ICONS = [
  // `purpose: any` — drawn with its own rounded corners, since nothing masks it.
  { dir: ICON_DIR, file: "icon-192.png", size: 192, cornerRadius: 0.22, glyphScale: 1.4 },
  { dir: ICON_DIR, file: "icon-512.png", size: 512, cornerRadius: 0.22, glyphScale: 1.4 },
  // `purpose: maskable` — full bleed, glyph pulled well inside the 80% safe
  // zone so an aggressive circular mask still clears it.
  { dir: ICON_DIR, file: "maskable-192.png", size: 192, cornerRadius: 0, glyphScale: 1.12 },
  { dir: ICON_DIR, file: "maskable-512.png", size: 512, cornerRadius: 0, glyphScale: 1.12 },
  // iOS applies its own mask, so this is square and opaque too.
  { dir: APP_DIR, file: "apple-icon.png", size: 180, cornerRadius: 0, glyphScale: 1.4 },
];

for (const { dir, file, size, cornerRadius, glyphScale } of ICONS) {
  mkdirSync(dir, { recursive: true });
  const png = encodePng(size, render(size, { cornerRadius, glyphScale }));
  writeFileSync(join(dir, file), png);
  process.stdout.write(`${file}  ${size}×${size}  ${(png.length / 1024).toFixed(1)} kB\n`);
}
