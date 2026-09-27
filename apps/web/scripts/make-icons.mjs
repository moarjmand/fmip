// Draws the PWA icons (T-082) from the mark (T-604, D-089) without an image
// library: `public/icons/mark.svg` is read, its shapes rasterised with 4x4
// supersampling, and the result written as PNG through zlib.
//
//   node scripts/make-icons.mjs           write the icons under public/icons
//   node scripts/make-icons.mjs --check   exit 1 if a committed icon differs
//
// The mark is deliberately limited to what this file can draw: a first
// `<rect>` covering the whole view box (the tile) followed by `<rect>` and
// `<circle>` shapes with a hex `fill`. Anything else is refused rather than
// silently left out of the icons.
import { deflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const SOURCE = join(OUT, 'mark.svg');
const SAMPLES = 4;
/**
 * A maskable icon may be cropped to a circle of 40% of its size around the
 * centre; the tile is drawn full bleed and the figure shrunk into that zone.
 */
const MASKABLE_SCALE = 0.8;

const ICONS = [
  ['icon-192.png', 192, { maskable: false }],
  ['icon-512.png', 512, { maskable: false }],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, { maskable: true }],
];

function attributes(text) {
  const out = {};
  for (const [, name, value] of text.matchAll(/([a-z-]+)="([^"]*)"/g)) out[name] = value;
  return out;
}

function hex(value) {
  const match = /^#([0-9a-f]{6})$/i.exec(value ?? '');
  if (!match) throw new Error(`mark.svg: fill must be a six-digit hex colour, got ${value}`);
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The mark's shapes, in paint order, in view-box units. */
function parseMark(svg) {
  const body = svg.replace(/<!--[\s\S]*?-->/g, '');
  const view = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(body);
  if (!view || view[1] !== view[2]) throw new Error('mark.svg: needs a square viewBox from 0 0');
  const box = Number(view[1]);
  const shapes = [];
  for (const [, tag, rest] of body.matchAll(/<([a-zA-Z]+)\b([^>]*?)\/?>/g)) {
    if (tag === 'svg') continue;
    const a = attributes(rest);
    if (tag === 'rect') {
      shapes.push({
        kind: 'rect',
        x: Number(a.x ?? 0),
        y: Number(a.y ?? 0),
        width: Number(a.width),
        height: Number(a.height),
        rx: Number(a.rx ?? 0),
        fill: hex(a.fill),
      });
    } else if (tag === 'circle') {
      shapes.push({
        kind: 'circle',
        cx: Number(a.cx),
        cy: Number(a.cy),
        r: Number(a.r),
        fill: hex(a.fill),
      });
    } else {
      throw new Error(`mark.svg: <${tag}> cannot be drawn by make-icons.mjs`);
    }
  }
  const tile = shapes[0];
  if (
    !tile ||
    tile.kind !== 'rect' ||
    tile.x !== 0 ||
    tile.y !== 0 ||
    tile.width !== box ||
    tile.height !== box
  ) {
    throw new Error('mark.svg: the first shape must be a rect covering the whole view box');
  }
  return { box, tile, figure: shapes.slice(1) };
}

function inside(shape, x, y) {
  if (shape.kind === 'circle') return Math.hypot(x - shape.cx, y - shape.cy) <= shape.r;
  const { x: left, y: top, width, height, rx } = shape;
  if (x < left || x > left + width || y < top || y > top + height) return false;
  if (rx <= 0) return true;
  const dx = Math.max(left + rx - x, x - (left + width - rx), 0);
  const dy = Math.max(top + rx - y, y - (top + height - rx), 0);
  return Math.hypot(dx, dy) <= rx;
}

/** A pixel function for `png`: the mark at `size` pixels. */
function draw({ box, tile, figure }, size, { maskable }) {
  const unit = box / size;
  const centre = box / 2;
  const scale = maskable ? MASKABLE_SCALE : 1;
  const bleed = maskable ? { ...tile, rx: 0 } : tile;
  return (px, py) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let covered = 0;
    for (let sy = 0; sy < SAMPLES; sy += 1) {
      for (let sx = 0; sx < SAMPLES; sx += 1) {
        const x = (px + (sx + 0.5) / SAMPLES) * unit;
        const y = (py + (sy + 0.5) / SAMPLES) * unit;
        if (!inside(bleed, x, y)) continue;
        // The figure is sampled in its own coordinates, shrunk around the centre.
        const fx = centre + (x - centre) / scale;
        const fy = centre + (y - centre) / scale;
        let colour = tile.fill;
        for (const shape of figure) if (inside(shape, fx, fy)) colour = shape.fill;
        r += colour[0];
        g += colour[1];
        b += colour[2];
        covered += 1;
      }
    }
    if (covered === 0) return [0, 0, 0, 0];
    const alpha = Math.round((covered / (SAMPLES * SAMPLES)) * 255);
    return [Math.round(r / covered), Math.round(g / covered), Math.round(b / covered), alpha];
  };
}

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

const check = process.argv.includes('--check');
const mark = parseMark(readFileSync(SOURCE, 'utf8'));
mkdirSync(OUT, { recursive: true });
let stale = 0;
for (const [name, size, options] of ICONS) {
  const image = png(size, draw(mark, size, options));
  const path = join(OUT, name);
  if (check) {
    let committed = null;
    try {
      committed = readFileSync(path);
    } catch {
      // Missing counts as stale.
    }
    if (committed === null || !committed.equals(image)) {
      stale += 1;
      process.stdout.write(`stale ${name}: run node scripts/make-icons.mjs\n`);
    }
  } else {
    writeFileSync(path, image);
    process.stdout.write(`wrote ${name}\n`);
  }
}
if (stale > 0) process.exit(1);
