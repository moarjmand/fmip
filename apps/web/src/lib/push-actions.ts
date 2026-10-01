'use server';

import { revalidatePath } from 'next/cache';
import { apiRequest } from '@/lib/api';
import type { ActionState } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';
import { failureSentence } from '@/lib/action-failure';

/**
 * A device's push registration, handed from the browser to the API (T-330,
 * D-074). The browser made it; the member's session is what ties it to them.
 */
export async function subscribePushAction(
  locale: string,
  subscription: unknown,
): Promise<ActionState> {
  const result = await apiRequest('/me/push-subscriptions', {
    method: 'POST',
    cookie: await sessionCookieHeader(),
    body: subscription,
  });
  if (!result.ok) {
    return {
      ok: false,
      message: await failureSentence(result, locale),
    };
  }
  revalidatePath(`/${locale}/settings/notifications`);
  return { ok: true };
}

export async function unsubscribePushAction(
  locale: string,
  endpoint: string,
): Promise<ActionState> {
  const result = await apiRequest('/me/push-subscriptions', {
    method: 'DELETE',
    cookie: await sessionCookieHeader(),
    body: { endpoint },
  });
  if (!result.ok && result.status !== 404) {
    return {
      ok: false,
      message: await failureSentence(result, locale),
    };
  }
  revalidatePath(`/${locale}/settings/notifications`);
  return { ok: true };
}
