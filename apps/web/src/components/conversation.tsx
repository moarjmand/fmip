import Link from 'next/link';
import { conversationTitle, threadStanding } from '@/lib/conversation-title';
import type { ConversationSummary, Message, SharedCard } from '@fmip/contracts';
import { MemberName } from '@/components/member-name';
import { Score } from '@/components/score';
import { memberName } from '@/lib/member-name';
import { formatDateTime, formatNumber } from '@/i18n/format';
import type { MessageKey } from '@/i18n/messages';
import { Said, said } from '@/components/community-text';
import { Translated } from '@/components/translated';

/**
 * A member's call on a shared prediction card, in words. The English is the
 * contract's own value, so an English page reads as it always did; an
 * outcome this map does not know is shown as it came.
 */
const OUTCOME: Record<string, MessageKey> = {
  home: 'messagesPage.card.outcome.home',
  draw: 'messagesPage.card.outcome.draw',
  away: 'messagesPage.card.outcome.away',
};

/**
 * One conversation, read (blueprint 8.3, T-224).
 *
 * **No socket, deliberately.** T-230 is the transport; this page is correct
 * without it, which is what lets the socket be added to something already right
 * rather than becoming the source of truth by accident.
 */

/**
 * A shared football card, as it is **now**.
 *
 * The message stored a kind and a UUID; everything on screen here was resolved
 * when the page was rendered, which is what blueprint 8.3 means by a card that
 * "remains live". The fixture card says when it last changed (rule 4), and the
 * score goes through `<Score>` so a right-to-left paragraph cannot lay `2 – 1`
 * out backwards (T-153, rule 7).
 */
export function FootballCard({
  card,
  locale,
  timeZone,
}: {
  card: SharedCard;
  locale: string;
  /** The reader's zone, for the card's "updated" stamp. */
  timeZone: string;
}) {
  const frame = 'rounded border border-default p-3 text-sm';

  if (card.kind === 'gone') {
    return (
      <p className={`${frame} text-muted`} data-testid="card-gone">
        <Translated locale={locale} message="messagesPage.card.gone" />
      </p>
    );
  }

  if (card.kind === 'fixture') {
    return (
      <Link
        href={`/${locale}/match/${card.id}`}
        className={`${frame} flex flex-col gap-1`}
        data-testid="card-fixture"
      >
        <span className="font-medium">
          <Said
            locale={locale}
            message="messagesPage.versus"
            params={{ home: card.home, away: card.away }}
          />
        </span>
        <span className="text-muted">
          {card.score === null ? (
            card.status
          ) : (
            <>
              <Score home={card.score.home} away={card.score.away} separator=" – " /> ·{' '}
              {card.status}
            </>
          )}
        </span>
        {/* Rule 4: a live surface says when it last changed. */}
        <span className="text-xs text-muted">
          <Translated locale={locale} message="messagesPage.card.updated" />{' '}
          <time dateTime={card.last_updated_at}>
            {formatDateTime(locale, card.last_updated_at, timeZone)}
          </time>
        </span>
      </Link>
    );
  }

  if (card.kind === 'team') {
    return (
      <Link href={`/${locale}/team/${card.id}`} className={frame} data-testid="card-team">
        {card.name}
      </Link>
    );
  }

  if (card.kind === 'person') {
    return (
      <Link href={`/${locale}/player/${card.id}`} className={frame} data-testid="card-person">
        {card.name}
      </Link>
    );
  }

  if (card.kind === 'prediction') {
    return (
      <div className={`${frame} flex flex-col gap-1`} data-testid="card-prediction">
        <span className="font-medium">
          <Said
            locale={locale}
            message="messagesPage.versus"
            params={{ home: card.home, away: card.away }}
          />
        </span>
        {/* A shared prediction is always attributed: it is one member's call, and
            never any of the three prediction products (rule 6). */}
        <span className="text-muted">
          <MemberName locale={locale} member={{ username: card.by }} />{' '}
          <Said
            locale={locale}
            message="messagesPage.card.says"
            params={{
              outcome:
                OUTCOME[card.outcome] === undefined
                  ? card.outcome
                  : said(locale, OUTCOME[card.outcome]!).text,
              confidence: formatNumber(locale, card.confidence),
            }}
          />
        </span>
      </div>
    );
  }

  // Every kind above is explicit, and this is what is left. A kind added to the
  // contract without a branch here would otherwise have been rendered as
  // whichever branch happened to be last -- a new card silently labelled
  // somebody's prediction. `conversation.spec.ts` fails before that can ship;
  // this says something true if it ever gets past.
  return (
    <p className={`${frame} text-muted`} data-testid="card-unknown">
      <Translated locale={locale} message="messagesPage.card.unknown" />
    </p>
  );
}

