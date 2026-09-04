// Renders the app mark — a terminal prompt, `>_` — and writes every raster
// Expo asks for. Pure node, with the PNG encoder hand-rolled below, so
// regenerating needs no image tooling and no dependency:
//
//   node scripts/gen-icons.mjs            # write the assets
//   node scripts/gen-icons.mjs --preview  # …and a big one to look at
//
// The same geometry is written out by hand as `assets/icon.svg`, which is the
// vector the README and any web chrome use. A change here means editing that
// too — the two are mirrors, not one generated from the other, because
// rasterizing SVG is exactly the dependency this file exists to avoid.
//
// Expo takes PNG and only PNG for `icon` and `adaptiveIcon`. Three come out:
//
//   icon.png            full-bleed square, mark on the app's near-black
//   adaptive-icon.png   Android foreground layer, transparent, inside the
//                       safe zone the launcher's mask leaves alone
//   favicon.png         the browser tab
//
// See app.json, which names all three.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

// The palette from mobile/lib/theme.ts. There is only a dark set.
const BACKGROUND = [0x0a, 0x0a, 0x0a];
const FOREGROUND = [0xfa, 0xfa, 0xfa];

// --- drawing ---------------------------------------------------------------

/** Distance from p to the segment a→b, which is how every stroke is drawn. */
function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const lenSq = vx * vx + vy * vy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / lenSq));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

/**
 * Coverage (0 or 1) of the mark at a point, in coordinates centred on the mark
 * with y down and the mark `size` across. Round caps and joins come free from
 * measuring distance to a segment rather than filling a polygon.
 *
 * `>_` — a prompt waiting for you to say something, which is the whole app.
 */
function makeMark(size) {
  const w = size * 0.115; // stroke width
  const chevron = [
    [-0.26, -0.24, -0.03, 0.0],
    [-0.03, 0.0, -0.26, 0.24],
  ];
  const bar = [0.07, 0.24, 0.3, 0.24];
  const segments = [...chevron, bar].map((s) => s.map((n) => n * size));
  return (x, y) => {
    for (const [ax, ay, bx, by] of segments) {
      if (distToSegment(x, y, ax, ay, bx, by) <= w / 2) return 1;
    }
    return 0;
  };
}

/**
 * An RGBA bitmap, 4×4 supersampled so the diagonals do not stair-step.
 *
 * `scale` is how much of the canvas the mark spans, which is the only thing
 * that differs between the three: a launcher mask crops an adaptive icon hard,
 * so its foreground is drawn small enough to survive the crop.
 */
function render(canvas, { scale, background }) {
  const mark = makeMark(canvas * scale);
  const px = new Uint8Array(canvas * canvas * 4);
  const SS = 4;
  for (let y = 0; y < canvas; y++) {
    for (let x = 0; x < canvas; x++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          hits += mark(x + (sx + 0.5) / SS - canvas / 2, y + (sy + 0.5) / SS - canvas / 2);
        }
      }
      const coverage = hits / (SS * SS);
      const i = (y * canvas + x) * 4;
      if (background) {
        // Composited rather than left transparent, so the anti-aliased edge is
        // the two colours mixing instead of the foreground fading to nothing.
        for (let c = 0; c < 3; c++) {
          px[i + c] = Math.round(FOREGROUND[c] * coverage + background[c] * (1 - coverage));
        }
        px[i + 3] = 255;
      } else {
        px[i] = FOREGROUND[0];
        px[i + 1] = FOREGROUND[1];
        px[i + 2] = FOREGROUND[2];
        px[i + 3] = Math.round(coverage * 255);
      }
    }
  }
  return px;
}

// --- PNG encoding ----------------------------------------------------------

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // Raw scanlines, each prefixed with filter byte 0 (none).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- output ----------------------------------------------------------------

const assets = join(dirname(dirname(fileURLToPath(import.meta.url))), "assets");
mkdirSync(assets, { recursive: true });

const write = (name, size, options) =>
  writeFileSync(join(assets, name), encodePng(size, render(size, options)));

// 1024 is what Expo's own template ships and what its resizer wants as input.
write("icon.png", 1024, { scale: 0.62, background: BACKGROUND });
// A launcher mask keeps the middle ~66% of an adaptive icon and may crop to a
// circle, so the mark is drawn smaller than it is on the flat icon rather than
// trusting the corners to survive. The background layer is a colour in
// app.json — a solid fill is not worth a file.
write("adaptive-icon.png", 1024, { scale: 0.52 });
write("favicon.png", 48, { scale: 0.66, background: BACKGROUND });

if (process.argv.includes("--preview")) {
  write("icon-preview.png", 128, { scale: 0.62, background: BACKGROUND });
  // The foreground layer over its background colour, cropped the way a launcher crops it.
  write("adaptive-preview.png", 128, { scale: 0.52 / 0.667, background: BACKGROUND });
}

console.log("wrote icon.png, adaptive-icon.png and favicon.png to mobile/assets");
