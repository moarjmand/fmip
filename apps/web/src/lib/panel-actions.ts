'use server';

import { revalidatePath } from 'next/cache';
import { apiRequest } from '@/lib/api';
import type { ActionState } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';

/**
 * Posting on a public match panel (T-251).
 *
 * **The action does not check whether the member may post.** The API asks the
 * database, the database decides, and this passes the answer on. A check here
 * would be a third copy of a rule that already has two homes, and the copy in
 * the browser is the one that goes stale first -- a contributor paused a second
 * ago would still see the button work.
 *
 * So the refusal arrives as a 403 with a sentence in it, and the sentence is
 * shown. That is the whole error path, and it is why the API was built to put
 * words in every refusal rather than a status code.
 */
export async function postToPanelAction(
  locale: string,
  fixtureId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const body = String(formData.get('body') ?? '').trim();
  if (body === '') {
    return { ok: false, message: 'Write something first.' };
  }

  const result = await apiRequest(`/fixtures/${encodeURIComponent(fixtureId)}/panel`, {
    method: 'POST',
    cookie: await sessionCookieHeader(),
    body: { body },
  });

  if (!result.ok) {
    if (result.status === 0) {
      return {
        ok: false,
        message: 'The service is unreachable right now. Please try again shortly.',
      };
    }
    return {
      ok: false,
      message: result.error?.message ?? `The request failed (HTTP ${result.status}).`,
    };
  }

  // The panel is a server component reading a public document, so the page has
  // to be told the document changed. Without this the contributor posts and
  // sees nothing happen.
  revalidatePath(`/${locale}/match/${fixtureId}`);
  return { ok: true, message: 'Posted.' };
}
