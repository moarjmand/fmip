/**
 * The agents console's host (D-340): `CONSOLE_HOST`, e.g.
 * `agents.traveltohormuz.ir`. On that host every path is the console's
 * (`/agents/x` is served by `app/console/agents/x`); on every other host the
 * console does not exist and `/console/...` is a 404. Unset, there is no
 * console anywhere. Pure, so the proxy's rule is tested once.
 */

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

/** Where the proxy sends a request, given its host and path. */
export function consoleRoute(
  header: string | null,
  pathname: string,
  consoleHost: string | undefined,
): { kind: 'console'; pathname: string } | { kind: 'hidden' } | { kind: 'site' } {
  if (isConsoleHost(header, consoleHost)) {
    if (pathname === CONSOLE_PREFIX || pathname.startsWith(`${CONSOLE_PREFIX}/`)) {
      return { kind: 'console', pathname };
    }
    return {
      kind: 'console',
      pathname: pathname === '/' ? CONSOLE_PREFIX : `${CONSOLE_PREFIX}${pathname}`,
    };
  }
  if (pathname === CONSOLE_PREFIX || pathname.startsWith(`${CONSOLE_PREFIX}/`))
    return { kind: 'hidden' };
  return { kind: 'site' };
}
