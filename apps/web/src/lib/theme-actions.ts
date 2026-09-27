'use server';

import { apiRequest } from './api';
import { sessionCookieHeader } from './session';
import { APPEARANCE_KEYS, type Appearance, parseAppearance } from './appearance';
import { parseTheme } from './theme';
import { writeAppearance, writeTheme } from './theme-cookie';

/**
 * The theme switch (T-602): a plain form post, so it works before any script
 * has loaded. The choice goes to this browser's cookie, which the layout
 * renders from -- setting a cookie in an action re-renders the page, so the
 * new theme is on the next paint -- and, for a member, to the account as
 * well, so another browser brings it at sign-in. A value that is not one of
 * the three changes nothing.
 */
export async function setThemeAction(formData: FormData): Promise<void> {
  const theme = parseTheme(formData.get('theme'));
  if (theme === undefined) return;
  await writeTheme(theme);

  // A guest has no session to send; a session that has ended is refused by
  // the API (401) and the browser's copy still stands.
  const cookie = await sessionCookieHeader();
  if (cookie !== undefined) {
    await apiRequest('/me/preferences', { method: 'PATCH', body: { theme }, cookie });
  }
}

/**
 * Text size, contrast or motion (T-621), the same way: the pressed button's
 * name says which preference and its value the choice. Whichever of the three
 * the form carries goes to this browser's cookie and, for a member, to the
 * account; a name or value that is not one of theirs changes nothing.
 */
export async function setAppearanceAction(formData: FormData): Promise<void> {
  const body: Partial<Appearance> = {};
  for (const key of APPEARANCE_KEYS) {
    const value = parseAppearance(key, formData.get(key));
    if (value === undefined) continue;
    await writeAppearance(key, value);
    Object.assign(body, { [key]: value });
  }
  if (Object.keys(body).length === 0) return;

  const cookie = await sessionCookieHeader();
  if (cookie !== undefined) {
    await apiRequest('/me/preferences', { method: 'PATCH', body, cookie });
  }
}
