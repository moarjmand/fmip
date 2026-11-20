import { cancelRender, continueRender, delayRender, staticFile } from 'remotion';
import { FACES } from './tokens.ts';

/**
 * The faces, loaded before the first frame (D-454 point 1): the card's own
 * static TrueType files and Vazirmatn's variable file, all from the bundle's
 * `public/fonts` (copied there by `scripts/prepare-assets.mjs`, never from
 * the network). A render waits on `delayRender` until every face is ready,
 * and fails rather than draw in a fallback face.
 */
const FILES: readonly { family: string; file: string; weight: string }[] = [
  { family: FACES.sans, file: 'Archivo-Regular.ttf', weight: '400' },
  { family: FACES.sans, file: 'Archivo-Bold.ttf', weight: '700' },
  { family: FACES.sans, file: 'Archivo-ExtraBold.ttf', weight: '800' },
  { family: FACES.narrow, file: 'ArchivoNarrow-Bold.ttf', weight: '700' },
  { family: FACES.black, file: 'ArchivoBlack-Regular.ttf', weight: '900' },
  { family: FACES.mono, file: 'GeistMono-Regular.ttf', weight: '400' },
  { family: FACES.persian, file: 'vazirmatn-arabic-wght-normal.woff2', weight: '100 900' },
];

let loading: Promise<void> | null = null;

export function loadFonts(): Promise<void> {
  if (loading) return loading;
  const handle = delayRender('Loading the faces');
  loading = Promise.all(
    FILES.map(async ({ family, file, weight }) => {
      const face = new FontFace(family, `url(${staticFile(`fonts/${file}`)})`, { weight });
      document.fonts.add(await face.load());
    }),
  ).then(
    () => continueRender(handle),
    (error: unknown) => cancelRender(error),
  );
  return loading;
}
