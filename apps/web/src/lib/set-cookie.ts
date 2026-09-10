export const SESSION_COOKIE = 'fmip_session';

/**
 * Reads the session out of the API's `Set-Cookie` header so the web app can
 * set the same cookie on its own origin (D-027). Only the value and the
 * lifetime are taken; the attributes are the web app's own decision and are
 * applied in `session.ts`.
 */
export function parseSessionSetCookie(
  header: string | null,
): { value: string; maxAge: number } | null {
  if (header === null) return null;

  const match = new RegExp(`(?:^|,\\s*)${SESSION_COOKIE}=([^;]*)`).exec(header);
  if (match === null) return null;

  const maxAge = /max-age=(\d+)/i.exec(header);

  return {
    value: decodeURIComponent(match[1] ?? ''),
    maxAge: maxAge?.[1] === undefined ? 0 : Number(maxAge[1]),
  };
}
