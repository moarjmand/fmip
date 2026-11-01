/**
 * The agents console's host (D-340): `CONSOLE_HOST`, e.g.
 * `agents.traveltohormuz.ir`. On that host every path is the console's
 * (`/agents/x` is served by `app/console/agents/x`); on every other host the
 * console does not exist and `/console/...` is a 404. Unset, there is no
 * console anywhere. Pure, so the proxy's rule is tested once.
 *
 * `CONSOLE_PATH` (D-341), e.g. `/agents`, also serves the console under that
 * path on every other host, until the console's own host has its DNS record:
 * `traveltohormuz.ir/agents/x` is `app/console/x`. The proxy then tells the
 * pages their base in `CONSOLE_BASE_HEADER`, so links, redirects and the
 * cookie's path keep the prefix; on the console's host the base is empty.
 */

/** The request header the proxy sets on every console route: its base path. */
export const CONSOLE_BASE_HEADER = 'x-fmip-console-base';

/** The prefix the console's routes live under in `app/`. */
export const CONSOLE_PREFIX = '/console';

/** A `Host` header's name, without its port, in lower case. */
export function hostName(header: string | null): string {
  if (header === null) return '';
  const name = header.trim().toLowerCase();
  return name.startsWith('[') ? name.slice(0, name.indexOf(']') + 1) : name.replace(/:\d+$/, '');
}

export function isConsoleHost(header: string | null, consoleHost: string | undefined): boolean {
  const wanted = hostName(consoleHost ?? null);
  return wanted !== '' && hostName(header) === wanted;
}

/** `CONSOLE_PATH` as a clean `/segment`, or '' when unset or malformed. */
export function consolePathOf(raw: string | undefined): string {
  const path = (raw ?? '').trim().replace(/\/+$/, '');
  return /^\/[a-z0-9-]+$/.test(path) && path !== CONSOLE_PREFIX ? path : '';
}

/** A console path (`/`, `/board`, `/findings?x=1`) under its base. */
export function consoleHref(base: string, path: string): string {
  if (base === '') return path;
  return path === '/' ? base : `${base}${path}`;
}

/** Where the proxy sends a request, given its host and path. */
export function consoleRoute(
  header: string | null,
  pathname: string,
  consoleHost: string | undefined,
  consolePath?: string,
): { kind: 'console'; pathname: string; base: string } | { kind: 'hidden' } | { kind: 'site' } {
  if (isConsoleHost(header, consoleHost)) {
    if (pathname === CONSOLE_PREFIX || pathname.startsWith(`${CONSOLE_PREFIX}/`)) {
      return { kind: 'console', pathname, base: '' };
    }
    return {
      kind: 'console',
      pathname: pathname === '/' ? CONSOLE_PREFIX : `${CONSOLE_PREFIX}${pathname}`,
      base: '',
    };
  }
  const base = consolePathOf(consolePath);
  if (base !== '' && (pathname === base || pathname.startsWith(`${base}/`))) {
    const rest = pathname.slice(base.length);
    return { kind: 'console', pathname: `${CONSOLE_PREFIX}${rest === '/' ? '' : rest}`, base };
  }
  if (pathname === CONSOLE_PREFIX || pathname.startsWith(`${CONSOLE_PREFIX}/`))
    return { kind: 'hidden' };
  return { kind: 'site' };
}
