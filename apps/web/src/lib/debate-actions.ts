'use server';

import { revalidatePath } from 'next/cache';
import { apiRequest } from '@/lib/api';
import type { ActionState } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';

/**
 * The editor's two decisions about the debate section (T-143, rule 10), from
 * the news page itself: selecting a story with the note readers will see, and
 * clearing one with a reason. Both words are required here as well as at the
 * API, so an editor is told before the round trip rather than after it.
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
        message: 'The service is unreachable right now. Please try again shortly.',
      };
    }
    return {
      ok: false,
      message: result.error?.message ?? `The request failed (HTTP ${result.status}).`,
    };
  }
  // The page is a server component reading the section; tell it the section changed.
  revalidatePath(`/${locale}/news`);
  return { ok: true, message: done };
}

export async function selectDebateAction(
  locale: string,
  storyId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const note = String(formData.get('note') ?? '').trim();
  if (note === '') {
    return {
      ok: false,
      message: 'Say why this is a debate. Readers see it beside the story.',
      fields: { note: 'Required.' },
    };
  }
  return decide(
    locale,
    `/admin/stories/${encodeURIComponent(storyId)}/debate`,
    { note },
    'On the debate page.',
  );
}

export async function clearDebateAction(
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
    `/admin/stories/${encodeURIComponent(storyId)}/debate/clear`,
    { reason },
    'Taken off the debate page.',
  );
}
