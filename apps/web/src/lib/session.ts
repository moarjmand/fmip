// Server-side only: `next/headers` has no client build, so an import from a
// client component fails at build time, which is the guard we want.
import { cookies, headers } from 'next/headers';
import { clientIpFrom } from './client-ip';
import { SESSION_COOKIE, parseSessionSetCookie } from './set-cookie';

/** The reader's address for the API's rate limits on the account forms (T-810) and `/ask` (T-838), if known. */
export async function readerAddress(): Promise<string | undefined> {
  return clientIpFrom((await headers()).get('cf-connecting-ip'));
}

/** The `Cookie` header to forward to the API for the current visitor, if signed in. */
export async function sessionCookieHeader(): Promise<string | undefined> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  return value === undefined || value === ''
    ? undefined
    : `${SESSION_COOKIE}=${encodeURIComponent(value)}`;
}

/**
 * Mirrors the API's session cookie onto the web origin. Same attributes the
 * API chose (D-026): HttpOnly, SameSite=Lax, Path=/, Secure in production.
 * A `Max-Age=0` from the API (logout, or a reset that revoked every session)
 * deletes it.
 */
export async function applyApiSetCookie(header: string | null): Promise<void> {
  const parsed = parseSessionSetCookie(header);
  if (parsed === null) return;

  const store = await cookies();
  if (parsed.maxAge <= 0 || parsed.value === '') {
    store.delete(SESSION_COOKIE);
    return;
  }

  store.set({
    name: SESSION_COOKIE,
    value: parsed.value,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: parsed.maxAge,
    secure: process.env.NODE_ENV === 'production',
  });
}
