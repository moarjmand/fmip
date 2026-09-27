import { THEME_PREFERENCES, type ThemePreference } from '@fmip/contracts';
import { reconcilePreference } from './appearance';

/**
 * The colour theme (T-602, D-089): light, dark, or `system`, which follows
 * the device. The browser's cookie is what a page is rendered with, for a
 * guest and a member alike -- the layout reads it and writes `data-theme` on
 * <html>, so the first paint is already the chosen theme and nothing flashes.
 * A member's choice is also kept on the account (`PATCH /me/preferences`),
 * and signing in on another browser brings it there.
 */
export const THEME_COOKIE = 'fmip_theme';

/** A year: a theme is a standing choice, renewed each time it is made. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const DEFAULT_THEME: ThemePreference = 'system';

export { THEME_PREFERENCES };
export type { ThemePreference };

/** A value from a cookie or a form: one of the three, or `undefined`. */
export function parseTheme(raw: unknown): ThemePreference | undefined {
  return THEME_PREFERENCES.find((theme) => theme === raw);
}

/** What the layout renders on <html>: the choice, or the device when there is none. */
export function themeAttribute(raw: unknown): ThemePreference {
  return parseTheme(raw) ?? DEFAULT_THEME;
}

/**
 * At sign-in or sign-up, the browser and the account come to one theme. A
 * choice the account holds is the member's standing choice and reaches this
 * browser; an account that never chose (`system`) takes the one this browser
 * made as a guest, the way the first run's answers reach it (T-620). Nothing
 * is written when the two already agree or neither chose.
 */
export function reconcileTheme(
  account: ThemePreference,
  browser: ThemePreference | undefined,
): { cookie?: ThemePreference; account?: ThemePreference } {
  return reconcilePreference(account, browser, DEFAULT_THEME);
}
