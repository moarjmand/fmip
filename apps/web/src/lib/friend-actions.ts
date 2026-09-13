'use server';

import { revalidatePath } from 'next/cache';
import { type ApiResult, apiRequest } from '@/lib/api';
import type { ActionState } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';

/**
 * Friends, requests and blocks (blueprint 8.1, T-202).
 *
 * Server actions, so the session cookie never leaves the server and every one
 * of these works without JavaScript — which matters more here than on most
 * surfaces: blocking somebody is the control a member reaches for when
 * something has gone wrong, and it must not depend on a script having loaded.
 * Each takes `(previous, formData)` it does not read, because that is the shape
 * `useActionState` binds and the button needs the returned message.
 *
 * Nothing is re-implemented. Whether a request may be sent, whether a member is
 * blocked, whether an e-mail is verified: all of it is the API's answer, and
 * these actions pass its sentence through. In particular **the message on a
 * refusal is the API's**, because it is written not to say whether the other
 * member has blocked the viewer.
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
 * Every one of these paths can change what another page shows — a friend list,
 * a pending-request count, a profile that a friendship just made visible — so
 * they all revalidate the friends page and the member's profile.
 */
async function act(
  locale: string,
  username: string,
  path: string,
  method: 'POST' | 'DELETE',
  done: string,
): Promise<ActionState> {
  const result = await apiRequest<null>(path, { method, cookie: await sessionCookieHeader() });
  if (!result.ok) return failure(result);

  revalidatePath(`/${locale}/friends`);
  revalidatePath(`/${locale}/u/${encodeURIComponent(username)}`);
  return { ok: true, message: done };
}

function target(username: string): string {
  return encodeURIComponent(username);
}

export async function sendFriendRequestAction(
  locale: string,
  username: string,
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return act(
    locale,
    username,
    `/me/friend-requests/${target(username)}`,
    'POST',
    `Request sent to @${username}.`,
  );
}

export async function acceptFriendRequestAction(
  locale: string,
  username: string,
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return act(
    locale,
    username,
    `/me/friend-requests/${target(username)}/accept`,
    'POST',
    `You and @${username} are now friends.`,
  );
}

/**
 * Decline a request received, or cancel one sent — the same route, because the
 * two differ only in who started it.
 */
export async function withdrawFriendRequestAction(
  locale: string,
  username: string,
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return act(
    locale,
    username,
    `/me/friend-requests/${target(username)}`,
    'DELETE',
    `The request between you and @${username} is withdrawn.`,
  );
}

export async function unfriendAction(
  locale: string,
  username: string,
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return act(
    locale,
    username,
    `/me/friends/${target(username)}`,
    'DELETE',
    `@${username} is no longer in your friends.`,
  );
}

export async function blockAction(
  locale: string,
  username: string,
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return act(
    locale,
    username,
    `/me/blocks/${target(username)}`,
    'POST',
    `@${username} is blocked. They are not told.`,
  );
}

export async function unblockAction(
  locale: string,
  username: string,
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return act(
    locale,
    username,
    `/me/blocks/${target(username)}`,
    'DELETE',
    // Said here because it is the surprising half: lifting a block restores the
    // possibility of contact, not the friendship the block ended.
    `@${username} is unblocked. Any friendship the block ended is not restored.`,
  );
}
