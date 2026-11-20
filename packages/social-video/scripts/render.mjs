// Renders one clip (and, with --stills, PNG frames) from the prebuilt bundle
// and measures it: seconds on the wall clock from process start, and the
// container's own peak memory from its cgroup. T-1931's instrument; the
// product's worker is T-1932.
//
//   node scripts/render.mjs --aspect 9x16 --concurrency 1 --out /out/a.mp4
//   node scripts/render.mjs --aspect 4x5 --locale fa --stills 45,225,449 --no-video --out /out/fa
//
// Flags: --aspect 9x16|4x5, --locale en|fa, --concurrency <n>|default,
// --props <file>, --out <file.mp4 or prefix>, --stills <frames>, --no-video,
// --label <text>.
const started = performance.now();

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
// Plain TypeScript with nothing to transform: Node 22.18+ runs it as it is.
import { parseClipProps } from '../src/props.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const aspect = flag('aspect', '9x16');
const locale = flag('locale', 'en');
const concurrencyArg = flag('concurrency', '1');
const concurrency = concurrencyArg === 'default' ? null : Number(concurrencyArg);
const out = flag('out', join(root, 'out', `matchday-preview-${aspect}-${locale}.mp4`));
const stills = (flag('stills', '') || '').split(',').filter(Boolean).map(Number);
const video = !argv.includes('--no-video');
const label = flag('label', '');
const serveUrl = join(root, 'build');
if (!existsSync(join(serveUrl, 'index.html')))
  throw new Error('No bundle: run `pnpm bundle` first');

const propsFile = flag('props', join(root, 'fixtures', 'matchday-preview.json'));
const inputProps = parseClipProps({ ...JSON.parse(readFileSync(propsFile, 'utf8')), locale });

// The container's memory, from cgroup v2. `memory.peak` is the kernel's own
// high-water mark of everything charged to the container (what the limit is
// enforced on, page cache included); anon + shmem is the part that cannot be
// dropped, sampled four times a second.
const CGROUP = '/sys/fs/cgroup';
const cgroup = (file) => {
  try {
    return readFileSync(join(CGROUP, file), 'utf8').trim();
  } catch {
    return null;
  }
};
const stat = (text, key) => Number(new RegExp(`^${key} (\\d+)$`, 'm').exec(text ?? '')?.[1] ?? 0);
let peakUnreclaimable = 0;
let peakCurrentSampled = 0;
const sample = () => {
  const text = cgroup('memory.stat');
  if (text)
    peakUnreclaimable = Math.max(peakUnreclaimable, stat(text, 'anon') + stat(text, 'shmem'));
  peakCurrentSampled = Math.max(peakCurrentSampled, Number(cgroup('memory.current') ?? 0));
};
const sampler = setInterval(sample, 250);

// How busy the whole machine was meanwhile (every CPU the container can see
// in /proc/stat, this render included): a render's seconds mean little
// without it on a shared computer.
const machine = () => {
  try {
    const [, ...fields] = readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/);
    const jiffies = fields.map(Number);
    return { total: jiffies.reduce((a, b) => a + b, 0), idle: jiffies[3] + jiffies[4] };
  } catch {
    return null;
  }
};
const machineBefore = machine();

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const mb = (bytes) => (bytes == null ? null : Math.round((Number(bytes) / 1048576) * 10) / 10);
const seconds = (since) => Math.round((performance.now() - since) / 100) / 10;

const composition = await selectComposition({
  serveUrl,
  id: `matchday-preview-${aspect}`,
  inputProps,
  logLevel: 'warn',
});
const selected = seconds(started);

const result = {
  label,
  aspect,
  locale,
  size: `${composition.width}x${composition.height}`,
  fps: composition.fps,
  frames: composition.durationInFrames,
  concurrency: concurrency ?? 'default',
  cpus_seen: os.availableParallelism(),
  cpu_max: cgroup('cpu.max'),
  memory_max_mb: mb(cgroup('memory.max')),
  select_s: selected,
};

if (video) {
  mkdirSync(dirname(out), { recursive: true });
  const rendering = performance.now();
  let encodedAt = null;
  await renderMedia({
    composition,
    serveUrl,
    inputProps,
    codec: 'h264',
    pixelFormat: 'yuv420p',
    enforceAudioTrack: true,
    outputLocation: out,
    concurrency,
    logLevel: 'warn',
    onProgress: ({ renderedFrames }) => {
      if (encodedAt === null && renderedFrames === composition.durationInFrames)
        encodedAt = seconds(rendering);
    },
  });
  Object.assign(result, {
    render_s: seconds(rendering),
    frames_done_s: encodedAt,
    file: out,
    file_mb: mb(statSync(out).size),
    sha256: sha256(out),
  });
}

const stillsOut = [];
for (const frame of stills) {
  const file = `${out.replace(/\.mp4$/, '')}-f${String(frame).padStart(3, '0')}.png`;
  mkdirSync(dirname(file), { recursive: true });
  await renderStill({
    composition,
    serveUrl,
    inputProps,
    frame,
    output: file,
    imageFormat: 'png',
    logLevel: 'warn',
  });
  stillsOut.push({ frame, file, sha256: sha256(file) });
}
if (stillsOut.length > 0) result.stills = stillsOut;

clearInterval(sampler);
sample();
const events = cgroup('memory.events');
const cpu = cgroup('cpu.stat');
const chrome = (() => {
  // The headless shell `ensureBrowser()` put under this package's node_modules/.remotion.
  try {
    const file = join(root, 'node_modules', '.remotion', 'chrome-headless-shell', 'VERSION');
    return readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
})();
Object.assign(result, {
  total_s: seconds(started),
  peak_mb: mb(cgroup('memory.peak')),
  peak_sampled_mb: mb(peakCurrentSampled),
  peak_anon_shmem_mb: mb(peakUnreclaimable),
  // What the render itself cost in CPU, whatever else the host was doing:
  // the seconds of CPU the container used, and how long its quota held it back.
  machine_busy_cpus: (() => {
    const after = machine();
    if (!machineBefore || !after || after.total === machineBefore.total) return null;
    const busy = 1 - (after.idle - machineBefore.idle) / (after.total - machineBefore.total);
    return Math.round(busy * os.cpus().length * 100) / 100;
  })(),
  cpu_s: cpu ? Math.round(stat(cpu, 'usage_usec') / 1e5) / 10 : null,
  throttled_s: cpu ? Math.round(stat(cpu, 'throttled_usec') / 1e5) / 10 : null,
  hit_limit: events ? stat(events, 'max') : null,
  oom_kills: events ? stat(events, 'oom_kill') : null,
  remotion: require('@remotion/renderer/package.json').version,
  chrome_headless_shell: chrome,
  node: process.version,
});

console.log(JSON.stringify(result));
if (flag('json', '')) writeFileSync(flag('json', ''), `${JSON.stringify(result)}\n`, { flag: 'a' });
process.exit(0);
