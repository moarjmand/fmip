'use server';

import { apiRequest } from './api';
import { sessionCookieHeader } from './session';
import { parseTheme } from './theme';
import { writeTheme } from './theme-cookie';

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
