'use server';

import { revalidatePath } from 'next/cache';
import type { DecideRequest, SuggestionOutcome } from '@fmip/contracts';
import { apiRequest } from '@/lib/api';
import type { ActionState } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';

/**
 * The moderator's writes from the web (T-610): a decision on a member, and a
 * request for the assistant's suggestion on one report.
 *
 * **Nothing here decides who may moderate or what a valid decision is.** The
 * role, the outcome list, the rule that a sanction goes with `sanctioned` and
 * only with it, and the audit row are the API's (T-212, rule 10). The form
 * sends what the moderator chose and shows the sentence that came back; a
 * check in this file would be a copy of a rule with a home, and the copy in the
 * browser is the one that goes stale.
 */

async function post<T>(
  path: string,
  body: unknown,
): Promise<
  { ok: true; data: T } | { ok: false; message: string; fields?: Record<string, string> }
> {
  const result = await apiRequest<T>(path, {
    method: 'POST',
    cookie: await sessionCookieHeader(),
    body,
  });
  if (result.ok) return { ok: true, data: result.data };
  if (result.status === 0) {
    return {
      ok: false,
      message: 'The service is unreachable right now. Please try again shortly.',
    };
  }
  const fields = (result.error as { fields?: Record<string, string> } | undefined)?.fields;
  return {
    ok: false,
    message: result.error?.message ?? `The request failed (HTTP ${result.status}).`,
    ...(fields === undefined ? {} : { fields }),
  };
}

/** The request as the moderator filled it in; the API judges whether it holds together. */
function decisionFrom(subject: string, formData: FormData): DecideRequest {
  const outcome = String(formData.get('outcome') ?? '') as DecideRequest['outcome'];
  const request: DecideRequest = {
    subject,
    report_ids: formData.getAll('report_id').map(String),
    outcome,
    reason: String(formData.get('reason') ?? '').trim(),
  };
  if (outcome === 'sanctioned') {
    const scope = String(formData.get('scope') ?? '') as NonNullable<
      DecideRequest['sanction']
    >['scope'];
    const permanent = formData.get('permanent') === 'on';
    const days = Number(String(formData.get('days') ?? '').trim());
    request.sanction = permanent
      ? { scope, permanent: true }
      : { scope, days: Number.isFinite(days) ? days : 0 };
  }
  return request;
}

export async function decideModerationAction(
  locale: string,
  subject: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const request = decisionFrom(subject, formData);
  if (request.reason === '') {
    // Said here as well as by the API: the one field most likely skipped, and
    // a round trip to be told so is a round trip wasted.
    return { ok: false, message: 'Say why. A decision with no reason cannot be reviewed.' };
  }
  const outcome = await post<{ decision_id: string; answered: number }>(
    '/admin/moderation/decisions',
    request,
  );
  if (!outcome.ok) return outcome;
  revalidatePath(`/${locale}/admin/moderation`);
  const answered = outcome.data.answered;
  return {
    ok: true,
    message: `Decision recorded; ${answered} report${answered === 1 ? '' : 's'} answered.`,
  };
}

export async function suggestModerationAction(
  locale: string,
  reportId: string,
  _previous: ActionState,
): Promise<ActionState> {
  const outcome = await post<SuggestionOutcome>(
    `/admin/moderation/reports/${encodeURIComponent(reportId)}/suggest`,
    {},
  );
  if (!outcome.ok) return outcome;
  revalidatePath(`/${locale}/admin/moderation`);
  // Each outcome in its own words: "none is configured" and "it failed" are
  // different facts, and neither is a suggestion.
  switch (outcome.data.outcome) {
    case 'published':
      return { ok: true, message: 'A suggestion was written; it is shown beside the report.' };
    case 'rejected':
      return {
        ok: false,
        message: `The suggestion was refused by the checks: ${outcome.data.rejection ?? 'no reason given'}.`,
      };
    case 'absent':
      return { ok: false, message: 'No language model is configured on this deployment.' };
    case 'failed':
      return { ok: false, message: 'The language model did not answer. Decide without it.' };
  }
}

export async function liftSanctionAction(
  locale: string,
  username: string,
  sanctionId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const reason = String(formData.get('reason') ?? '').trim();
  if (reason === '') {
    return { ok: false, message: 'Say why it is being lifted. This is recorded.' };
  }
  const outcome = await post<unknown>(
    `/admin/moderation/sanctions/${encodeURIComponent(sanctionId)}/lift`,
    { reason },
  );
  if (!outcome.ok) return outcome;
  revalidatePath(`/${locale}/admin/moderation/${encodeURIComponent(username)}`);
  revalidatePath(`/${locale}/admin/moderation`);
  return { ok: true, message: 'Lifted; the member can use it again now.' };
}
