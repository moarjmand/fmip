'use server';

import { revalidatePath } from 'next/cache';
import { apiRequest, fetchPushState } from '@/lib/api';
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

/**
 * The deployment's public key, or null when it has no push channel or the
 * API cannot say (T-1429). Asked by the offer a follow brings up, only after
 * the browser has said it could take push -- so an ordinary page load costs
 * no request, and a deployment without push never offers it.
 */
export async function pushOfferKeyAction(): Promise<string | null> {
  const result = await fetchPushState(await sessionCookieHeader());
  if (!result.ok || result.data.state !== 'configured') return null;
  return result.data.public_key;
}
