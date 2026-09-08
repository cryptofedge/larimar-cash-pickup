/**
 * Generate the PNG launcher icons a PWA and a Play Store listing require.
 *
 * The brand mark is an SVG React component, but Android launchers, the Play
 * Console, and the web app manifest all want rasters at fixed sizes. Rather than
 * add an image-processing dependency, this renders the mark directly into an
 * RGBA buffer and encodes a PNG with Node's built-in zlib — the format is simple
 * enough that a correct encoder is about sixty lines, and it keeps the toolchain
 * free of a native binary.
 *
 *   npm run icons   ->  public/icons/*.png
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

// Brand palette (see docs/PRODUCT_REQUIREMENTS.md §1).
const NAVY: RGB = [0x0a, 0x1f, 0x33];
const LARIMAR_400: RGB = [0x4f, 0xb8, 0xd6];
const LARIMAR_200: RGB = [0xcf, 0xe9, 0xf1];

type RGB = [number, number, number];

// ---------------------------------------------------------------------------
// PNG encoding
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/** Encode an RGBA pixel buffer as a PNG. Colour type 6, 8-bit, no interlace. */
function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(6, 9); // colour type: RGBA
  header.writeUInt8(0, 10); // compression
  header.writeUInt8(0, 11); // filter
  header.writeUInt8(0, 12); // interlace

  // Each scanline is prefixed with its filter type. 0 = none; the images are
  // small and flat, so the extra compression from adaptive filtering is not
  // worth the complexity here.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

interface Canvas {
  readonly size: number;
  readonly pixels: Uint8Array;
}

function createCanvas(size: number): Canvas {
  return { size, pixels: new Uint8Array(size * size * 4) };
}

/** Alpha-composite a colour over whatever is already at (x, y). */
function blend(canvas: Canvas, x: number, y: number, color: RGB, alpha: number): void {
  if (alpha <= 0 || x < 0 || y < 0 || x >= canvas.size || y >= canvas.size) return;

  const i = (y * canvas.size + x) * 4;
  const a = Math.min(1, alpha);
  const existingAlpha = (canvas.pixels[i + 3] as number) / 255;
  const outAlpha = a + existingAlpha * (1 - a);
  if (outAlpha === 0) return;

  for (let c = 0; c < 3; c += 1) {
    const src = color[c] as number;
    const dst = canvas.pixels[i + c] as number;
    canvas.pixels[i + c] = Math.round((src * a + dst * existingAlpha * (1 - a)) / outAlpha);
  }
  canvas.pixels[i + 3] = Math.round(outAlpha * 255);
}

/**
 * Coverage of a pixel by a shape, sampled on a 3x3 grid.
 *
 * Cheap supersampling. Without it the arcs alias badly at 48px, which is exactly
 * the size Android shows in a notification tray.
 */
function coverage(x: number, y: number, inside: (px: number, py: number) => boolean): number {
  let hits = 0;
  for (let sy = 0; sy < 3; sy += 1) {
    for (let sx = 0; sx < 3; sx += 1) {
      if (inside(x + (sx + 0.5) / 3, y + (sy + 0.5) / 3)) hits += 1;
    }
  }
  return hits / 9;
}

function fillRoundedRect(canvas: Canvas, radius: number, color: RGB): void {
  const { size } = canvas;
  const inside = (px: number, py: number): boolean => {
    const dx = Math.max(radius - px, px - (size - radius), 0);
    const dy = Math.max(radius - py, py - (size - radius), 0);
    return dx * dx + dy * dy <= radius * radius;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      blend(canvas, x, y, color, coverage(x, y, inside));
    }
  }
}

function fillRect(canvas: Canvas, color: RGB): void {
  for (let y = 0; y < canvas.size; y += 1) {
    for (let x = 0; x < canvas.size; x += 1) {
      blend(canvas, x, y, color, 1);
    }
  }
}

/**
 * One stroke of the mark: a vertical run that turns through a quarter arc into a
 * horizontal run — the L that also reads as a bridge span.
 */
