#!/usr/bin/env node
/**
 * Writes docs/17-file-index.md: every tracked file, grouped by folder, with
 * one line on what it is (T-1701). The line is the file's own header comment
 * (a leading JSDoc block, `//`, `#` or `--` lines, a Python docstring, a
 * Markdown title, a skill's `description:`), so the index says what the code
 * says about itself; a file without one is described by its kind.
 *
 *     node scripts/file-index.mjs           # rewrite the index
 *     node scripts/file-index.mjs --check   # exit 1 when the index is stale
 *
 * docs/03-project-map.md stays the map of responsibilities; this is the
 * exhaustive list beside it, regenerated rather than edited by hand.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname } from 'node:path';

const OUT = 'docs/17-file-index.md';
const MAX = 220;

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f !== '' && f !== OUT);

/** The first sentence or two of a comment, on one line. */
function tidy(text) {
  const flat = text
    .replace(/\s+/g, ' ')
    .replace(/^[-=*#\s]+/, '')
    .trim();
  if (flat === '') return '';
  const end = flat.search(/(?<=[.!?])\s(?=[A-Z`(])/);
  const first = end > 40 ? flat.slice(0, end) : flat;
  return first.length > MAX ? `${first.slice(0, MAX - 1).trimEnd()}…` : first;
}

function jsDoc(text) {
  const head = text.split('\n').slice(0, 150).join('\n');
  // A file-level block (before any code) wins; then the one on the class or
  // function the file is named for; then the first block of all.
  const blocks = [...head.matchAll(/\/\*\*([\s\S]*?)\*\/\s*(\S[^\n]*)?/g)];
  const fileLevel = blocks.find(
    (b) =>
      !/[;{}]/.test(
        head
          .slice(0, b.index)
          .replace(/^\s*import[\s\S]*?;\s*$/gm, '')
          .replace(/['"]use (client|server)['"];?/, ''),
      ),
  );
  const onExport = blocks.find((b) =>
    /^(@(Controller|Injectable|Module)|export (default )?(async )?(class|function))/.test(
      b[2] ?? '',
    ),
  );
  const block = fileLevel ?? onExport ?? blocks[0];
  if (block)
    return block[1]
      .split('\n')
      .map((l) => l.replace(/^\s*\*\s?/, ''))
      .join(' ');
  const lines = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t === '' && lines.length === 0) continue;
    if (/^['"]use (client|server)['"]/.test(t) || t.startsWith('#!')) continue;
    if (!t.startsWith('//')) break;
    lines.push(t.replace(/^\/\/\s?/, ''));
  }
  return lines.join(' ');
}

function hashLines(text) {
  const lines = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.startsWith('#!') || (t === '' && lines.length === 0)) continue;
    if (!t.startsWith('#')) {
      if (lines.length > 0 || !/^(set |# syntax)/.test(t)) break;
      continue;
    }
    if (/^#\s*syntax=/.test(t)) continue;
    lines.push(t.replace(/^#+\s?/, ''));
  }
  return lines.join(' ');
}

function sqlLines(text) {
  const lines = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (/^--\s*(Up|Down) Migration/i.test(t) || /^--\s*-{3,}/.test(t)) continue;
    if (t === '' && lines.length === 0) continue;
    if (!t.startsWith('--')) break;
    lines.push(t.replace(/^--\s?/, ''));
  }
  return lines.join(' ');
}

function pyDoc(text) {
  const doc = text.match(/^\s*(?:#.*\n|\s)*(?:r|u)?("""|''')([\s\S]*?)\1/);
  return doc ? doc[2] : hashLines(text);
}

function markdown(text) {
  const front = text.match(/^---\n([\s\S]*?)\n---/);
  const desc = front?.[1].match(/^description:\s*(.+)$/m);
  if (desc) return desc[1].replace(/^["']|["']$/g, '');
  const title = text.match(/^#\s+(.+)$/m);
  return title ? title[1] : '';
}

const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.svg', '.ico', '.webp', '.gif', '.avif']);
const FONT = new Set(['.woff', '.woff2', '.ttf', '.otf']);

/** What a file without a usable header is, from its name and place. */
function byKind(path) {
  const name = basename(path);
  const ext = extname(name).toLowerCase();
  const known = {
    '.gitignore': 'Files git leaves out.',
    '.gitattributes': 'Line endings and file types for git.',
    '.dockerignore': 'Files left out of image build contexts.',
    '.editorconfig': 'Editor defaults (indentation, line endings).',
    '.nvmrc': 'The Node version.',
    '.prettierignore': 'Files Prettier leaves alone.',
    'pnpm-workspace.yaml': 'The pnpm workspaces (apps/*, packages/*).',
    'prettier.config.mjs': 'Prettier settings (re-exports @fmip/config).',
    'ci.yml':
      'CI: Verify (format, lint, typecheck, test, build), E2E and E2E journeys, on every PR and main.',
    'uptime.yml': 'Off-machine uptime check of the live site every 10 minutes.',
    'pyproject.toml': 'Python project settings and dependencies.',
    'main.ts': 'Process entry point: builds and starts the application.',
    'globals.css': 'Global styles: Tailwind layers and shared component classes.',
    'tokens.css': 'Design tokens (colours, spacing, type) as CSS variables.',
    'sw.js': 'The service worker.',
  };
  if (known[name]) return known[name];
  if (ext === '.csv') return 'CSV data (fixture or reference).';
  if (ext === '.html' || ext === '.xml') return 'Saved page or feed used as a test fixture.';
  if (IMAGE.has(ext)) return 'Image asset.';
  if (FONT.has(ext)) return 'Font file.';
  if (/\.(spec|test)\.[cm]?[jt]sx?$/.test(name) || /^test_.*\.py$/.test(name))
    return `Tests for \`${name.replace(/\.(spec|test)\.[cm]?[jt]sx?$/, '').replace(/^test_|\.py$/g, '')}\`.`;
  if (name === 'package.json') {
    try {
      const pkg = JSON.parse(readFileSync(path, 'utf8'));
      return `Package \`${pkg.name ?? dirname(path)}\`${pkg.description ? `: ${pkg.description}` : ''}: scripts and dependencies.`;
    } catch {
      return 'Package manifest.';
    }
  }
  if (name === 'tsconfig.json' || name.startsWith('tsconfig.'))
    return 'TypeScript compiler settings.';
  if (/^(eslint|vitest|vite|playwright|postcss|tailwind|stylelint|next)\.config\./.test(name))
    return `${name.split('.')[0][0].toUpperCase()}${name.split('.')[0].slice(1)} configuration.`;
  if (/messages\/[a-z-]+\.json$/i.test(path) || /locales?\//.test(path))
    return `Translation catalogue (${name.replace(/\.json$/, '')}).`;
  if (path.includes('/migrations/'))
    return `Database migration: ${name.replace(/^\d+_|\.sql$/g, '').replace(/-/g, ' ')}.`;
  if (name === 'index.ts' || name === 'index.tsx') return 'Re-exports this folder’s public parts.';
  if (name === 'page.tsx')
    return `Next.js page for the route \`${dirname(path).replace(/^apps\/web\/src\/app/, '') || '/'}\`.`;
  if (name === 'layout.tsx')
    return `Next.js layout for \`${dirname(path).replace(/^apps\/web\/src\/app/, '') || '/'}\`.`;
  if (name === 'route.ts')
    return `Next.js route handler for \`${dirname(path).replace(/^apps\/web\/src\/app/, '')}\`.`;
  if (['loading.tsx', 'error.tsx', 'not-found.tsx'].includes(name))
    return `Next.js ${name.replace('.tsx', '')} state for \`${dirname(path).replace(/^apps\/web\/src\/app/, '') || '/'}\`.`;
  if (name === '__init__.py') return 'Python package marker.';
  if (name === '.gitkeep') return 'Keeps an empty folder in git.';
  if (ext === '.json') return 'JSON data or settings.';
  if (ext === '.lock' || name === 'pnpm-lock.yaml') return 'Exact dependency versions (generated).';
  return '';
}

function describe(path) {
  const ext = extname(path).toLowerCase();
  const name = basename(path);
  if (IMAGE.has(ext) || FONT.has(ext) || name === 'pnpm-lock.yaml') return byKind(path);
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return byKind(path);
  }
  let raw = '';
  if (['.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx', '.css'].includes(ext)) raw = jsDoc(text);
  else if (ext === '.py') raw = pyDoc(text);
  else if (ext === '.sql') raw = sqlLines(text);
  else if (ext === '.md') raw = markdown(text);
  else if (
    [
      '.sh',
      '.yml',
      '.yaml',
      '.toml',
      '.conf',
      '.caddy',
      '.service',
      '.timer',
      '.cfg',
      '.ini',
    ].includes(ext) ||
    [
      'Dockerfile',
      'Caddyfile',
      '.gitignore',
      '.dockerignore',
      '.npmrc',
      '.env.example',
      '.editorconfig',
    ].includes(name)
  )
    raw = hashLines(text);
  const said = tidy(raw);
  return said !== '' ? said : byKind(path) || '—';
}

const groups = new Map();
for (const file of files) {
  const dir = dirname(file);
  if (!groups.has(dir)) groups.set(dir, []);
  groups.get(dir).push(file);
}
const dirs = [...groups.keys()].sort((a, b) =>
  a === '.' ? -1 : b === '.' ? 1 : a.localeCompare(b),
);

const cell = (s) => s.replace(/\|/g, '\\|');
const out = [
  '# File index',
  '',
  `Every file in the repository (${files.length}), grouped by folder, with one line on`,
  'what it is, taken from the file’s own header comment. **Generated** by',
  '`node scripts/file-index.mjs` — never edit by hand; rerun it after adding,',
  'moving or re-describing files. For *why* things are where they are and how',
  'they connect, read `docs/03-project-map.md`; for starting on a new account or',
  'machine, `docs/18-handover.md`.',
  '',
  '## Folders',
  '',
  ...dirs.map(
    (d) => `- [\`${d === '.' ? '(root)' : d}\`](#${anchor(d)}) — ${groups.get(d).length}`,
  ),
  '',
];
function anchor(d) {
  return (d === '.' ? 'root' : d)
    .toLowerCase()
    .replace(/[^a-z0-9\- _]/g, '')
    .replace(/[ _]/g, '-');
}
for (const dir of dirs) {
  out.push(`## ${dir === '.' ? 'root' : dir}`, '', '| File | What it is |', '|---|---|');
  for (const file of groups.get(dir).sort())
    out.push(`| \`${cell(basename(file))}\` | ${cell(describe(file))} |`);
  out.push('');
}
const next = out.join('\n');

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(OUT, 'utf8');
  } catch {
    // no index yet: stale
  }
  if (current !== next) {
    console.error(`${OUT} is stale: run node scripts/file-index.mjs`);
    process.exit(1);
  }
} else {
  writeFileSync(OUT, next);
  const blank = out.filter((l) => l.endsWith('| — |')).length;
  console.log(
    `${OUT}: ${files.length} files in ${dirs.length} folders, ${blank} without a description`,
  );
}
