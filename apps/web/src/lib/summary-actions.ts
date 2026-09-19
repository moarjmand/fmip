'use server';

import { revalidatePath } from 'next/cache';
import type { MatchSummaryOutcome } from '@fmip/contracts';
import { apiRequest } from '@/lib/api';
import type { ActionState } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';

/**
 * An editor asks for a new summary version (T-412), with the reason the audit
 * log keeps. The outcome comes back as a sentence: published, rejected with
 * the gate's reason, absent, or not finished -- so the editor knows what
 * happened without reading a log.
 */
export async function regenerateSummaryAction(
  locale: string,
  fixtureId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const reason = String(formData.get('reason') ?? '').trim();
  if (reason === '') {
    return {
      ok: false,
      message: 'Say why a new version is wanted. This is recorded against the match.',
      fields: { reason: 'Required.' },
    };
  }
  const result = await apiRequest<MatchSummaryOutcome>(
    `/admin/fixtures/${encodeURIComponent(fixtureId)}/summary`,
    { method: 'POST', cookie: await sessionCookieHeader(), body: { reason } },
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
  revalidatePath(`/${locale}/match/${fixtureId}`);
  const outcome = result.data;
  switch (outcome.outcome) {
    case 'published':
      return { ok: true, message: `Version ${outcome.version_number} published.` };
    case 'rejected':
      return {
        ok: false,
        message: `Version ${outcome.version_number} was rejected: ${outcome.rejection ?? 'no reason given'}.`,
      };
    case 'absent':
      return { ok: false, message: 'No language model is configured on this deployment.' };
    case 'not_finished':
      return { ok: false, message: 'A summary is written after the match.' };
    case 'failed':
      return { ok: false, message: 'The model could not be reached; nothing was written.' };
  }
}
