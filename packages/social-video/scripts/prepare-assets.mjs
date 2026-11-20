// Copies the faces into `public/fonts`, which the bundle serves: the social
// card's static TrueType files from apps/web (one copy in git, there) and
// Vazirmatn's variable file from its package. Nothing is fetched.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'public', 'fonts');
mkdirSync(out, { recursive: true });

const card = join(here, '..', '..', '..', 'apps', 'web', 'public', 'fonts', 'card');
const faces = readdirSync(card).filter((file) => file.endsWith('.ttf'));
if (faces.length < 6) throw new Error(`Expected the card's six faces in ${card}`);
for (const file of faces) copyFileSync(join(card, file), join(out, file));

const require = createRequire(import.meta.url);
const vazirmatn = dirname(require.resolve('@fontsource-variable/vazirmatn/package.json'));
const persian = 'vazirmatn-arabic-wght-normal.woff2';
copyFileSync(join(vazirmatn, 'files', persian), join(out, persian));

console.log(`Faces in ${out}: ${[...faces, persian].join(', ')}`);
