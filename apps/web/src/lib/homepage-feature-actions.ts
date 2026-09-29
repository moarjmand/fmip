'use server';

import { revalidatePath } from 'next/cache';
import { apiRequest } from '@/lib/api';
import type { ActionState } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';

/**
 * Featuring a match on the homepage and clearing it early from the web
 * (T-1161, D-153), over the audited API. Which roles may do it, whether the
 * match exists and can still be featured, and whether it already is, are the
 * API's to say.
 */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function post(path: string, body: Record<string, unknown>): Promise<ActionState> {
  const result = await apiRequest(path, {
    method: 'POST',
    cookie: await sessionCookieHeader(),
    body,
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

export async function featureMatchAction(
  locale: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // A match's id or its page's address: the editor copies whichever is to hand.
  const fixtureId = UUID.exec(String(formData.get('match') ?? ''))?.[0]?.toLowerCase();
  if (fixtureId === undefined) {
    return { ok: false, message: "Paste the match page's address or the match id." };
  }
  const note = String(formData.get('note') ?? '').trim();
  if (note === '') {
    return { ok: false, message: 'Say why this match is featured. Readers see it.' };
  }
  const hours = Number(formData.get('hours'));
  const outcome = await post(`/admin/fixtures/${fixtureId}/feature`, { note, hours });
  if (!outcome?.ok) return outcome;
  revalidatePath(`/${locale}/admin/homepage`);
  revalidatePath(`/${locale}`);
  return { ok: true, message: 'Featured on the homepage.' };
}

export async function clearFeatureAction(
  locale: string,
  fixtureId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const reason = String(formData.get('reason') ?? '').trim();
  if (reason === '')
    return { ok: false, message: 'Say why it is being cleared. This is recorded.' };
  const outcome = await post(`/admin/fixtures/${encodeURIComponent(fixtureId)}/feature/clear`, {
    reason,
  });
  if (!outcome?.ok) return outcome;
  revalidatePath(`/${locale}/admin/homepage`);
  revalidatePath(`/${locale}`);
  return { ok: true, message: 'Cleared; the homepage no longer lists it first.' };
}
