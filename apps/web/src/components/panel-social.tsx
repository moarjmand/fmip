'use client';

import { useActionState } from 'react';
import type { PanelReaction, PanelReactionTally } from '@fmip/contracts';
import { PANEL_REACTIONS } from '@fmip/contracts';
import { setFollowAction, setPanelReactionAction } from '@/lib/panel-social-actions';

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

const LABELS: Record<PanelReaction, string> = {
  agree: 'Agree',
  disagree: 'Disagree',
  laugh: 'Laugh',
  surprise: 'Surprise',
  sad: 'Sad',
  celebrate: 'Celebrate',
};

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
}: {
  locale: string;
  fixtureId: string;
  postId: string;
  reaction: PanelReaction;
  count: number;
  mine: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    setPanelReactionAction.bind(null, locale, fixtureId, postId, reaction, !mine),
    null,
  );

  return (
    <form action={formAction}>
      <button
        type="submit"
        disabled={pending}
        // The label carries the state, because a coloured border does not reach
        // a screen reader and neither does a bold count.
        aria-pressed={mine}
        aria-label={`${LABELS[reaction]}${count > 0 ? `, ${count}` : ''}${mine ? ', yours' : ''}`}
        data-testid={`panel-react-${postId}-${reaction}`}
        className={`rounded border px-2 py-0.5 text-xs disabled:opacity-50 ${
          mine ? 'border-current' : 'border-current/30'
        }`}
      >
        <span aria-hidden="true">{GLYPHS[reaction]}</span> {LABELS[reaction]}
        {count > 0 && <span className="ms-1 tabular-nums">{count}</span>}
      </button>
      {state !== null && !state.ok && (
        <p role="status" className="text-xs text-red-800 dark:text-red-300">
          {state.message}
        </p>
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
}: {
  locale: string;
  fixtureId: string;
  postId: string;
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
      <p className="flex flex-wrap gap-2 text-xs opacity-70" data-testid={`panel-tally-${postId}`}>
        {present.map((reaction) => (
          <span key={reaction}>
            <span aria-hidden="true">{GLYPHS[reaction]}</span> {LABELS[reaction]}{' '}
            <span className="tabular-nums">{counts.get(reaction)}</span>
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
}: {
  locale: string;
  fixtureId: string;
  username: string;
  following: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    setFollowAction.bind(null, locale, fixtureId, username, !following),
    null,
  );

  return (
    <form action={formAction} className="inline">
      <button
        type="submit"
        disabled={pending}
        aria-pressed={following}
        data-testid={`panel-follow-${username}`}
        className="rounded border border-current/30 px-2 py-0.5 text-xs disabled:opacity-50"
      >
        {pending ? 'Working…' : following ? 'Following' : 'Follow'}
      </button>
      {state !== null && !state.ok && (
        <span role="status" className="ms-2 text-xs text-red-800 dark:text-red-300">
          {state.message}
        </span>
      )}
    </form>
  );
}
