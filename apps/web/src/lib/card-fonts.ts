import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The faces the share cards are drawn in (T-1723, D-351): static TrueType
 * files, because `next/og`'s renderer reads TTF, OTF and WOFF but not WOFF2,
 * and cannot pick a width from a variable font (no `font-stretch`). All four
 * families are under the SIL Open Font License 1.1, unmodified, with their
 * licences beside them in `public/fonts/card/`:
 *
 * - Archivo 400, 700 and 800: the interface face (D-263).
 * - Archivo Narrow 700: the condensed score, where the Design System asks for
 *   Archivo at 75% width.
 * - Archivo Black: the stamp and the wordmark, where it asks for an expanded
 *   black (125%).
 * - Geist Mono 400: the receipt voice -- the eyebrow, the model's version,
 *   the time a pick was made.
 *
 * They live in `public`, which the image copies whole (the `Dockerfile` checks
 * for them) and the build also traces into the standalone server; that server
 * runs from the app's folder, so the path is the same in development and
 * production.
 * Read once per process. A face that cannot be read leaves the card in the
 * renderer's own face rather than failing it.
 */

export interface CardFont {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 700 | 800 | 900;
  style: 'normal';
}

export const CARD_FACES = {
  sans: 'Archivo',
  narrow: 'Archivo Narrow',
  black: 'Archivo Black',
  mono: 'Geist Mono',
} as const;

const FILES: readonly { file: string; name: string; weight: CardFont['weight'] }[] = [
  { file: 'Archivo-Regular.ttf', name: CARD_FACES.sans, weight: 400 },
  { file: 'Archivo-Bold.ttf', name: CARD_FACES.sans, weight: 700 },
  { file: 'Archivo-ExtraBold.ttf', name: CARD_FACES.sans, weight: 800 },
  { file: 'ArchivoNarrow-Bold.ttf', name: CARD_FACES.narrow, weight: 700 },
  { file: 'ArchivoBlack-Regular.ttf', name: CARD_FACES.black, weight: 900 },
  { file: 'GeistMono-Regular.ttf', name: CARD_FACES.mono, weight: 400 },
];

let loading: Promise<CardFont[]> | null = null;

async function load(): Promise<CardFont[]> {
  const read = await Promise.all(
    FILES.map(async ({ file, name, weight }) => {
      try {
        // A path scoped to the folder, so the build traces that folder alone.
        const bytes = await readFile(join(process.cwd(), 'public', 'fonts', 'card', file));
        const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        return { name, data: data as ArrayBuffer, weight, style: 'normal' as const };
      } catch {
        return null;
      }
    }),
  );
  return read.filter((font): font is CardFont => font !== null);
}

/** Every face that could be read; an empty list draws in the renderer's default. */
export function cardFonts(): Promise<CardFont[]> {
  loading ??= load();
  return loading;
}
