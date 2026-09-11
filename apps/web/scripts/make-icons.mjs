// Generates the PWA icons (T-082) without an image library: a rounded green
// square with a white ball, written as PNG through zlib. Run once with
// `node scripts/make-icons.mjs`; the output is committed under public/icons.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const GREEN = [11, 107, 58];
const WHITE = [255, 255, 255];
const DARK = [6, 60, 33];

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The mark: a green rounded square (or full bleed when maskable) with a white ball. */
function mark(size, { maskable }) {
  const c = (size - 1) / 2;
  const radius = maskable ? size : size * 0.22;
  const ball = size * (maskable ? 0.26 : 0.3);
  const ring = ball * 0.78;
  return (x, y) => {
    // Rounded-square membership.
    const dx = Math.max(Math.abs(x - c) - (c - radius), 0);
    const dy = Math.max(Math.abs(y - c) - (c - radius), 0);
    const inside = maskable || Math.hypot(dx, dy) <= radius;
    if (!inside) return [0, 0, 0, 0];
    const d = Math.hypot(x - c, y - c);
    if (d <= ring) return [...DARK, 255];
    if (d <= ball) return [...WHITE, 255];
    if (d <= ball + size * 0.03) return [...DARK, 255];
    return [...GREEN, 255];
  };
}

mkdirSync(OUT, { recursive: true });
for (const [name, size, options] of [
  ['icon-192.png', 192, { maskable: false }],
  ['icon-512.png', 512, { maskable: false }],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, { maskable: true }],
]) {
  writeFileSync(join(OUT, name), png(size, mark(size, options)));
  process.stdout.write(`wrote ${name}\n`);
}
