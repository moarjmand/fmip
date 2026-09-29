'use server';

import type { SetCompetitionOrderRequest, SetCompetitionOrderResponse } from '@fmip/contracts';
import { revalidatePath } from 'next/cache';
import { apiRequest } from './api';
import type { ActionState } from './auth-actions';
import { sessionCookieHeader } from './session';

/**
 * The competitions' order from the console (T-1162, D-154): one audited
 * `PUT /admin/competitions/:id/order` with a reason. An empty place clears
 * it. Whether the place is valid is the API's to say, field by field.
 */
export async function setCompetitionOrderAction(
  locale: string,
  competitionId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const place = String(formData.get('order') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  if (reason === '') {
    return {
      ok: false,
      message: 'Say why. This is recorded.',
      fields: { reason: 'Say why. This is recorded.' },
    };
  }
  const body: SetCompetitionOrderRequest = {
    order: place === '' ? null : Number(place),
    reason,
  };
  const result = await apiRequest<SetCompetitionOrderResponse>(
    `/admin/competitions/${encodeURIComponent(competitionId)}/order`,
    { method: 'PUT', body, cookie: await sessionCookieHeader() },
  );
  if (!result.ok) {
    return {
      ok: false,
      message:
        result.error?.fields?.order ??
        result.error?.message ??
        (result.status === 0 ? 'The service is unreachable right now.' : 'The request failed.'),
      ...(result.error?.fields !== undefined ? { fields: result.error.fields } : {}),
    };
  }
  revalidatePath(`/${locale}/admin/competitions`);
  revalidatePath(`/${locale}/scores`);
  revalidatePath(`/${locale}`);
  const { next } = result.data;
  return {
    ok: true,
    message:
      next === null
        ? 'Place cleared and recorded; it now sorts by country and name.'
        : `Place ${next} recorded; the scores page and the homepage show it on their next render.`,
  };
}
