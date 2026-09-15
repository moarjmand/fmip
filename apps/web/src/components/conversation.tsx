import Link from 'next/link';
import { conversationTitle, threadStanding } from '@/lib/conversation-title';
import type { ConversationSummary, Message, SharedCard } from '@fmip/contracts';
import { Score } from '@/components/score';

/**
 * One conversation, read (blueprint 8.3, T-224).
 *
 * **No socket, deliberately.** T-230 is the transport; this page is correct
 * without it, which is what lets the socket be added to something already right
 * rather than becoming the source of truth by accident.
 */

function when(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(iso));
}

/**
 * A shared football card, as it is **now**.
 *
 * The message stored a kind and a UUID; everything on screen here was resolved
 * when the page was rendered, which is what blueprint 8.3 means by a card that
 * "remains live". The fixture card says when it last changed (rule 4), and the
 * score goes through `<Score>` so a right-to-left paragraph cannot lay `2 – 1`
 * out backwards (T-153, rule 7).
 */
export function FootballCard({ card, locale }: { card: SharedCard; locale: string }) {
  const frame = 'rounded border border-current/20 p-3 text-sm';

  if (card.kind === 'gone') {
    return (
      <p className={`${frame} opacity-70`} data-testid="card-gone">
        Something was shared here that no longer exists.
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
          {card.home} v {card.away}
        </span>
        <span className="opacity-70">
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
        <span className="text-xs opacity-60">
          Updated <time dateTime={card.last_updated_at}>{card.last_updated_at.slice(0, 16)}</time>
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
          {card.home} v {card.away}
        </span>
        {/* A shared prediction is always attributed: it is one member's call, and
            never any of the three prediction products (rule 6). */}
        <span className="opacity-70">
          @{card.by} says {card.outcome} · confidence {card.confidence}
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
    <p className={`${frame} opacity-70`} data-testid="card-unknown">
      Something was shared here that this page cannot show yet.
    </p>
  );
}

export function MessageRow({
  message,
  locale,
  timeZone,
  isMine,
}: {
  message: Message;
  locale: string;
  timeZone: string;
  isMine: boolean;
}) {
  return (
    <li className="flex flex-col gap-1" data-testid="message">
      <p className="text-xs opacity-60">
        <span className="font-medium">@{message.author}</span> ·{' '}
        <time dateTime={message.created_at}>{when(message.created_at, timeZone)}</time>
      </p>

      {message.removed !== null ? (
        // A tombstone rather than a hole: the conversation around it still
        // reads, and a reader can tell who took it down.
        <p className="text-sm italic opacity-60" data-testid="message-removed">
          {message.removed.by === 'moderator'
            ? 'Removed by a moderator.'
            : 'The author removed this.'}
        </p>
      ) : (
        <>
          {message.body !== null && <p className="whitespace-pre-line text-sm">{message.body}</p>}
          {message.card !== null && <FootballCard card={message.card} locale={locale} />}
        </>
      )}

      {message.removed === null && message.mentions.length > 0 && (
        // Said beside the message rather than woven into it. Highlighting
        // `@name` inside the body would mean parsing text the API has already
        // parsed once, and the two could disagree about who was named --
        // especially after somebody renames themselves, which is exactly what
        // storing the mention was meant to survive (T-225).
        <p className="text-xs opacity-60" data-testid="message-mentions">
          Mentioned {message.mentions.map((username) => `@${username}`).join(', ')}
        </p>
      )}

      {message.pinned && (
        <p className="text-xs opacity-60" data-testid="message-pinned">
          Pinned in this conversation
        </p>
      )}

      {isMine && message.removed === null && (
        <span className="text-xs opacity-50" data-testid="message-mine">
          Yours
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
      <h1 className="text-2xl font-semibold">{conversationTitle(conversation, me)}</h1>
      {match !== null && (
        <p className="text-sm" data-testid="conversation-fixture">
          <Link href={`/${locale}/match/${match.id}`} className="underline">
            {match.home} v {match.away}
          </Link>
          <span className="opacity-70"> · {threadStanding(conversation)}</span>
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
      <p className="text-sm opacity-70">
        {others.map((member) => (
          <Link
            key={member.username}
            href={`/${locale}/u/${encodeURIComponent(member.username)}`}
            className="underline"
          >
            @{member.username}
          </Link>
        ))}
        {conversation.muted && <span data-testid="conversation-muted"> · muted</span>}
        {conversation.left && <span data-testid="conversation-left"> · you have left</span>}
      </p>
      <p className="text-xs opacity-60">
        Blocking and reporting live on a member&rsquo;s profile, where they work the same way
        everywhere else in the product.
      </p>
    </div>
  );
}
