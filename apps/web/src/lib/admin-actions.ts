'use server';

import {
  RATING_THRESHOLD_FIELDS,
  type RatingThresholdVersion,
  type SetCoverageRequest,
  type SetRatingThresholdsRequest,
  type SetUserStatusRequest,
} from '@fmip/contracts';
import { revalidatePath } from 'next/cache';
import { apiRequest } from './api';
import type { ActionState } from './auth-actions';
import { sessionCookieHeader } from './session';

/**
 * The administration area's server actions (T-070). Each is one audited
 * API call; the reason field is part of the form because every high-impact
 * action records one (rule 10). Failures come back as state, never as a
 * thrown error the page cannot show.
 */
const text = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
};

function failure(result: {
  status: number;
  error: { message: string; fields?: Record<string, string> } | null;
}): ActionState {
  return {
    ok: false,
    message:
      result.error?.message ??
      (result.status === 0 ? 'The service is unreachable right now.' : 'The request failed.'),
    ...(result.error?.fields !== undefined ? { fields: result.error.fields } : {}),
  };
}

export async function setUserStatusAction(
  locale: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = text(formData, 'user_id');
  const body: SetUserStatusRequest = {
    status: text(formData, 'status') as SetUserStatusRequest['status'],
    reason: text(formData, 'reason'),
  };
  const result = await apiRequest<{ previous: string; next: string }>(
    `/admin/users/${encodeURIComponent(userId)}/status`,
    { method: 'POST', body, cookie: await sessionCookieHeader() },
  );
  if (!result.ok) return failure(result);
  revalidatePath(`/${locale}/admin`);
  return { ok: true, message: `Account ${result.data.previous} → ${result.data.next}, recorded.` };
}

export async function setCoverageAction(
  locale: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const seasonId = text(formData, 'season_id');
  const coverageModule = text(formData, 'module');
  const provider = text(formData, 'provider');
  const note = text(formData, 'note');
  const body: SetCoverageRequest = {
    state: text(formData, 'state') as SetCoverageRequest['state'],
    provider: provider === '' ? null : provider,
    note: note === '' ? null : note,
    reason: text(formData, 'reason'),
  };
  const result = await apiRequest<{ audit_id: string }>(
    `/admin/coverage/${encodeURIComponent(seasonId)}/${encodeURIComponent(coverageModule)}`,
    { method: 'PUT', body, cookie: await sessionCookieHeader() },
  );
  if (!result.ok) return failure(result);
  revalidatePath(`/${locale}/admin`);
  return { ok: true, message: 'Coverage updated and recorded.' };
}

/**
 * Backfill the current seasons (T-030).
 *
 * It lives here rather than in a runbook's `curl` because there is nowhere to
 * curl: Caddy hands every public path to the web app, the browser never
 * reaches the API directly, and this is the route every other audited admin
 * action already takes -- a server action carrying the operator's own session.
 */
export async function backfillAction(
  locale: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await apiRequest<{
    itemsSeen: number;
    itemsWritten: number;
    partial?: string | null;
  }>('/admin/ingestion/backfill', {
    method: 'POST',
    body: { reason: text(formData, 'reason') },
    cookie: await sessionCookieHeader(),
  });
  if (!result.ok) return failure(result);
  revalidatePath(`/${locale}/admin`);
  const { itemsSeen, itemsWritten, partial } = result.data;
  return {
    ok: true,
    message:
      `Backfill done: ${itemsSeen} fixture(s) seen, ${itemsWritten} row(s) written.` +
      (partial === undefined || partial === null ? '' : ` Partial: ${partial}`),
  };
}

/**
 * A new rating-threshold version (T-1160, D-152, D-164): all six values, a
 * reason and a start (empty: now). A value that is not a number is sent as
 * typed, so the API names it rather than this action guessing.
 */
export async function setRatingThresholdsAction(
  locale: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const body: Record<string, unknown> = {
    reason: text(formData, 'reason'),
    effective_from: text(formData, 'effective_from') || null,
  };
  for (const name of RATING_THRESHOLD_FIELDS) {
    const raw = text(formData, name);
    const value = Number(raw);
    body[name] = raw === '' || !Number.isFinite(value) ? raw : value;
  }
  const result = await apiRequest<RatingThresholdVersion>('/admin/rating-thresholds', {
    method: 'POST',
    body: body as unknown as SetRatingThresholdsRequest,
    cookie: await sessionCookieHeader(),
  });
  if (!result.ok) return failure(result);
  revalidatePath(`/${locale}/admin/rating-thresholds`);
  revalidatePath(`/${locale}/admin`);
  return {
    ok: true,
    message: `Version ${result.data.version} recorded, in force from ${result.data.effective_from}.`,
  };
}
