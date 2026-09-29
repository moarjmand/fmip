'use server';

import { revalidatePath } from 'next/cache';
import { isStoryType } from '@fmip/contracts';
import { apiRequest } from '@/lib/api';
import type { ActionState } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';

/**
 * An editor's story type from the news desk (T-1009) over `POST
 * /admin/stories/:id/type` (T-1001, D-123, rule 10). The type and the reason
 * are required here as well as at the API, so an editor is told before the
 * round trip; which roles may label, and whether the story exists, are the
 * API's.
 */
export async function labelStoryTypeAction(
  locale: string,
  storyId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const type = String(formData.get('type') ?? '');
  if (!isStoryType(type)) {
    return { ok: false, message: 'Choose a type.', fields: { type: 'Required.' } };
  }
  const reason = String(formData.get('reason') ?? '').trim();
  if (reason === '') {
    return {
      ok: false,
      message: 'Say why. This is recorded against the story.',
      fields: { reason: 'Required.' },
    };
  }
  const result = await apiRequest(`/admin/stories/${encodeURIComponent(storyId)}/type`, {
    method: 'POST',
    cookie: await sessionCookieHeader(),
    body: { type, reason },
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
  revalidatePath(`/${locale}/admin/news`);
  revalidatePath(`/${locale}/news`);
  revalidatePath(`/${locale}/news/story/${storyId}`);
  return { ok: true, message: 'Type recorded.' };
}
