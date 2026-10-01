'use server';

import { revalidatePath } from 'next/cache';
import { apiRequest } from '@/lib/api';
import type { ActionState } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';
import { failureSentence } from '@/lib/action-failure';

/**
 * The editor's breaking mark from the news page (T-1004, D-125, rule 10):
 * marking a story with the note readers see on the homepage strip, and
 * ending a mark early with a reason. Both words are required here as well as
 * at the API, so an editor is told before the round trip.
 */
async function decide(
  locale: string,
  path: string,
  body: Record<string, string>,
  done: string,
): Promise<ActionState> {
  const result = await apiRequest(path, {
    method: 'POST',
    cookie: await sessionCookieHeader(),
    body,
  });
  if (!result.ok) {
    if (result.status === 0) {
      return {
        ok: false,
        message: await failureSentence(result, locale),
      };
    }
    return {
      ok: false,
      message: await failureSentence(result, locale),
    };
  }
  // The news page, the homepage strip and the news desk (T-1009) all read the mark.
  revalidatePath(`/${locale}/news`);
  revalidatePath(`/${locale}`);
  revalidatePath(`/${locale}/admin/news`);
  return { ok: true, message: done };
}

export async function markBreakingAction(
  locale: string,
  storyId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const note = String(formData.get('note') ?? '').trim();
  if (note === '') {
    return {
      ok: false,
      message: 'Say why this is breaking. Readers see it on the homepage.',
      fields: { note: 'Required.' },
    };
  }
  return decide(
    locale,
    `/admin/stories/${encodeURIComponent(storyId)}/breaking`,
    { note },
    'Marked breaking.',
  );
}

export async function clearBreakingAction(
  locale: string,
  storyId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const reason = String(formData.get('reason') ?? '').trim();
  if (reason === '') {
    return {
      ok: false,
      message: 'Say why. This is recorded against the story.',
      fields: { reason: 'Required.' },
    };
  }
  return decide(
    locale,
    `/admin/stories/${encodeURIComponent(storyId)}/breaking/clear`,
    { reason },
    'No longer marked breaking.',
  );
}
