'use server';

import { revalidatePath } from 'next/cache';
import { POLL_DEFAULT_HOURS } from '@fmip/contracts';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { type MessageKey, t } from '@/i18n/messages';
import { type ApiResult, apiRequest } from '@/lib/api';
import type { ActionState } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';

/**
 * Group polls (T-643, D-091): asking, voting, closing and removing. Server
 * actions, so every form works without JavaScript and the session cookie
 * never leaves the server. Nothing here decides anything: the API answers
 * over the schema's rules and its sentence is passed through, refusals
 * included.
 */

const UNREACHABLE = 'The service is unreachable right now. Please try again shortly.';

function failure(result: Extract<ApiResult<unknown>, { ok: false }>): ActionState {
  if (result.status === 0) return { ok: false, message: UNREACHABLE };
  const fields = result.error?.fields;
  const detail = fields === undefined ? '' : ` ${Object.values(fields).join(' ')}`;
  return {
    ok: false,
    message: `${result.error?.message ?? `The request failed (HTTP ${result.status}).`}${detail}`,
  };
}

function done(locale: string, key: MessageKey): string {
  return t(isLocale(locale) ? locale : DEFAULT_LOCALE, key);
}

async function call(
  locale: string,
  slug: string,
  path: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body: unknown,
  message: MessageKey,
): Promise<ActionState> {
  const result = await apiRequest<unknown>(`/groups/${encodeURIComponent(slug)}/polls${path}`, {
    method,
    cookie: await sessionCookieHeader(),
    ...(body === undefined ? {} : { body }),
  });
  if (!result.ok) return failure(result);
  revalidatePath(`/${locale}/groups/${encodeURIComponent(slug)}`);
  return { ok: true, message: done(locale, message) };
}

/** The form's six option rows; blank ones are dropped by the API, not here. */
export async function createPollAction(
  locale: string,
  slug: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const days = Number(formData.get('days'));
  return call(
    locale,
    slug,
    '',
    'POST',
    {
      question: String(formData.get('question') ?? ''),
      options: formData.getAll('option').map((o) => String(o)),
      closes_in_hours: Number.isInteger(days) && days > 0 ? days * 24 : POLL_DEFAULT_HOURS,
    },
    'groupPolls.done.created',
  );
}

export async function votePollAction(
  locale: string,
  slug: string,
  pollId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return call(
    locale,
    slug,
    `/${encodeURIComponent(pollId)}/vote`,
    'PUT',
    { option_id: String(formData.get('option_id') ?? '') },
    'groupPolls.done.voted',
  );
}

export async function withdrawPollVoteAction(
  locale: string,
  slug: string,
  pollId: string,
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return call(
    locale,
    slug,
    `/${encodeURIComponent(pollId)}/vote`,
    'DELETE',
    undefined,
    'groupPolls.done.withdrawn',
  );
}

export async function closePollAction(
  locale: string,
  slug: string,
  pollId: string,
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return call(
    locale,
    slug,
    `/${encodeURIComponent(pollId)}/close`,
    'POST',
    undefined,
    'groupPolls.done.closed',
  );
}

export async function removePollAction(
  locale: string,
  slug: string,
  pollId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return call(
    locale,
    slug,
    `/${encodeURIComponent(pollId)}/removal`,
    'POST',
    { reason: String(formData.get('reason') ?? '') },
    'groupPolls.done.removed',
  );
}
