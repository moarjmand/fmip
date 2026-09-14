'use server';

import { revalidatePath } from 'next/cache';
import { type ApiResult, apiRequest } from '@/lib/api';
import type { ActionState } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';

/**
 * Groups: joining, asking, invitations and who runs one (blueprint 8.2, T-242).
 *
 * Server actions, so every control works without JavaScript and the session
 * cookie never leaves the server. Nothing here decides anything: whether a
 * group may be joined, asked, or left is the API's answer over the schema's
 * rules (T-240, D-057), and these pass its sentence through — including the
 * refusals, whose wording is written not to say more than it should.
 */

const UNREACHABLE = 'The service is unreachable right now. Please try again shortly.';

function failure(result: Extract<ApiResult<unknown>, { ok: false }>): ActionState {
  if (result.status === 0) return { ok: false, message: UNREACHABLE };
  return {
    ok: false,
    message: result.error?.message ?? `The request failed (HTTP ${result.status}).`,
  };
}

/**
 * Anything done to a group can change the directory, the group's own page and
 * the list of conversations — a group carries one — so all three are
 * revalidated rather than guessed between.
 */
async function act(
  locale: string,
  slug: string,
  path: string,
  method: 'POST' | 'DELETE',
  done: string,
): Promise<ActionState> {
  const result = await apiRequest<null>(path, { method, cookie: await sessionCookieHeader() });
  if (!result.ok) return failure(result);

  revalidatePath(`/${locale}/groups`);
  revalidatePath(`/${locale}/groups/${encodeURIComponent(slug)}`);
  revalidatePath(`/${locale}/messages`);
  return { ok: true, message: done };
}

function target(value: string): string {
  return encodeURIComponent(value);
}

export async function joinGroupAction(
  locale: string,
  slug: string,
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return act(locale, slug, `/groups/${target(slug)}/members`, 'POST', 'You are in.');
}

/**
 * Asking to join, with whatever the member wants to say.
 *
 * The note is read from the form rather than bound, because it is the one
 * control here a member actually types into.
 */
export async function askToJoinGroupAction(
  locale: string,
  slug: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const note = String(formData.get('note') ?? '').trim();
  const result = await apiRequest<null>(`/groups/${target(slug)}/requests`, {
    method: 'POST',
    cookie: await sessionCookieHeader(),
    body: { note: note === '' ? null : note },
  });
  if (!result.ok) return failure(result);

  revalidatePath(`/${locale}/groups`);
  revalidatePath(`/${locale}/groups/${target(slug)}`);
  return { ok: true, message: 'Asked. Somebody who runs the group will answer.' };
}

export async function withdrawGroupRequestAction(
  locale: string,
  slug: string,
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return act(locale, slug, `/me/group-requests/${target(slug)}`, 'DELETE', 'Taken back.');
}

export async function leaveGroupAction(
  locale: string,
  slug: string,
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return act(locale, slug, `/groups/${target(slug)}/members/me`, 'DELETE', 'You have left.');
}

export async function acceptGroupInviteAction(
  locale: string,
  slug: string,
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return act(locale, slug, `/me/group-invites/${target(slug)}/accept`, 'POST', 'You are in.');
}

export async function declineGroupInviteAction(
  locale: string,
  slug: string,
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return act(locale, slug, `/me/group-invites/${target(slug)}`, 'DELETE', 'Declined.');
}

export async function answerJoinRequestAction(
  locale: string,
  slug: string,
  username: string,
  accept: boolean,
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return accept
    ? act(
        locale,
        slug,
        `/groups/${target(slug)}/requests/${target(username)}/accept`,
        'POST',
        `@${username} is in.`,
      )
    : act(
        locale,
        slug,
        `/groups/${target(slug)}/requests/${target(username)}`,
        'DELETE',
        `@${username} was not let in.`,
      );
}
