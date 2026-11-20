// Builds the Remotion bundle into `build/` once, at image build time: a
// render never bundles (T-1932: "a bundle built into the image, never at run
// time"), so its seconds and its memory are the renderer's alone.
import { bundle } from '@remotion/bundler';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const started = performance.now();
const location = await bundle({
  entryPoint: join(root, 'src', 'index.ts'),
  outDir: join(root, 'build'),
  publicDir: join(root, 'public'),
  // Built once per image: a webpack cache would only be 209 MB of dead weight in it.
  enableCaching: false,
});
console.log(`Bundled to ${location} in ${((performance.now() - started) / 1000).toFixed(1)} s`);
