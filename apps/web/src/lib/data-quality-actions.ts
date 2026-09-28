'use server';

import { revalidatePath } from 'next/cache';
import type {
  DataQualityCheck,
  RefetchDataQualityResponse,
  ReviewDataQualityBatchResponse,
} from '@fmip/contracts';
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

/**
 * Marking every open, unreviewed finding of one check in one season reviewed
 * with one reason (T-912). The API writes one audit row for the batch, naming
 * the findings; a finding that comes back later is open again.
 */
export async function reviewBatchAction(
  locale: string,
  check: DataQualityCheck,
  seasonId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const reason = String(formData.get('reason') ?? '').trim();
  if (reason === '') return { ok: false, message: 'Say why. This is recorded.' };
  const result = await apiRequest<ReviewDataQualityBatchResponse>(
    '/admin/data-quality/review-batch',
    {
      method: 'POST',
      cookie: await sessionCookieHeader(),
      body: { check, season_id: seasonId, reason },
    },
  );
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
  const n = result.data.reviewed;
  return {
    ok: true,
    message: `Marked ${n} finding${n === 1 ? '' : 's'} reviewed. They stay listed until the data agrees.`,
  };
}

/**
 * Asking the feed again (T-913): for one fixture, or for every fixture behind
 * one check's open findings in one season. The API queues it and audits the
 * reason; the post-match job asks within its share of the day's budget, and
 * the finding resolves on the next sweep only if the answer agrees.
 */
export async function refetchAction(
  locale: string,
  target: { fixture_id: string } | { check: DataQualityCheck; season_id: string },
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const reason = String(formData.get('reason') ?? '').trim();
  if (reason === '') return { ok: false, message: 'Say why. This is recorded.' };
  const result = await apiRequest<RefetchDataQualityResponse>('/admin/data-quality/refetch', {
    method: 'POST',
    cookie: await sessionCookieHeader(),
    body: { ...target, reason },
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
  const n = result.data.queued;
  const waiting = result.data.already_queued;
  return {
    ok: true,
    message:
      `Queued ${n} match${n === 1 ? '' : 'es'} to ask the feed again` +
      (waiting > 0 ? ` (${waiting} already waiting)` : '') +
      ". The post-match job asks within its share of the day's budget.",
  };
}
