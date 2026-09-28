// Performance budgets (T-808): the first-load JavaScript of the busiest pages,
// measured from the production build's own output, against the numbers in
// `perf-budgets.json`.
//
//   pnpm --filter @fmip/web perf:bundle   # after `next build`; exit 1 over budget
//
// "First-load JavaScript" is every script the server-rendered HTML of a route
// makes the browser fetch before anything else happens: the build's root main
// files (the runtime every page shares) plus the entry chunks of the route's
// layouts, error boundaries and page, as the route's client-reference
// manifest lists them. The `noModule` polyfill is left out, since no browser
// the product supports downloads it. Sizes are gzip, because that is what
// `next start` sends and what a phone pays for. Chunks loaded later by a
// dynamic import are not first-load and are not counted.
//
// The Playwright budget spec (`tests/e2e/budgets/`) checks that this list is
// exactly the scripts the served HTML names, so the reading below cannot
// drift from what Next actually ships without CI saying so.
//
// No dependency: Node's zlib and vm, and the files `next build` writes. No
// `import.meta` either: Playwright loads this module through its CommonJS
// transform, where `import.meta` does not parse. Callers pass the paths.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { gzipSync } from 'node:zlib';

/** The budgets file, parsed and checked for shape. Throws on a malformed entry. */
export function readBudgets(file) {
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed.routes) || parsed.routes.length === 0) {
    throw new Error(`${file}: "routes" must be a non-empty list`);
  }
  for (const route of parsed.routes) {
    for (const key of ['name', 'appRoute', 'path']) {
      if (typeof route[key] !== 'string' || route[key] === '') {
        throw new Error(`${file}: every route needs a "${key}" (${JSON.stringify(route)})`);
      }
    }
    for (const key of ['firstLoadJsGzipKB', 'serverResponseMedianMs']) {
      if (typeof route[key] !== 'number' || !(route[key] > 0)) {
        throw new Error(`${file}: ${route.name}.${key} must be a positive number`);
      }
    }
  }
  return parsed.routes;
}

/**
 * The scripts a route's HTML loads first, as `static/chunks/...` paths
 * relative to `.next`, in a stable order.
 */
export function firstLoadScripts(nextDir, appRoute) {
  const buildManifest = JSON.parse(readFileSync(join(nextDir, 'build-manifest.json'), 'utf8'));
  const manifestFile = join(
    nextDir,
    'server',
    'app',
    appRoute,
    'page_client-reference-manifest.js',
  );
  if (!existsSync(manifestFile)) {
    throw new Error(
      `No build output for ${appRoute} (${manifestFile}). Run \`next build\` first, ` +
        'or correct "appRoute" in perf-budgets.json if the route moved.',
    );
  }
  // The manifest is a script that assigns to a global; run it in an empty
  // context and read what it assigned. It is our own build output.
  const context = {};
  runInNewContext(readFileSync(manifestFile, 'utf8'), context);
  const manifest = context.__RSC_MANIFEST?.[`${appRoute}/page`];
  if (manifest === undefined) {
    throw new Error(`${manifestFile} does not describe ${appRoute}/page`);
  }
  const scripts = new Set(buildManifest.rootMainFiles ?? []);
  for (const chunks of Object.values(manifest.entryJSFiles ?? {})) {
    for (const chunk of chunks) scripts.add(chunk);
  }
  for (const polyfill of buildManifest.polyfillFiles ?? []) scripts.delete(polyfill);
  return [...scripts].sort();
}

/** Bytes on the wire: gzip at zlib's default level, the one `next start` uses. */
export function gzipBytes(file) {
  return gzipSync(readFileSync(file)).length;
}

/** One route's first-load JavaScript, raw and gzip, in bytes. */
export function measureFirstLoadJs(nextDir, appRoute) {
  const scripts = firstLoadScripts(nextDir, appRoute);
  let raw = 0;
  let gzip = 0;
  for (const script of scripts) {
    const file = join(nextDir, script);
    raw += readFileSync(file).length;
    gzip += gzipBytes(file);
  }
  return { scripts, raw, gzip };
}

const kb = (bytes) => (bytes / 1000).toFixed(1);

/**
 * Each budget against its measurement. Returns one line per route and the
 * failures; a failure names the route, the number and the budget.
 */
export function compareFirstLoadJs(budgets, measure) {
  const lines = [];
  const failures = [];
  for (const route of budgets) {
    const { gzip, raw, scripts } = measure(route.appRoute);
    const verdict = gzip <= route.firstLoadJsGzipKB * 1000 ? 'ok' : 'OVER BUDGET';
    const line =
      `${route.name} (${route.appRoute}): first-load JS ${kb(gzip)} kB gzip ` +
      `(${kb(raw)} kB raw, ${scripts.length} scripts), budget ${route.firstLoadJsGzipKB} kB -- ${verdict}`;
    lines.push(line);
    if (verdict !== 'ok') failures.push(line);
  }
  return { lines, failures };
}
