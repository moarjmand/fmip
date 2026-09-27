// Server-side only, like `first-run-cookie.ts`: `next/headers` has no client build.
import type { OwnProfile } from '@fmip/contracts';
import { cookies } from 'next/headers';
import { apiRequest } from './api';
import { SESSION_COOKIE, parseSessionSetCookie } from './set-cookie';
import {
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  type ThemePreference,
  parseTheme,
  reconcileTheme,
  themeAttribute,
} from './theme';

/** The theme this browser renders with (T-602); `system` when none was chosen. */
export async function readTheme(): Promise<ThemePreference> {
  return themeAttribute((await cookies()).get(THEME_COOKIE)?.value);
}

/** Whether this browser holds a choice at all, as distinct from the default. */
export async function readChosenTheme(): Promise<ThemePreference | undefined> {
  return parseTheme((await cookies()).get(THEME_COOKIE)?.value);
}

/**
 * Right after the API set a session (sign-in or sign-up): bring the account's
 * theme to this browser, or this browser's to an account that never chose
 * (see `reconcileTheme`). A failure leaves both as they were -- a theme is
 * not worth failing a sign-in over.
 */
export async function reconcileThemeAtSignIn(setCookie: string | null): Promise<void> {
  const session = parseSessionSetCookie(setCookie);
  if (session === null || session.value === '') return;
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(session.value)}`;

  const own = await apiRequest<OwnProfile>('/me/profile', { cookie });
  if (!own.ok) return;
  const plan = reconcileTheme(own.data.theme, await readChosenTheme());
  if (plan.cookie !== undefined) await writeTheme(plan.cookie);
  if (plan.account !== undefined) {
    await apiRequest('/me/preferences', {
      method: 'PATCH',
      body: { theme: plan.account },
      cookie,
    });
  }
}

/** Only from a server action or route handler: a page cannot set a cookie. */
export async function writeTheme(theme: ThemePreference): Promise<void> {
  (await cookies()).set({
    name: THEME_COOKIE,
    value: theme,
    // Read by the server, which renders `data-theme`; no script needs it.
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: THEME_COOKIE_MAX_AGE,
    secure: process.env.NODE_ENV === 'production',
  });
}
