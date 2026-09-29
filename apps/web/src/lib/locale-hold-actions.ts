'use server';

import { revalidatePath } from 'next/cache';
import { apiRequest } from '@/lib/api';
import type { ActionState } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';

/**
 * Holding back a ready language and releasing it (T-1163, D-155), over the
 * audited API, administrators only. Which languages may be held, and whether
 * one already is, are the API's to say.
 */
async function post(locale: string, verb: 'hold' | 'release', reason: string) {
  return apiRequest(`/admin/locales/${encodeURIComponent(locale)}/${verb}`, {
    method: 'POST',
    cookie: await sessionCookieHeader(),
    body: { reason },
  });
}

export async function localeHoldAction(
  pageLocale: string,
  target: string,
  verb: 'hold' | 'release',
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const reason = String(formData.get('reason') ?? '').trim();
  if (reason === '') return { ok: false, message: 'Say why. This is recorded.' };
  const result = await post(target, verb, reason);
  if (!result.ok) {
    return {
      ok: false,
      message:
        result.status === 0
          ? 'The service is unreachable right now. Please try again shortly.'
          : (result.error?.message ?? `The request failed (HTTP ${result.status}).`),
    };
  }
  // Every page's header offers languages; the whole layout is stale.
  revalidatePath(`/${pageLocale}`, 'layout');
  return {
    ok: true,
    message:
      verb === 'hold'
        ? 'Held back: the picker and the first run no longer offer it.'
        : 'Released: it is offered again wherever its catalogue is ready.',
  };
}
