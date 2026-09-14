'use client';

import { useActionState } from 'react';
import type { ActionState } from '@/lib/auth-actions';
import {
  leaveConversationAction,
  openConversationAction,
  removeMessageAction,
  sendMessageAction,
  setMutedAction,
} from '@/lib/conversation-actions';

type BoundAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

function Result({ state, testId }: { state: ActionState; testId: string }) {
  if (state === null) return null;
  return (
    <p
      role="status"
      className={`text-sm ${state.ok ? 'opacity-70' : 'text-red-800'}`}
      data-testid={testId}
    >
      {state.ok ? (state.message ?? 'Done.') : state.message}
    </p>
  );
}

/**
 * The composer (blueprint 8.3, T-224).
 *
 * A plain form over a server action: it works without JavaScript, and there is
 * **no socket behind it** — T-230 is the transport, and this surface is correct
 * before it exists. After sending, the page re-renders from the store, which is
 * the same thing a reconnecting client will do.
 *
 * The card fields are hidden inputs carrying a kind and a UUID, because that is
 * all a card is (rule 1): a page that posted a team name would be inventing the
 * thing the API resolves.
 */
export function Composer({
  locale,
  conversationId,
  disabled,
  card,
}: {
  locale: string;
  conversationId: string;
  /** Set when the viewer has left: they can read every word and write none. */
  disabled?: string;
  card?: { kind: string; id: string; label: string };
}) {
  const action = sendMessageAction.bind(null, locale, conversationId) as BoundAction;
  const [state, formAction, pending] = useActionState(action, null);

  if (disabled !== undefined) {
    return (
      <p className="text-sm opacity-70" data-testid="composer-closed">
        {disabled}
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2" data-testid="composer">
      {card !== undefined && (
        <>
          <input type="hidden" name="card_kind" value={card.kind} />
          <input type="hidden" name="card_id" value={card.id} />
          <p className="text-sm opacity-70">Sharing: {card.label}</p>
        </>
      )}
      <label htmlFor="message-body" className="sr-only">
        Your message
      </label>
      <textarea
        id="message-body"
        name="body"
        rows={3}
        maxLength={4000}
        placeholder={card === undefined ? 'Write a message' : 'Say something about it (optional)'}
        className="rounded border border-current/30 bg-transparent px-3 py-2 text-start"
      />
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded bg-current px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:text-black"
        data-testid="composer-send"
      >
        {pending ? 'Sending…' : 'Send'}
      </button>
      <Result state={state} testId="composer-result" />
    </form>
  );
}

/** Mute, unmute and leave: the exits, on the surface they belong to (D-053). */
export function ConversationExits({
  locale,
  conversationId,
  muted,
  left,
}: {
  locale: string;
  conversationId: string;
  muted: boolean;
  left: boolean;
}) {
  const mute = setMutedAction.bind(null, locale, conversationId, !muted) as BoundAction;
  const leave = leaveConversationAction.bind(null, locale, conversationId) as BoundAction;
  const [muteState, muteAction, mutePending] = useActionState(mute, null);
  const [leaveState, leaveAction, leavePending] = useActionState(leave, null);

  const button =
    'self-start rounded border border-current/30 px-3 py-1 text-sm disabled:opacity-50';

  return (
    <div className="flex flex-wrap items-start gap-3" data-testid="conversation-exits">
      <form action={muteAction} className="flex flex-col gap-1">
        <button
          type="submit"
          disabled={mutePending}
          className={button}
          data-testid="conversation-mute"
        >
          {muted ? 'Unmute' : 'Mute'}
        </button>
        <Result state={muteState} testId="conversation-mute-result" />
      </form>

      {!left && (
        <form action={leaveAction} className="flex flex-col gap-1">
          <button
            type="submit"
            disabled={leavePending}
            className={button}
            data-testid="conversation-leave"
          >
            Leave
          </button>
          <Result state={leaveState} testId="conversation-leave-result" />
        </form>
      )}
    </div>
  );
}

/** The author takes their own message down. */
export function RemoveMessage({
  locale,
  conversationId,
  messageId,
}: {
  locale: string;
  conversationId: string;
  messageId: string;
}) {
  const action = removeMessageAction.bind(
    null,
    locale,
    conversationId,
    messageId,
  ) as unknown as BoundAction;
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <button
        type="submit"
        disabled={pending}
        className="self-start text-xs underline opacity-60 disabled:opacity-30"
        data-testid="message-remove"
      >
        Remove
      </button>
      <Result state={state} testId="message-remove-result" />
    </form>
  );
}

/** "Message them", from a member's profile. */
export function StartConversation({ locale, username }: { locale: string; username: string }) {
  const action = openConversationAction.bind(null, locale, username) as BoundAction;
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded border border-current/30 px-3 py-1 text-sm disabled:opacity-50"
        data-testid="start-conversation"
      >
        {pending ? 'Opening…' : 'Message'}
      </button>
      {/* The refusal is the API's, including the one that says you can message
          members you are friends with. */}
      <Result state={state} testId="start-conversation-result" />
    </form>
  );
}
