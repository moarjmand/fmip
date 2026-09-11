import { NextResponse, type NextRequest } from 'next/server';
import { DEFAULT_LOCALE, localeFromPathname } from '@/i18n/locales';

/**
 * Next 16 renamed this convention from `middleware` to `proxy`.
 *
 * Every page lives under a locale segment. A request without one is redirected
 * to the default locale rather than served, so a page never renders at a URL
 * that does not say what language it is in.
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (localeFromPathname(pathname) !== undefined) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = `/${DEFAULT_LOCALE}${pathname === '/' ? '' : pathname}`;

  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next's own assets, the web app's own API routes (the SSE
  // proxy of T-032 has no locale) and files that already have an
  // extension — redirecting those would break them.
  matcher: ['/((?!_next/|api/|favicon\\.ico|.*\\.[^/]+$).*)'],
};
