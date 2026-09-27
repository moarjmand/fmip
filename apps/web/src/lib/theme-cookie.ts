// Server-side only, like `first-run-cookie.ts`: `next/headers` has no client build.
import type { OwnProfile, UpdatePreferencesRequest } from '@fmip/contracts';
import { cookies } from 'next/headers';
import { apiRequest } from './api';
import {
  APPEARANCE,
  APPEARANCE_KEYS,
  type Appearance,
  type AppearanceKey,
  DEFAULT_APPEARANCE,
  appearanceOf,
  parseAppearance,
  reconcilePreference,
} from './appearance';
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

/** Text size, contrast and motion as this browser holds them (T-621); each default when unchosen. */
export async function readAppearance(): Promise<Appearance> {
  const jar = await cookies();
  return appearanceOf({
    text_size: jar.get(APPEARANCE.text_size.cookie)?.value,
    contrast: jar.get(APPEARANCE.contrast.cookie)?.value,
    motion: jar.get(APPEARANCE.motion.cookie)?.value,
  });
}

/**
 * Right after the API set a session (sign-in or sign-up): bring the account's
 * theme (T-602) and its text size, contrast and motion (T-621) to this
 * browser, or this browser's to an account that never chose (see
 * `reconcilePreference`), in one read and at most one write. A failure leaves
 * both as they were -- an appearance is not worth failing a sign-in over.
 */
export async function reconcileThemeAtSignIn(setCookie: string | null): Promise<void> {
  const session = parseSessionSetCookie(setCookie);
  if (session === null || session.value === '') return;
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(session.value)}`;

  const own = await apiRequest<OwnProfile>('/me/profile', { cookie });
  if (!own.ok) return;
  const toAccount: UpdatePreferencesRequest = {};

  const theme = reconcileTheme(own.data.theme, await readChosenTheme());
  if (theme.cookie !== undefined) await writeTheme(theme.cookie);
  if (theme.account !== undefined) toAccount.theme = theme.account;

  const jar = await cookies();
  for (const key of APPEARANCE_KEYS) {
    const browser = parseAppearance(key, jar.get(APPEARANCE[key].cookie)?.value);
    const plan = reconcilePreference<string>(own.data[key], browser, DEFAULT_APPEARANCE[key]);
    if (plan.cookie !== undefined) await writePreferenceCookie(APPEARANCE[key].cookie, plan.cookie);
    if (plan.account !== undefined) Object.assign(toAccount, { [key]: plan.account });
  }

  if (Object.keys(toAccount).length > 0) {
    await apiRequest('/me/preferences', { method: 'PATCH', body: toAccount, cookie });
  }
}

/** Only from a server action or route handler: a page cannot set a cookie. */
export async function writeTheme(theme: ThemePreference): Promise<void> {
  await writePreferenceCookie(THEME_COOKIE, theme);
}

/** One of text size, contrast or motion (T-621), from a server action like `writeTheme`. */
export async function writeAppearance<K extends AppearanceKey>(
  key: K,
  value: Appearance[K],
): Promise<void> {
  await writePreferenceCookie(APPEARANCE[key].cookie, value);
}

/** Every appearance cookie is set the same way: server-read, a year, renewed on each choice. */
async function writePreferenceCookie(name: string, value: string): Promise<void> {
  (await cookies()).set({
    name,
    value,
    // Read by the server, which renders `data-theme`; no script needs it.
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: THEME_COOKIE_MAX_AGE,
    secure: process.env.NODE_ENV === 'production',
  });
}
