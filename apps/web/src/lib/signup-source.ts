import { SIGNUP_ENTRIES, type SignupEntry, type SignupSource, signupHost } from '@fmip/contracts';
import { isLocale } from '@/i18n/locales';

/**
 * Where a sign-up started (T-1821, D-415, the maintainer's option (c) after
 * the business adviser's note of 2026-11-13): no cookie, no client script,
 * nothing stored on the visitor's device and nothing kept beside the account.
 * The register page works it out from its own request and hands it to the
 * form as two hidden fields; the API adds it to a monthly count.
 *
 * - **The kind of page where "Create account" was clicked.** Carried by the
 *   link: `?from=<entry>` where the link sets it, else the page the reader
 *   was on its way back to (`next`, D-358), else the path of the page that
 *   linked to the register page on this site (the header's button lives in
 *   the layout, which cannot know its page without a script). `none` when
 *   none of these says: the register page was the first page we know of.
 * - **The host of another site**, only when the register page was reached
 *   straight from it (a `Referer` from elsewhere). Nothing for this site or
 *   its subdomains, and never the path or query.
 */

export const SIGNUP_FROM_PARAM = 'from';
/** The register form's hidden fields. */
export const SIGNUP_ENTRY_FIELD = 'signup_entry';
export const SIGNUP_REFERRER_FIELD = 'signup_referrer';

/** A `from` value that is one of the kinds, or null. */
export function entryParam(value: string | string[] | undefined): SignupEntry | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return (SIGNUP_ENTRIES as readonly string[]).includes(raw ?? '') ? (raw as SignupEntry) : null;
}

/** The kind of page a path of ours is, with or without its locale; null for no path. */
export function entryOfPath(path: string | null | undefined): SignupEntry | null {
  if (typeof path !== 'string' || !path.startsWith('/')) return null;
  const segments = (path.split(/[?#]/)[0] ?? '').split('/').filter((s) => s !== '');
  const rest = segments[0] !== undefined && isLocale(segments[0]) ? segments.slice(1) : segments;
  switch (rest[0]) {
    case undefined:
      return 'home';
    case 'match':
      return 'match';
    case 'team':
      return 'team';
    case 'competition':
    case 'competitions':
      return 'competition';
    case 'news':
      return 'news';
    default:
      return 'other';
  }
}

/** The host a request was made to, lower-case, without a port or `www.`. */
function bareHost(value: string | null | undefined): string | null {
  return signupHost(value ?? '');
}

/** `host` is `site` or one of its subdomains. */
function sameSite(host: string, site: string): boolean {
  return host === site || host.endsWith(`.${site}`);
}

export function signupSourceOf(request: {
  /** The register page's `from` query value. */
  from: string | string[] | undefined;
  /** The register page's return path, already checked (`safeReturnPath`). */
  next: string | null;
  /** The register page request's `Referer` header. */
  referer: string | null;
  /** This site's hosts: the request's `Host` and the configured site URL's. */
  siteHosts: readonly (string | null | undefined)[];
}): SignupSource {
  const sites = request.siteHosts.map(bareHost).filter((h): h is string => h !== null);
  let refererPath: string | null = null;
  let referrerHost: string | null = null;
  if (request.referer !== null && request.referer !== '') {
    try {
      const url = new URL(request.referer);
      const host = bareHost(url.hostname);
      if (host !== null && (url.protocol === 'https:' || url.protocol === 'http:')) {
        if (sites.some((site) => sameSite(host, site))) refererPath = url.pathname;
        else referrerHost = host;
      }
    } catch {
      // Not a URL: nothing is said about where the reader came from.
    }
  }
  const entry =
    entryParam(request.from) ?? entryOfPath(request.next) ?? entryOfPath(refererPath) ?? 'none';
  return { entry, referrer_host: referrerHost };
}
