import type { ReactNode } from 'react';
import {
  MAX_MESSAGE_REMOVAL_REASON,
  REACTIONS,
  type Reaction,
  type ReactionCount,
} from '@fmip/contracts';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { formatNumber } from '@/i18n/format';
import { type MessageKey, attribute } from '@/i18n/messages';
import type { ActionState } from '@/lib/auth-actions';
import {
  leaveConversationAction,
  openConversationAction,
  reactAction,
  removeAsGroupModeratorAction,
  removeMessageAction,
  sendMessageAction,
  setMutedAction,
  setPinnedAction,
} from '@/lib/conversation-actions';
import { CommunityAction, CommunityChip } from '@/components/community-action';
import { Said } from '@/components/community-text';
import { Translated } from '@/components/translated';
import { TextArea } from '@/components/ui';

type BoundAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

/*
 * Server components since T-1308: each control's words are chosen from the
 * catalogue here and handed to the client form (`CommunityAction`) already
 * resolved, so the catalogues stay on the server (T-1040). Every control is
 * still its own `<form action={formAction}>` over a server action, and works
 * without JavaScript.
 */

function done(locale: string) {
  return <Translated locale={locale} message="messagesPage.control.done" />;
}

/**
 * The composer (blueprint 8.3, T-224).
 *
 * A plain form over a server action (`sendMessageAction`): it works without
 * JavaScript, and there is **no socket behind it** — T-230 is the transport,
 * and this surface is correct before it exists. After sending, the page
 * re-renders from the store, which is the same thing a reconnecting client
 * will do.
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
  disabled?: ReactNode;
  card?: { kind: string; id: string; label: string };
}) {
  if (disabled !== undefined) {
    return (
      <p className="text-sm text-muted" data-testid="composer-closed">
        {disabled}
      </p>
    );
  }

  const here = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const placeholder = attribute(
    here,
    card === undefined ? 'messagesPage.composer.placeholder' : 'messagesPage.composer.aboutCard',
  );

  return (
    <CommunityAction
      action={sendMessageAction.bind(null, locale, conversationId) as BoundAction}
      submit={<Translated locale={locale} message="messagesPage.composer.send" />}
      working={<Translated locale={locale} message="messagesPage.composer.sending" />}
      done={done(locale)}
      variant="primary"
      size="md"
      buttonClassName="self-start text-sm"
      formClassName="flex flex-col gap-2"
      formTestId="composer"
      testId="composer-send"
      resultTestId="composer-result"
    >
      {card !== undefined && (
        <>
          <input type="hidden" name="card_kind" value={card.kind} />
          <input type="hidden" name="card_id" value={card.id} />
          <p className="text-sm text-muted">
            <Said
              locale={locale}
              message="messagesPage.composer.sharing"
              params={{ card: card.label }}
            />
          </p>
        </>
      )}
      <TextArea
        label={<Translated locale={locale} message="messagesPage.composer.label" />}
        hideLabel
        id="message-body"
        name="body"
        rows={3}
        maxLength={4000}
        placeholder={placeholder.text}
        lang={placeholder.lang}
      />
    </CommunityAction>
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
  return (
    <div className="flex flex-wrap items-start gap-3" data-testid="conversation-exits">
      <CommunityAction
        action={setMutedAction.bind(null, locale, conversationId, !muted) as BoundAction}
        submit={
          <Translated
            locale={locale}
            message={muted ? 'messagesPage.control.unmute' : 'messagesPage.control.mute'}
          />
        }
        done={done(locale)}
        testId="conversation-mute"
      />

      {!left && (
        <CommunityAction
          action={leaveConversationAction.bind(null, locale, conversationId) as BoundAction}
          submit={<Translated locale={locale} message="messagesPage.control.leave" />}
          done={done(locale)}
          testId="conversation-leave"
        />
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
  return (
    <CommunityAction
      action={
        removeMessageAction.bind(null, locale, conversationId, messageId) as unknown as BoundAction
      }
      submit={<Translated locale={locale} message="messagesPage.control.remove" />}
      done={done(locale)}
      variant="ghost"
      size="xs"
      buttonClassName="self-start text-muted"
      testId="message-remove"
    />
  );
}

/**
 * A group's owner or moderator removes somebody else's message, with a reason
 * (T-1024, D-134). Behind a disclosure, because it is a moderation act and not
 * a reaction: a reason is asked for before anything happens.
 */
