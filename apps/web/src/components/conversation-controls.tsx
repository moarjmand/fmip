'use client';

import { useActionState } from 'react';
import { REACTIONS, type Reaction, type ReactionCount } from '@fmip/contracts';
import type { ActionState } from '@/lib/auth-actions';
import {
  leaveConversationAction,
  openConversationAction,
  reactAction,
  removeMessageAction,
  sendMessageAction,
  setMutedAction,
  setPinnedAction,
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

/** What each reaction is called where a reader can see it. */
const REACTION_LABELS: Record<Reaction, string> = {
  agree: 'Agree',
  disagree: 'Disagree',
  laugh: 'Ha',
  surprise: 'Oh',
  sad: 'Sad',
  celebrate: 'Yes',
};

function ReactionButton({
  locale,
  conversationId,
  messageId,
  reaction,
  count,
  mine,
}: {
  locale: string;
  conversationId: string;
  messageId: string;
  reaction: Reaction;
  count: number;
  mine: boolean;
}) {
  const action = reactAction.bind(
    null,
    locale,
    conversationId,
    messageId,
    reaction,
    mine,
  ) as unknown as BoundAction;
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="inline">
      <button
        type="submit"
        disabled={pending}
        aria-pressed={mine}
        className={`rounded-full border px-2 py-0.5 text-xs disabled:opacity-50 ${
          mine ? 'border-current' : 'border-current/30 opacity-70'
        }`}
        data-testid={`reaction-${reaction}`}
      >
        {REACTION_LABELS[reaction]}
        {count > 0 ? ` ${count}` : ''}
      </button>
      {state !== null && !state.ok && (
        <span role="status" className="text-xs text-red-800">
          {' '}
          {state.message}
        </span>
      )}
    </form>
  );
}

/**
 * The reactions on one message (blueprint 8.3, T-226).
 *
 * Every reaction is its own form over a server action, so **reacting works with
 * no JavaScript**. The ones nobody has used yet are behind a `<details>`, which
 * is the one disclosure widget the browser gives for free — a popover would
 * have needed a script and would have made this the first control on the
 * surface that did.
 */
export function Reactions({
  locale,
  conversationId,
  messageId,
  reactions,
}: {
  locale: string;
  conversationId: string;
  messageId: string;
  reactions: ReactionCount[];
}) {
  const used = new Map(reactions.map((entry) => [entry.reaction, entry]));
  const unused = REACTIONS.filter((reaction) => !used.has(reaction));

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="reactions">
      {reactions.map((entry) => (
        <ReactionButton
          key={entry.reaction}
          locale={locale}
          conversationId={conversationId}
          messageId={messageId}
          reaction={entry.reaction}
          count={entry.count}
          mine={entry.mine}
        />
      ))}
      {unused.length > 0 && (
        <details className="inline">
          <summary className="cursor-pointer text-xs opacity-60">React</summary>
          <div className="mt-1 flex flex-wrap gap-2">
            {unused.map((reaction) => (
              <ReactionButton
                key={reaction}
                locale={locale}
                conversationId={conversationId}
                messageId={messageId}
                reaction={reaction}
                count={0}
                mine={false}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/** Pin a message where everybody in the conversation can find it again. */
export function PinMessage({
  locale,
  conversationId,
  messageId,
  pinned,
}: {
  locale: string;
  conversationId: string;
  messageId: string;
  pinned: boolean;
}) {
  const action = setPinnedAction.bind(
    null,
    locale,
    conversationId,
    messageId,
    !pinned,
  ) as unknown as BoundAction;
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="inline">
      <button
        type="submit"
        disabled={pending}
        className="text-xs underline opacity-60 disabled:opacity-30"
        data-testid="message-pin"
      >
        {pinned ? 'Unpin' : 'Pin'}
      </button>
      {state !== null && !state.ok && (
        <span role="status" className="text-xs text-red-800">
          {' '}
          {state.message}
        </span>
      )}
    </form>
  );
}