function strokeElbow(
  canvas: Canvas,
  input: {
    top: number;
    left: number;
    cornerY: number;
    right: number;
    radius: number;
    width: number;
    color: RGB;
    alpha?: number;
  },
): void {
  const half = input.width / 2;
  const cx = input.left + input.radius;
  const cy = input.cornerY - input.radius;

  const inside = (px: number, py: number): boolean => {
    // Vertical segment, above the turn.
    if (py <= cy && Math.abs(px - input.left) <= half && py >= input.top) return true;
    // Horizontal segment, right of the turn.
    if (px >= cx && Math.abs(py - input.cornerY) <= half && px <= input.right) return true;
    // The quarter arc joining them.
    if (px <= cx && py >= cy) {
      const d = Math.hypot(px - cx, py - cy);
      return Math.abs(d - input.radius) <= half;
    }
    return false;
  };

  for (let y = 0; y < canvas.size; y += 1) {
    for (let x = 0; x < canvas.size; x += 1) {
      const c = coverage(x, y, inside);
      if (c > 0) blend(canvas, x, y, input.color, c * (input.alpha ?? 1));
    }
  }
}

/**
 * Render the Larimar mark.
 *
 * `maskable` fills the whole square and insets the artwork into the safe zone,
 * because Android crops maskable icons to whatever shape the launcher uses.
 */
function renderMark(size: number, options: { maskable?: boolean } = {}): Canvas {
  const canvas = createCanvas(size);
  const u = size / 40; // the SVG is authored on a 40-unit grid

  if (options.maskable) {
    // Full bleed: the launcher may crop to a circle, squircle, or rounded square.
    fillRect(canvas, NAVY);
  } else {
    fillRoundedRect(canvas, 10 * u, NAVY);
  }

  // Maskable icons must keep artwork inside the central 80% safe zone.
  const scale = options.maskable ? 0.78 : 1;
  const offset = options.maskable ? (size * (1 - scale)) / 2 : 0;
  const p = (value: number): number => value * u * scale + offset;

  // Outer arc — the far bank.
  strokeElbow(canvas, {
    top: p(10),
    left: p(11),
    cornerY: p(29),
    right: p(29),
    radius: 4.5 * u * scale,
    width: 3.2 * u * scale,
    color: LARIMAR_400,
  });

  // Inner arc — the span. The gap between them is the crossing.
  strokeElbow(canvas, {
    top: p(10),
    left: p(17.5),
    cornerY: p(22.6),
    right: p(29),
    radius: 3.6 * u * scale,
    width: 2.4 * u * scale,
    color: LARIMAR_200,
    alpha: 0.75,
  });

  return canvas;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const TARGETS: { file: string; size: number; maskable?: boolean; note: string }[] = [
  { file: 'icon-32.png', size: 32, note: 'favicon' },
  { file: 'icon-180.png', size: 180, note: 'apple-touch-icon' },
  { file: 'icon-192.png', size: 192, note: 'PWA minimum' },
  { file: 'icon-256.png', size: 256, note: 'Android launcher' },
  { file: 'icon-384.png', size: 384, note: 'Android launcher' },
  { file: 'icon-512.png', size: 512, note: 'PWA + Play Store listing' },
  { file: 'icon-maskable-192.png', size: 192, maskable: true, note: 'adaptive icon' },
  { file: 'icon-maskable-512.png', size: 512, maskable: true, note: 'adaptive icon' },
];

mkdirSync('public/icons', { recursive: true });

for (const target of TARGETS) {
  const canvas = renderMark(target.size, { maskable: target.maskable });
  const png = encodePng(target.size, target.size, canvas.pixels);
  writeFileSync(`public/icons/${target.file}`, png);
  console.log(
    `  ${target.file.padEnd(26)} ${String(target.size).padStart(3)}px  ${String(png.length).padStart(6)} bytes  ${target.note}`,
  );
}

console.log(`\nWrote ${TARGETS.length} icons to public/icons/`);