export function MessageRow({
  message,
  locale,
  timeZone,
  isMine,
  lang,
}: {
  message: Message;
  locale: string;
  timeZone: string;
  isMine: boolean;
  /**
   * The group's language (T-1022), on what members wrote and nothing else:
   * the author's name and the time around it are the site's words.
   */
  lang?: string;
}) {
  return (
    <li className="flex flex-col gap-1" data-testid="message">
      <p className="text-xs text-muted">
        {/* A deleted account's words stay, under no name (T-812, D-094). */}
        <MemberName
          locale={locale}
          member={{ username: message.author }}
          className="font-medium"
        />{' '}
        ·{' '}
        <time dateTime={message.created_at}>
          {formatDateTime(locale, message.created_at, timeZone)}
        </time>
      </p>

      {message.removed !== null ? (
        // A tombstone rather than a hole: the conversation around it still
        // reads, and a reader can tell who took it down.
        <p className="text-sm italic text-muted" data-testid="message-removed">
          <Translated
            locale={locale}
            message={
              message.removed.by === 'moderator'
                ? 'messagesPage.removedByModerator'
                : 'messagesPage.removedByAuthor'
            }
          />
          {/* Only the author is sent the reason (T-1024): they are told why. */}
          {message.removed.reason !== undefined && (
            <span data-testid="message-removed-reason">
              {' '}
              <Said
                locale={locale}
                message="messagesPage.removedWhy"
                params={{ reason: message.removed.reason }}
              />
            </span>
          )}
        </p>
      ) : (
        <>
          {message.body !== null && (
            <p className="whitespace-pre-line text-sm" lang={lang}>
              {message.body}
            </p>
          )}
          {message.card !== null && (
            <FootballCard card={message.card} locale={locale} timeZone={timeZone} />
          )}
        </>
      )}

      {message.removed === null && message.mentions.length > 0 && (
        // Said beside the message rather than woven into it. Highlighting
        // `@name` inside the body would mean parsing text the API has already
        // parsed once, and the two could disagree about who was named --
        // especially after somebody renames themselves, which is exactly what
        // storing the mention was meant to survive (T-225).
        <p className="text-xs text-muted" data-testid="message-mentions">
          <Said
            locale={locale}
            message="messagesPage.mentioned"
            params={{
              names: message.mentions
                .map((username) => memberName(locale, { username }))
                .join(', '),
            }}
          />
        </p>
      )}

      {message.pinned && (
        <p className="text-xs text-muted" data-testid="message-pinned">
          <Translated locale={locale} message="messagesPage.pinnedHere" />
        </p>
      )}

      {isMine && message.removed === null && (
        <span className="text-xs text-muted" data-testid="message-mine">
          <Translated locale={locale} message="messagesPage.yours" />
        </span>
      )}
    </li>
  );
}

/**
 * The other people in a conversation, and the way out of it.
 *
 * D-053 says every conversational surface ships with its exits already built,
 * so mute, leave, block and report are here on the day the surface is, not in a
 * later epic. Block and report are the social and moderation boundaries' own
 * controls, reached through the member's profile rather than re-implemented.
 */
export function ConversationHeader({
  conversation,
  me,
  locale,
}: {
  conversation: ConversationSummary;
  me: string;
  locale: string;
}) {
  const others = conversation.members.filter((member) => member.username !== me);
  const match = conversation.fixture;

  return (
    <div className="flex flex-col gap-2" data-testid="conversation-header">
      {/* One name for every kind (T-248). A group's room and each of its match
          threads carry the same group and no members of their own, so titling
          by the group alone would have called them all the same thing — and a
          direct conversation with nobody left in it is still not a group. */}
      <h1 className="text-2xl font-semibold">{conversationTitle(conversation, me, locale)}</h1>
      {match !== null && (
        <p className="text-sm" data-testid="conversation-fixture">
          <Link href={`/${locale}/match/${match.id}`} className="underline">
            <Said
              locale={locale}
              message="messagesPage.versus"
              params={{ home: match.home, away: match.away }}
            />
          </Link>
          <span className="text-muted"> · {threadStanding(conversation)}</span>
          {conversation.group !== null && (
            <>
              {' · '}
              <Link
                href={`/${locale}/groups/${encodeURIComponent(conversation.group.slug)}`}
                className="underline"
              >
                {conversation.group.name}
              </Link>
            </>
          )}
        </p>
      )}
      <p className="text-sm text-muted">
        {others.map((member) => (
          <MemberName
            key={member.username}
            locale={locale}
            member={{ username: member.username }}
            link
            className="underline"
          />
        ))}
        {conversation.muted && (
          <span data-testid="conversation-muted">
            {' · '}
            <Translated locale={locale} message="messagesPage.muted" />
          </span>
        )}
        {conversation.left && (
          <span data-testid="conversation-left">
            {' · '}
            <Translated locale={locale} message="messagesPage.youLeft" />
          </span>
        )}
      </p>
      <p className="text-xs text-muted">
        <Translated locale={locale} message="messagesPage.blockingNote" />
      </p>
    </div>
  );
}
