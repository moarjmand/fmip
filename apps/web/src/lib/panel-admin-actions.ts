'use server';

import { revalidatePath } from 'next/cache';
import { apiRequest } from '@/lib/api';
import type { ActionState } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';

/**
 * Opening and closing a featured match's public discussion from the web
 * (T-613), over the audited API of T-253. Which roles may do it, whether the
 * match exists and whether a discussion is already open are the API's.
 */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function post(path: string, reason: string): Promise<ActionState> {
  const result = await apiRequest(path, {
    method: 'POST',
    cookie: await sessionCookieHeader(),
    body: { reason },
  });
  if (result.ok) return { ok: true };
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

export async function openPanelAction(
  locale: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // A match's id or its page's address: the operator copies whichever is to hand.
  const fixtureId = UUID.exec(String(formData.get('match') ?? ''))?.[0]?.toLowerCase();
  if (fixtureId === undefined) {
    return { ok: false, message: "Paste the match page's address or the match id." };
  }
  const reason = String(formData.get('reason') ?? '').trim();
  if (reason === '')
    return { ok: false, message: 'Say why this match is featured. This is recorded.' };
  const outcome = await post(`/admin/fixtures/${fixtureId}/panel`, reason);
  if (!outcome?.ok) return outcome;
  revalidatePath(`/${locale}/admin/panels`);
  revalidatePath(`/${locale}/match/${fixtureId}`);
  return { ok: true, message: 'The discussion is open on the match page.' };
}

export async function closePanelAction(
  locale: string,
  fixtureId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const reason = String(formData.get('reason') ?? '').trim();
  if (reason === '') return { ok: false, message: 'Say why it is being closed. This is recorded.' };
  const outcome = await post(
    `/admin/fixtures/${encodeURIComponent(fixtureId)}/panel/close`,
    reason,
  );
  if (!outcome?.ok) return outcome;
  revalidatePath(`/${locale}/admin/panels`);
  revalidatePath(`/${locale}/match/${fixtureId}`);
  return { ok: true, message: 'Closed; what was posted stays readable.' };
}
