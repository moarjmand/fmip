'use client';

import { type ReactNode, useActionState } from 'react';
import type { PanelReaction, PanelReactionTally } from '@fmip/contracts';
import { PANEL_REACTIONS } from '@fmip/contracts';
import { setFollowAction, setPanelReactionAction } from '@/lib/panel-social-actions';
import { Button, FormStatus } from '@/components/ui';
import { MessageText } from '@/components/message-text';
import { formatNumber } from '@/i18n/format';
import type { Message } from '@/i18n/messages';

/**
 * Reacting to a panel post, and following a contributor (blueprint 10.2,
 * T-252).
 *
 * **Both of these are shown to any signed-in member, and to nobody else.** Not
 * because approval is being checked — it is deliberately not — but because a
 * guest has no account to react or follow from. The difference matters: the
 * controls are hidden for a guest and *present* for an unapproved member, which
 * is the visible form of "reacting is open to members".
 *
 * A guest is told what signing in would give them rather than shown nothing, so
 * the absence reads as a door rather than as a surface that does not exist.
 */

/**
 * Each reaction's name, resolved on the server by the panel (T-1308): the
 * catalogues never reach a client bundle (T-1040).
 */
export type PanelReactionLabels = Record<PanelReaction, Message>;

/** The glyph beside each label. Decoration only: the label is what is read out. */
const GLYPHS: Record<PanelReaction, string> = {
  agree: '👍',
  disagree: '👎',
  laugh: '😄',
  surprise: '😮',
  sad: '😔',
  celebrate: '🎉',
};

function ReactionButton({
  locale,
  fixtureId,
  postId,
  reaction,
  count,
  mine,
  label,
  yours,
}: {
  locale: string;
  fixtureId: string;
  postId: string;
  reaction: PanelReaction;
  count: number;
  mine: boolean;
  label: Message;
  /** "yours", in the reader's language, for the spoken label. */
  yours: string;
}) {
  const [state, formAction, pending] = useActionState(
    setPanelReactionAction.bind(null, locale, fixtureId, postId, reaction, !mine),
    null,
  );

  return (
    <form action={formAction}>
      <Button
        type="submit"
        size="xs"
        pending={pending}
        // The label carries the state, because a coloured border does not reach
        // a screen reader and neither does a bold count.
        aria-pressed={mine}
        selected={mine}
        aria-label={`${label.text}${count > 0 ? `, ${formatNumber(locale, count)}` : ''}${mine ? `, ${yours}` : ''}`}
        data-testid={`panel-react-${postId}-${reaction}`}
      >
        <span aria-hidden="true">{GLYPHS[reaction]}</span> <MessageText message={label} />
        {count > 0 && <span className="ms-1 tabular-nums">{formatNumber(locale, count)}</span>}
      </Button>
      {state !== null && !state.ok && (
        <FormStatus ok={false} size="xs">
          {state.message}
        </FormStatus>
      )}
    </form>
  );
}

export function PanelReactions({
  locale,
  fixtureId,
  postId,
  tallies,
  mine,
  signedIn,
  labels,
  yours,
}: {
  locale: string;
  fixtureId: string;
  postId: string;
  labels: PanelReactionLabels;
  yours: string;
  tallies: PanelReactionTally[];
  /** Which of the six this viewer has left on this post. Empty for a guest. */
  mine: PanelReaction[];
  signedIn: boolean;
}) {
  const counts = new Map(tallies.map((t) => [t.reaction, t.count]));

  if (!signedIn) {
    // Read-only for a guest: the counts are part of the public document, and
    // hiding them until somebody signs in would make the numbers appear to
    // change when they did.
    const present = PANEL_REACTIONS.filter((reaction) => (counts.get(reaction) ?? 0) > 0);
    if (present.length === 0) return null;
    return (
      <p className="flex flex-wrap gap-2 text-xs text-muted" data-testid={`panel-tally-${postId}`}>
        {present.map((reaction) => (
          <span key={reaction}>
            <span aria-hidden="true">{GLYPHS[reaction]}</span>{' '}
            <MessageText message={labels[reaction]} />{' '}
            <span className="tabular-nums">{formatNumber(locale, counts.get(reaction) ?? 0)}</span>
          </span>
        ))}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-1" data-testid={`panel-reactions-${postId}`}>
      {PANEL_REACTIONS.map((reaction) => (
        <ReactionButton
          key={reaction}
          locale={locale}
          fixtureId={fixtureId}
          postId={postId}
          reaction={reaction}
          count={counts.get(reaction) ?? 0}
          mine={mine.includes(reaction)}
          label={labels[reaction]}
          yours={yours}
        />
      ))}
    </div>
  );
}

/**
 * Following the author of a post.
 *
 * Shown to any signed-in member who is not the author. **No approval is asked
 * for and none should be**: following a contributor is what a reader of a panel
 * does next, and gating it would be a second, quieter approval.
 */
export function FollowButton({
  locale,
  fixtureId,
  username,
  following,
  labels,
}: {
  locale: string;
  fixtureId: string;
  username: string;
  following: boolean;
  /** Resolved on the server by the panel (T-1308). */
  labels: { follow: ReactNode; following: ReactNode; working: ReactNode };
}) {
  const [state, formAction, pending] = useActionState(
    setFollowAction.bind(null, locale, fixtureId, username, !following),
    null,
  );

  return (
    <form action={formAction} className="inline">
      <Button
        type="submit"
        size="xs"
        pending={pending}
        pendingLabel={labels.working}
        aria-pressed={following}
        data-testid={`panel-follow-${username}`}
      >
        {following ? labels.following : labels.follow}
      </Button>
      {state !== null && !state.ok && (
        <FormStatus ok={false} as="span" size="xs" className="ms-2">
          {state.message}
        </FormStatus>
      )}
    </form>
  );
}
