// Server-side only, like console-api.ts: `next/headers` has no client build.
import { headers } from 'next/headers';
import { CONSOLE_BASE_HEADER, consoleHref, consolePathOf } from './console-host';

/**
 * The agents console's base path for this request (D-341): '' on its own
 * host, `CONSOLE_PATH` (e.g. `/agents`) where it shares the site's host. The
 * proxy sets the header on every console route, over anything sent.
 */
export async function consoleBase(): Promise<string> {
  return consolePathOf((await headers()).get(CONSOLE_BASE_HEADER) ?? undefined);
}

/** A console path for a link or a redirect, under this request's base. */
export async function consoleUrl(path: string): Promise<string> {
  return consoleHref(await consoleBase(), path);
}
