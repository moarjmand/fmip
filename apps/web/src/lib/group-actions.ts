'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FollowInviteLinkResponse } from '@fmip/contracts';
import { type ApiResult, apiRequest } from '@/lib/api';
import type { ActionState } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';
import { failureState } from './action-failure';

/**
 * Groups: joining, asking, invitations and who runs one (blueprint 8.2, T-242).
 *
 * Server actions, so every control works without JavaScript and the session
 * cookie never leaves the server. Nothing here decides anything: whether a
 * group may be joined, asked, or left is the API's answer over the schema's
 * rules (T-240, D-057), and these pass its sentence through — including the
 * refusals, whose wording is written not to say more than it should.
 */

function failure(result: Extract<ApiResult<unknown>, { ok: false }>): ActionState {
  return failureState(result);
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
  body?: unknown,
): Promise<ActionState> {
  const result = await apiRequest<null>(path, {
    method,
    cookie: await sessionCookieHeader(),
    ...(body === undefined ? {} : { body }),
  });
  if (!result.ok) return failure(result);

  revalidatePath(`/${locale}/groups`);
  revalidatePath(`/${locale}/groups/${encodeURIComponent(slug)}`);
  revalidatePath(`/${locale}/messages`);
  return { ok: true, message: done };
}

function target(value: string): string {
  return encodeURIComponent(value);
}

/**
 * The version of the group's rules the member ticked to accept (T-1023), or
 * null. The form carries the version it showed, so accepting is accepting
 * the words on the screen; the API refuses a version that is no longer
 * current and says so.
 */
function acceptedRules(formData: FormData): { rules_version: number | null } {
  const version = Number(formData.get('rules_version'));
  const ticked = formData.get('accept_rules') === 'on';
  return { rules_version: ticked && Number.isInteger(version) && version > 0 ? version : null };
}

export async function joinGroupAction(
  locale: string,
  slug: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return act(
    locale,
    slug,
    `/groups/${target(slug)}/members`,
    'POST',
    'You are in.',
    acceptedRules(formData),
  );
}

/** The owner writes the next version of the group's rules (T-1023). */
export async function setGroupRulesAction(
  locale: string,
  slug: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await apiRequest<{ version: number }>(`/groups/${target(slug)}/rules`, {
    method: 'PUT',
    cookie: await sessionCookieHeader(),
    body: { body: String(formData.get('body') ?? '') },
  });
  if (!result.ok) return failure(result);
  revalidatePath(`/${locale}/groups/${target(slug)}`);
  return { ok: true, message: `Published as version ${result.data.version}.` };
}

/** The owner's appeal of a closure (T-1025): one note on the decision that closed it. */
export async function appealGroupClosureAction(
  locale: string,
  slug: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await apiRequest<unknown>(`/groups/${target(slug)}/closure/appeal`, {
    method: 'POST',
    cookie: await sessionCookieHeader(),
    body: { body: String(formData.get('body') ?? '').trim() },
  });
  if (!result.ok) return failure(result);
  revalidatePath(`/${locale}/groups/${target(slug)}`);
  return { ok: true, message: 'Sent. A moderator reads every appeal.' };
}

/** A member has read the new rules; they are not shown as new again (T-1023). */
export async function groupRulesSeenAction(
  locale: string,
  slug: string,
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return act(locale, slug, `/groups/${target(slug)}/rules/seen`, 'POST', 'Noted.');
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
    body: { note: note === '' ? null : note, ...acceptedRules(formData) },
  });
  if (!result.ok) return failure(result);

  revalidatePath(`/${locale}/groups`);
  revalidatePath(`/${locale}/groups/${target(slug)}`);
  return { ok: true, message: 'Asked. Somebody who runs the group will answer.' };
}

/**
 * Following an invite link (T-1021): joined goes to the group; a request to a
 * discoverable group stays here and says who answers it. A dead link's
 * sentence (revoked, expired, used up) is the API's.
 */
export async function followInviteLinkAction(
  locale: string,
  token: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await apiRequest<FollowInviteLinkResponse>(
    `/group-invite-links/${target(token)}`,
    { method: 'POST', cookie: await sessionCookieHeader(), body: acceptedRules(formData) },
  );
  if (!result.ok) return failure(result);

  const slug = result.data.group.slug;
  revalidatePath(`/${locale}/groups`);
  revalidatePath(`/${locale}/groups/${target(slug)}`);
  revalidatePath(`/${locale}/messages`);
  if (result.data.outcome === 'joined') redirect(`/${locale}/groups/${target(slug)}`);
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
  formData: FormData,
): Promise<ActionState> {
  return act(
    locale,
    slug,
    `/me/group-invites/${target(slug)}/accept`,
    'POST',
    'You are in.',
    acceptedRules(formData),
  );
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
