/**
 * The session cookie, by hand. A dozen lines of RFC 6265 is smaller than a
 * plugin, and every attribute below is a security decision that should be
 * visible in this file rather than in a library default.
 */

export const SESSION_COOKIE = 'fmip_session';

export interface CookieOptions {
  /** Seconds. `0` expires the cookie immediately. */
  maxAge: number;
  /** Only over HTTPS. On in production; off for local HTTP. */
  secure: boolean;
}

/** `Cookie` header → name/value pairs. Malformed pairs are skipped, not thrown. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (header === undefined) return cookies;

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;

    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name === '') continue;

    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      // Not ours; ignore rather than fail the request.
    }
  }

  return cookies;
}

/**
 * A `Set-Cookie` value for the session.
 *
 * HttpOnly: no script reads it. SameSite=Lax: sent on top-level navigations
 * and same-site requests, not on cross-site POSTs, which is the CSRF posture
 * for a cookie session behind a same-site web app. Path=/: one cookie for the
 * whole API.
 */
export function serializeSessionCookie(value: string, options: CookieOptions): string {
  const attributes = [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${options.maxAge}`,
  ];

  if (options.secure) attributes.push('Secure');

  return attributes.join('; ');
}

export function clearSessionCookie(options: Pick<CookieOptions, 'secure'>): string {
  return serializeSessionCookie('', { maxAge: 0, secure: options.secure });
}
