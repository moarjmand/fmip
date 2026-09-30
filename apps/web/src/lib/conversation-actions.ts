'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { CardKind, Reaction, SendMessageResponse } from '@fmip/contracts';
import { type ApiResult, apiRequest } from '@/lib/api';
import type { ActionState } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { type MessageKey, t } from '@/i18n/messages';
import { failureState } from './action-failure';

/**
 * Sending, reading and leaving a conversation (blueprint 8.3, T-224).
 *
 * Server actions, so the session cookie never leaves the server and the whole
 * surface works without JavaScript. That matters more here than almost
 * anywhere: **there is no socket yet and there deliberately is not one**
 * (T-230 is the transport). A chat page that only works once a script has
 * loaded and a connection has opened would make the socket the source of truth
 * by accident, which is the one thing E22 was ordered to avoid.
 *
 * Every refusal is the API's, including the ones that do not say why. A block
 * comes back as "this conversation is not available"; a sanction says where to
 * appeal; a ceiling says to try later. None of those sentences is re-written
 * here.
 */

function failure(result: Extract<ApiResult<unknown>, { ok: false }>): ActionState {
  return failureState(result);
}

/** The sentence a success says, in the reader's language (T-1308). */
function said(locale: string, key: MessageKey): string {
  return t(isLocale(locale) ? locale : DEFAULT_LOCALE, key);
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Send a message, optionally carrying a football card.
 *
 * The card is a kind and a UUID and nothing else (rule 1): the page never sends
 * a team name or a score, because what is stored is a reference and what is
 * shown is resolved when the conversation is read (T-222).
 */
export async function sendMessageAction(
  locale: string,
  conversationId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const body = text(formData, 'body');
  const cardKind = text(formData, 'card_kind');
  const cardId = text(formData, 'card_id');

  const result = await apiRequest<SendMessageResponse>(
    `/me/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: 'POST',
      cookie: await sessionCookieHeader(),
      body: {
        body,
        ...(cardKind !== '' && cardId !== ''
          ? { card: { kind: cardKind as CardKind, id: cardId } }
          : {}),
      },
    },
  );
  if (!result.ok) return failure(result);

  revalidatePath(`/${locale}/messages/${conversationId}`);
  revalidatePath(`/${locale}/messages`);
  return { ok: true };
}

/** The author takes their own message down. It leaves a tombstone, not a hole. */
export async function removeMessageAction(
  locale: string,
  conversationId: string,
  messageId: string,
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const result = await apiRequest<null>(
    `/me/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
    { method: 'DELETE', cookie: await sessionCookieHeader() },
  );
  if (!result.ok) return failure(result);

  revalidatePath(`/${locale}/messages/${conversationId}`);
  return { ok: true, message: said(locale, 'messagesPage.done.removed') };
}

/**
 * A group's owner or moderator removes somebody's message, with a reason
 * (T-1024, D-134). The reason is what the author is told; the API audits it
 * with the message as it was.
 */
export async function removeAsGroupModeratorAction(
  locale: string,
  conversationId: string,
  messageId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await apiRequest<null>(
    `/me/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/removal`,
    {
      method: 'POST',
      cookie: await sessionCookieHeader(),
      body: { reason: String(formData.get('reason') ?? '').trim() },
    },
  );
  if (!result.ok) return failure(result);

  revalidatePath(`/${locale}/messages/${conversationId}`);
  return { ok: true, message: said(locale, 'messagesPage.done.moderated') };
}

/**
 * Move the read position forward.
 *
 * Called when the page renders rather than by a script watching the viewport,
 * which means "read" here means "opened", and the product does not claim more
 * than that.
 */
export async function markReadAction(conversationId: string, seq: number): Promise<void> {
  if (seq <= 0) return;
  await apiRequest<null>(`/me/conversations/${encodeURIComponent(conversationId)}/read`, {
    method: 'POST',
    cookie: await sessionCookieHeader(),
    body: { seq },
  });
}

export async function setMutedAction(
  locale: string,
  conversationId: string,
  muted: boolean,
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const result = await apiRequest<null>(
    `/me/conversations/${encodeURIComponent(conversationId)}/mute`,
    { method: muted ? 'POST' : 'DELETE', cookie: await sessionCookieHeader() },
  );
  if (!result.ok) return failure(result);

  revalidatePath(`/${locale}/messages/${conversationId}`);
  revalidatePath(`/${locale}/messages`);
  return {
    ok: true,
    message: said(locale, muted ? 'messagesPage.done.muted' : 'messagesPage.done.unmuted'),
  };
}

/** Leaving is never gated. It is the exit. */
export async function leaveConversationAction(
  locale: string,
  conversationId: string,
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const result = await apiRequest<null>(
    `/me/conversations/${encodeURIComponent(conversationId)}/leave`,
    { method: 'POST', cookie: await sessionCookieHeader() },
  );
  if (!result.ok) return failure(result);

  revalidatePath(`/${locale}/messages/${conversationId}`);
  revalidatePath(`/${locale}/messages`);
  return {
    ok: true,
    message: said(locale, 'messagesPage.done.left'),
  };
}

/**
 * Open the conversation with a member, from their profile.
 *
 * Redirects into it on success, because the member asked to talk to somebody
 * rather than to be told that a conversation now exists.
 */
export async function openConversationAction(
  locale: string,
  username: string,
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const result = await apiRequest<{ id: string }>(
    `/me/conversations/direct/${encodeURIComponent(username)}`,
    { method: 'POST', cookie: await sessionCookieHeader() },
  );
  if (!result.ok) return failure(result);

  revalidatePath(`/${locale}/messages`);
  redirect(`/${locale}/messages/${result.data.id}`);
}

/**
 * React to a message, or take the reaction back (T-226).
 *
 * A form button each, over a server action, so reacting works with no
 * JavaScript at all. That is the acceptance criterion and it is also what keeps
 * this surface honest: the socket of T-230 is still not here, and nothing on
 * this page depends on one.
 */
export async function reactAction(
  locale: string,
  conversationId: string,
  messageId: string,
  reaction: Reaction,
  mine: boolean,
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const result = await apiRequest<null>(
    `/me/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(reaction)}`,
    { method: mine ? 'DELETE' : 'PUT', cookie: await sessionCookieHeader() },
  );
  if (!result.ok) return failure(result);

  revalidatePath(`/${locale}/messages/${conversationId}`);
  return { ok: true };
}

/** Pin a message in its conversation, or unpin it. */
export async function setPinnedAction(
  locale: string,
  conversationId: string,
  messageId: string,
  pinned: boolean,
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const result = await apiRequest<null>(
    `/me/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/pin`,
    { method: pinned ? 'POST' : 'DELETE', cookie: await sessionCookieHeader() },
  );
  if (!result.ok) return failure(result);

  revalidatePath(`/${locale}/messages/${conversationId}`);
  return {
    ok: true,
    message: said(locale, pinned ? 'messagesPage.done.pinned' : 'messagesPage.done.unpinned'),
  };
}
