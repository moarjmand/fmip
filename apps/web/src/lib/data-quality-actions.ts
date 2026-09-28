'use server';

import { revalidatePath } from 'next/cache';
import { apiRequest } from '@/lib/api';
import type { ActionState } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';

/**
 * Marking a data-quality finding reviewed from the web (T-821), over the
 * audited API: the reason is recorded with the administrator's name. Whether
 * the finding is still open, and whether it was reviewed already, are the
 * API's to say. Reviewing corrects nothing in the feed.
 */
export async function reviewFindingAction(
  locale: string,
  findingId: number,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const reason = String(formData.get('reason') ?? '').trim();
  if (reason === '') return { ok: false, message: 'Say why. This is recorded.' };
  const result = await apiRequest(`/admin/data-quality/${findingId}/review`, {
    method: 'POST',
    cookie: await sessionCookieHeader(),
    body: { reason },
  });
  if (!result.ok) {
    return {
      ok: false,
      message:
        result.status === 0
          ? 'The service is unreachable right now. Please try again shortly.'
          : (result.error?.message ?? `The request failed (HTTP ${result.status}).`),
    };
  }
  revalidatePath(`/${locale}/admin/data-quality`);
  return { ok: true, message: 'Marked reviewed. It stays listed until the data agrees.' };
}
