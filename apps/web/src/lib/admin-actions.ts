'use server';

import type { SetCoverageRequest, SetUserStatusRequest } from '@fmip/contracts';
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
