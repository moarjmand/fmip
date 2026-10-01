import { NextResponse, type NextRequest } from 'next/server';
import { DEFAULT_LOCALE, WRITTEN_LOCALES, localeFromPathname } from '@/i18n/locales';
import { fetchHeldLocales } from '@/lib/api';
import { FIRST_RUN_COOKIE, parseGuestChoices } from '@/lib/first-run';
import { negotiatedLanguage } from '@/lib/language-negotiation';
import { READER_LOCALE_HEADER } from '@/lib/locale-query';

/**
 * Next 16 renamed this convention from `middleware` to `proxy`.
 *
 * Every page lives under a locale segment. A request without one is redirected
 * to the default locale rather than served, so a page never renders at a URL
 * that does not say what language it is in. A guest who chose a language in
 * the first run (T-620) is sent to that one instead; a member's language
 * reaches them through the flow's own redirect.
 *
 * A guest's language that an administrator has since held back (T-1163,
 * D-155) is not moved to: they are sent to the default, and the header tells
 * them why, once. When the holds cannot be read, the default too -- a hold
 * is not undone by the API being slow. Only a request with no locale in its
 * path, from a guest who chose another language, asks.
 *
 * A guest who has chosen nothing is sent to the first written language their
 * browser asks for (`Accept-Language`, T-1310): a reader whose browser says
 * `fa-IR` lands on Persian. A written language that is held is not offered
 * and its pages carry `X-Robots-Tag: noindex`, so a hold takes it out of
 * search engines too.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  const locale = localeFromPathname(pathname);
  if (locale !== undefined) {
    // The page's language, for the API client to ask for names in (T-1312).
    // Set here, over anything the browser sent under the same name.
    const forwarded = new Headers(request.headers);
    forwarded.set(READER_LOCALE_HEADER, locale);
    const response = NextResponse.next({ request: { headers: forwarded } });
    if (WRITTEN_LOCALES.includes(locale) && (await isHeld(locale))) {
      response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    }
    return response;
  }

  const url = request.nextUrl.clone();
  const chosen =
    parseGuestChoices(request.cookies.get(FIRST_RUN_COOKIE)?.value).language ??
    negotiatedLanguage(request.headers.get('accept-language'), WRITTEN_LOCALES) ??
    undefined;
  const language =
    chosen === undefined || chosen === DEFAULT_LOCALE || (await isHeld(chosen))
      ? DEFAULT_LOCALE
      : chosen;
  url.pathname = `/${language}${pathname === '/' ? '' : pathname}`;

  return NextResponse.redirect(url);
}

async function isHeld(locale: string): Promise<boolean> {
  const holds = await fetchHeldLocales();
  return !holds.ok || holds.data.held.some((hold) => hold.locale === locale);
}

export const config = {
  // Everything except Next's own assets, the web app's own API routes (the SSE
  // proxy of T-032 has no locale), the exact path `/health` (the public
  // origin's health for the outside uptime check, T-806) and files that
  // already have an extension — redirecting those would break them.
  matcher: ['/((?!_next/|api/|health$|favicon\\.ico|.*\\.[^/]+$).*)'],
};
