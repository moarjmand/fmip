'use server';

import { revalidatePath } from 'next/cache';
import type {
  DismissContributorFlagRequest,
  GrantContributorRequest,
  GrantEventRequest,
} from '@fmip/contracts';
import { apiRequest } from '@/lib/api';
import type { ActionState } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';

/**
 * Granting, pausing, resuming and withdrawing a contributor from the web
 * (T-612), over the audited API of T-250.
 *
 * Eligibility, the role and the grant's history are the API's; this sends the
 * approver's reason and shows the sentence that came back.
 */

/** The rules the member accepted. The API records its own current version; this names the same one. */
const CONTRIBUTOR_RULES = 'contributor-rules@1.0.0';

async function post(path: string, body: unknown): Promise<ActionState> {
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

function reasonOf(formData: FormData): string {
  return String(formData.get('reason') ?? '').trim();
}

const NO_REASON: ActionState = {
  ok: false,
  message: 'Say why. It is recorded on the grant and the member can read it.',
};

export async function grantContributorAction(
  locale: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const reason = reasonOf(formData);
  if (reason === '') return NO_REASON;
  const request: GrantContributorRequest = {
    username: String(formData.get('username') ?? '').trim(),
    reason,
    rules_version: CONTRIBUTOR_RULES,
  };
  const outcome = await post('/admin/contributors', request);
  if (!outcome?.ok) return outcome;
  revalidatePath(`/${locale}/admin/contributors`);
  return { ok: true, message: `${request.username} may now post on match panels.` };
}

const EVENT_WORDS = {
  pause: 'Paused; they cannot post until it is resumed.',
  resume: 'Resumed; they may post again.',
  withdraw: 'Withdrawn; a new grant would be needed.',
} as const;

export async function contributorEventAction(
  locale: string,
  username: string,
  event: keyof typeof EVENT_WORDS,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const reason = reasonOf(formData);
  if (reason === '') return NO_REASON;
  const request: GrantEventRequest = { reason };
  const outcome = await post(
    `/admin/contributors/${encodeURIComponent(username)}/${event}`,
    request,
  );
  if (!outcome?.ok) return outcome;
  revalidatePath(`/${locale}/admin/contributors`);
  return { ok: true, message: EVENT_WORDS[event] };
}

/**
 * Dismissing a contributor flag (T-1031, D-137), with a reason the API
 * records beside the flag and in the audit log. It changes nothing about the
 * member's grant.
 */
export async function dismissContributorFlagAction(
  locale: string,
  flagId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const reason = reasonOf(formData);
  if (reason === '') return { ok: false, message: 'Say why. The dismissal is recorded.' };
  const request: DismissContributorFlagRequest = { reason };
  const outcome = await post(
    `/admin/contributor-flags/${encodeURIComponent(flagId)}/dismiss`,
    request,
  );
  if (!outcome?.ok) return outcome;
  revalidatePath(`/${locale}/admin/contributors`);
  return { ok: true, message: 'Dismissed. The grant is unchanged.' };
}
