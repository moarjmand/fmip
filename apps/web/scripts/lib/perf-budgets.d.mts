// Types for `perf-budgets.mjs`, so the specs that import it are checked (T-808).

export interface RouteBudget {
  /** How the route is named in a failure. */
  name: string;
  /** The App Router route, as `.next/server/app` lays it out: `/[locale]/scores`. */
  appRoute: string;
  /** A real address of that route in the seeded database, for the timed requests. */
  path: string;
  /** First-load JavaScript, gzip, in kilobytes (1,000 bytes). */
  firstLoadJsGzipKB: number;
  /** The median time to the whole HTML document, in milliseconds. */
  serverResponseMedianMs: number;
}

export interface FirstLoadJs {
  scripts: string[];
  raw: number;
  gzip: number;
}

export function readBudgets(file: string): RouteBudget[];
export function firstLoadScripts(nextDir: string, appRoute: string): string[];
export function gzipBytes(file: string): number;
export function measureFirstLoadJs(nextDir: string, appRoute: string): FirstLoadJs;
export function compareFirstLoadJs(
  budgets: RouteBudget[],
  measure: (appRoute: string) => FirstLoadJs,
): { lines: string[]; failures: string[] };