export function ModerateMessage({
  locale,
  conversationId,
  messageId,
}: {
  locale: string;
  conversationId: string;
  messageId: string;
}) {
  return (
    <details className="text-xs" data-testid="message-moderate">
      <summary className="cursor-pointer text-muted">
        <Translated locale={locale} message="messagesPage.moderate.summary" />
      </summary>
      <CommunityAction
        action={
          removeAsGroupModeratorAction.bind(
            null,
            locale,
            conversationId,
            messageId,
          ) as unknown as BoundAction
        }
        submit={<Translated locale={locale} message="messagesPage.control.remove" />}
        done={done(locale)}
        variant="secondary"
        size="xs"
        formClassName="mt-2 flex flex-col gap-2"
        testId="message-moderate-submit"
        resultTestId="message-moderate-result"
      >
        <TextArea
          label={<Translated locale={locale} message="messagesPage.moderate.reason" />}
          id={`moderate-reason-${messageId}`}
          name="reason"
          rows={2}
          maxLength={MAX_MESSAGE_REMOVAL_REASON}
          required
          data-testid="message-moderate-reason"
        />
      </CommunityAction>
    </details>
  );
}

/** "Message them", from a member's profile. */
export function StartConversation({ locale, username }: { locale: string; username: string }) {
  // The refusal is the API's, including the one that says you can message
  // members you are friends with.
  return (
    <CommunityAction
      action={openConversationAction.bind(null, locale, username) as BoundAction}
      submit={<Translated locale={locale} message="messagesPage.control.message" />}
      working={<Translated locale={locale} message="messagesPage.control.opening" />}
      done={done(locale)}
      testId="start-conversation"
    />
  );
}

/** What each reaction is called where a reader can see it. */
const REACTION_LABELS: Record<Reaction, MessageKey> = {
  agree: 'messagesPage.reaction.agree',
  disagree: 'messagesPage.reaction.disagree',
  laugh: 'messagesPage.reaction.laugh',
  surprise: 'messagesPage.reaction.surprise',
  sad: 'messagesPage.reaction.sad',
  celebrate: 'messagesPage.reaction.celebrate',
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
  return (
    <CommunityChip
      action={
        reactAction.bind(
          null,
          locale,
          conversationId,
          messageId,
          reaction,
          mine,
        ) as unknown as BoundAction
      }
      pressed={mine}
      className={`rounded-full border px-2 py-0.5 text-xs disabled:opacity-50 ${
        mine ? 'border-accent' : 'border-strong text-muted'
      }`}
      testId={`reaction-${reaction}`}
    >
      <Translated locale={locale} message={REACTION_LABELS[reaction]} />
      {count > 0 ? ` ${formatNumber(locale, count)}` : ''}
    </CommunityChip>
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
          <summary className="cursor-pointer text-xs text-muted">
            <Translated locale={locale} message="messagesPage.reaction.react" />
          </summary>
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
  return (
    <CommunityAction
      action={
        setPinnedAction.bind(
          null,
          locale,
          conversationId,
          messageId,
          !pinned,
        ) as unknown as BoundAction
      }
      submit={
        <Translated
          locale={locale}
          message={pinned ? 'messagesPage.control.unpin' : 'messagesPage.control.pin'}
        />
      }
      variant="ghost"
      size="xs"
      buttonClassName="text-muted"
      formClassName="inline"
      result="failure-inline"
      testId="message-pin"
    />
  );
}
