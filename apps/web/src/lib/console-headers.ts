/**
 * The response headers of every agents-console route (T-1881, D-340, D-341):
 * never framed, never cached, never indexed, no referrer, and an enforced
 * content policy that names only what the console loads. Pure, so the proxy's
 * headers are tested once; `deploy/Caddyfile` repeats the frame, cache,
 * referrer and index headers at the edge, and cannot repeat the nonce.
 *
 * While the console shares the site's origin (`CONSOLE_PATH`, D-341) these do
 * not make a script already running on a site page harmless: it can still
 * `fetch` a console page. They stop the console being framed, and they stop a
 * script that is not the console's own from running on a console page.
 */

/** A fresh value per request: 128 random bits, base64. */
export function consoleNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * The console's content policy, enforced. Next reads the nonce from the
 * request's copy of this header and puts it on every script it writes, so
 * the console's pages must be rendered per request (they all are: each reads
 * the request).
 *
 * - `script-src`: the nonce, and what a script with it loads
 *   (`'strict-dynamic'`, under which browsers ignore `'self'`; `'self'` is for
 *   one that does not know it). No `'unsafe-inline'`, and `'unsafe-eval'` only
 *   under `next dev`, where React rebuilds server stacks with `eval`.
 * - `style-src`: this origin and inline styles, with no nonce. The page's
 *   stylesheet is inlined as a `<style>` (`experimental.inlineCss`, D-246),
 *   and Next 16.3 writes that tag without the nonce: it hands React one
 *   nonce, which React puts on scripts only. A nonce here would leave the
 *   console unstyled (seen: the browser refused the tag). The server-rendered
 *   bars and charts also carry `style=""` (a width, a colour). A style cannot
 *   run script, and what it could load is held to this origin by the rest.
 * - `img-src`: the console's own pictures, a pasted picture's preview
 *   (`blob:`) and `data:`.
 * - `worker-src`: the reminders' service worker, on this origin.
 * - Nothing is framed, by the console or of it.
 */
export function consoleContentPolicy(nonce: string, development = false): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-src 'none'",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/**
 * The policy of a request picture and of its upload's answer (T-1731,
 * D-357): nothing loads and nothing runs, as the API says of the bytes it
 * streams. The proxy's header is the one the browser gets (a route handler's
 * own does not replace it), so it is said here.
 */
export const CONSOLE_PICTURE_POLICY = "default-src 'none'; sandbox; frame-ancestors 'none'";

/** Whether a console route (`/console/...`) is a request picture's. */
export function isConsolePicture(pathname: string): boolean {
  return pathname.startsWith('/console/request-images/');
}

/**
 * What a console answer carries besides its content policy. Also on the 404
 * a host that is not the console's gives for `/console/...`.
 */
export const CONSOLE_HEADERS: Readonly<Record<string, string>> = {
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};

/** The policy of an answer that is not a console page: it only refuses framing. */
export const CONSOLE_FRAME_POLICY = "frame-ancestors 'none'";
