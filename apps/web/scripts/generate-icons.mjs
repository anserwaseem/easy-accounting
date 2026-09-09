#!/usr/bin/env node
/**
 * Generates the PWA app icons as plain PNGs with no image-library dependency:
 * a solid brand-color square (rounded corners) with the "EA" initials drawn
 * from a hand-written 5x7 bitmap font, encoded to PNG via Node's built-in
 * zlib. Run with `node scripts/generate-icons.mjs` whenever the icon design
 * changes; the output is committed under public/icons so the build doesn't
 * need to regenerate them.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(dirname, '../public/icons');
mkdirSync(outDir, { recursive: true });

// Matches the app's palette (see src/index.css: the "Create account" button
// and the app's accent color) and the manifest's theme_color.
const BRAND = [0x2f, 0x6f, 0xed]; // #2f6fed
const WHITE = [0xff, 0xff, 0xff];

// 5x7 bitmap glyphs, 1 = foreground pixel. Classic LED-matrix font subset —
// only the two glyphs this icon needs.
const GLYPHS = {
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
};

function crc32(buf) {
  let c;
  const table = crc32.table ?? (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/**
 * Renders one RGBA icon at `size`x`size` and returns a PNG buffer.
 * `maskable` skips the rounded corners (the OS applies its own mask shape
 * over a maskable icon) and keeps the glyph within the ~80% "safe zone"
 * maskable icons are required to respect.
 */
function renderIcon(size, { maskable = false } = {}) {
  // RGBA pixel buffer, top-to-bottom, row-major.
  const pixels = new Uint8Array(size * size * 4);
  const cornerRadius = maskable ? 0 : Math.round(size * 0.18);

  const setPixel = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
    pixels[i + 3] = a;
  };

  const insideRoundedSquare = (x, y) => {
    const cx = Math.min(x, size - 1 - x);
    const cy = Math.min(y, size - 1 - y);
    if (cx >= cornerRadius || cy >= cornerRadius) return true;
    const dx = cornerRadius - cx;
    const dy = cornerRadius - cy;
    return dx * dx + dy * dy <= cornerRadius * cornerRadius;
  };

  // Background: brand-color rounded square.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (insideRoundedSquare(x, y)) setPixel(x, y, BRAND);
    }
  }

  // Foreground: "EA" from the 5x7 bitmap font, scaled and centered.
  const text = ['E', 'A'];
  const glyphCols = 5;
  const glyphRows = 7;
  const gap = 1; // columns between glyphs
  const totalCols = text.length * glyphCols + (text.length - 1) * gap;
  // Maskable icons must keep content inside the ~80% "safe zone" circle;
  // regular icons can use more of the square since no OS mask is applied.
  const targetFraction = maskable ? 0.55 : 0.66;
  const scale = Math.max(1, Math.floor((size * targetFraction) / totalCols));
  const textWidth = totalCols * scale;
  const textHeight = glyphRows * scale;
  const startX = Math.round((size - textWidth) / 2);
  const startY = Math.round((size - textHeight) / 2);

  let cursorX = startX;
  for (const ch of text) {
    const rows = GLYPHS[ch];
    for (let row = 0; row < glyphRows; row++) {
      for (let col = 0; col < glyphCols; col++) {
        if (rows[row][col] !== '1') continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            setPixel(cursorX + col * scale + sx, startY + row * scale + sy, WHITE);
          }
        }
      }
    }
    cursorX += (glyphCols + gap) * scale;
  }

  // Raw scanlines: each row prefixed with filter-type byte 0 (None).
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0;
    raw.set(pixels.subarray(y * size * 4, (y + 1) * size * 4), rowStart + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const idat = deflateSync(raw);

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  const png = renderIcon(size);
  const outPath = path.join(outDir, `icon-${size}.png`);
  writeFileSync(outPath, png);
  console.log(`wrote ${outPath} (${png.length} bytes)`);
}

// Maskable variant: full-bleed background (no rounded corners baked in,
// since the OS applies its own mask shape) with the glyph kept inside the
// safe zone, as required for a manifest icon purpose of "maskable".
const maskablePng = renderIcon(512, { maskable: true });
writeFileSync(path.join(outDir, 'icon-maskable-512.png'), maskablePng);
console.log('wrote icon-maskable-512.png');
