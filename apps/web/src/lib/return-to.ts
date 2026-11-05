/**
 * The return address (T-1736, D-358): where a guest was going when a page
 * asked them to sign in or create an account, carried as `?next=` through the
 * login and register pages and back out of their actions.
 *
 * The value arrives in a query string anyone can write, so it is read by one
 * rule, here, and by nothing else: a path on this site under the page's own
 * locale. Everything that could send a reader somewhere else -- another
 * origin, a scheme, a protocol-relative `//host`, a backslash a browser reads
 * as a slash, a control character, a dot segment climbing out of the locale --
 * is refused, and a refused address is no address: the caller lands where it
 * always did.
 */

/** The query parameter that carries the return address. */
export const RETURN_PARAM = 'next';

/** Longer than any page address here; a longer value is not one of ours. */
export const RETURN_MAX_LENGTH = 512;

/**
 * Pages that are not a place to come back to: the account pages themselves (a
 * sign-in that returns to the sign-in form), and the first run, which a
 * registration passes through on its way to the address anyway.
 */
const NOT_A_DESTINATION: ReadonlySet<string> = new Set([
  'login',
  'register',
  'forgot-password',
  'reset-password',
  'verify-email',
  'account-deleted',
  'welcome',
]);

/** C0 controls, DEL and the C1 controls: never part of an address of ours. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** What may not appear in the path, as written or once percent-decoded. */
function hostile(text: string): boolean {
  return (
    CONTROL.test(text) ||
    /\s/.test(text) ||
    text.includes('\\') ||
    text.includes('//') ||
    text.split('/').some((segment) => segment === '.' || segment === '..')
  );
}

/**
 * The return address a request names, or `null` when it names none we will
 * follow. `locale` is the page's own: an address under another locale is
 * refused rather than guessed at.
 */
export function safeReturnPath(
  locale: string,
  value: string | string[] | null | undefined,
): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' || raw === '' || raw.length > RETURN_MAX_LENGTH) return null;
  // One leading slash: a path on this origin, never `//host` or `scheme:`.
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  if (CONTROL.test(raw) || /\s/.test(raw) || raw.includes('\\')) return null;

  const path = raw.split(/[?#]/)[0] ?? '';
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (hostile(path) || hostile(decoded)) return null;

  const [, first, second] = decoded.split('/');
  if (first !== locale) return null;
  if (second !== undefined && NOT_A_DESTINATION.has(second.toLowerCase())) return null;
  return raw;
}

/** `href` with the return address in its query, or unchanged when there is none. */
export function withReturn(href: string, next: string | null | undefined): string {
  if (next === null || next === undefined || next === '') return href;
  return `${href}${href.includes('?') ? '&' : '?'}${RETURN_PARAM}=${encodeURIComponent(next)}`;
}

/** The sign-in page, returning to `next` (a path with its locale) afterwards. */
export function loginHref(locale: string, next?: string | null): string {
  return withReturn(`/${locale}/login`, safeReturnPath(locale, next));
}

/** The register page, returning to `next` (a path with its locale) after the first run. */
export function registerHref(locale: string, next?: string | null): string {
  return withReturn(`/${locale}/register`, safeReturnPath(locale, next));
}
