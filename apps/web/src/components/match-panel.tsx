'use client';

import { useActionState } from 'react';
import type {
  MatchPanelPage,
  PanelPermission,
  PanelPost,
  PanelReaction,
  RatingTier,
} from '@fmip/contracts';
import { FollowButton, PanelReactions } from '@/components/panel-social';
import { postToPanelAction } from '@/lib/panel-actions';

/**
 * The public match discussion (blueprint 10.2, T-251).
 *
 * **Reading is open, and the reading half renders for everybody including a
 * signed-out visitor.** There is no branch in this file that hides the posts
 * from anybody — the only thing a session changes is whether a compose box
 * appears below them, and what is said in its place when it does not.
 *
 * **A member who cannot post is told why, in words, where the box would be.**
 * A hidden compose box is a gate too, and a worse one: the member would not
 * know there was anything to ask about. Blueprint 10.2's gate is only honest
 * when the refusal is legible.
 */

/** What each refusal says, and what it offers doing about it. */
const REFUSALS: Record<PanelPermission['refusal'] & string, string> = {
  no_panel: 'Nobody has opened a discussion on this match.',
  panel_closed: 'This discussion is closed. It can still be read.',
  not_signed_in: 'Sign in to join the discussion. Reading it needs no account.',
  not_approved: 'Posting here is a granted privilege. Reading is open to everybody.',
  paused: 'Your contributor approval is paused, so you cannot post for now.',
  withdrawn: 'Your contributor approval was withdrawn.',
  restricted: 'A moderation restriction stops you posting here.',
};

const TIER_LABEL: Record<RatingTier, string> = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
  elite: 'Elite',
};

/**
 * The author's standing, beside every post (blueprint 10.2).
 *
 * Not decoration: on a public panel this is the only thing separating an
 * approved contributor's opinion from anybody else's, and it is what makes the
 * reputation system visible where it matters.
 *
 * A contributor whose approval has since ended keeps their post and is shown as
 * **former** rather than as approved. Hiding the post would rewrite the record;
 * still calling them approved would be false (rule 3).
 */
function Standing({
  author,
  follow,
}: {
  author: PanelPost['author'];
  /** The control, when the viewer is a member who is not this author. */
  follow: React.ReactNode;
}) {
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs opacity-80">
      <span className="font-medium opacity-100">{author.display_name}</span>
      <span>@{author.username}</span>
      {author.rating === null || author.tier === null ? (
        // Said, not left blank. "Not rated yet" and "rated badly" are different
        // facts and a missing number reads as neither.
        <span data-testid="panel-author-unrated">Not rated yet</span>
      ) : (
        <span data-testid="panel-author-rating">
          {TIER_LABEL[author.tier]} · {author.rating}
        </span>
      )}
      <span
        data-testid={author.approved ? 'panel-author-approved' : 'panel-author-former'}
        className="rounded border border-current/30 px-1"
      >
        {author.approved ? 'Approved contributor' : 'Formerly approved'}
      </span>
      {follow}
    </span>
  );
}

function Post({
  post,
  locale,
  fixtureId,
  mine,
  me,
  followed,
}: {
  post: PanelPost;
  locale: string;
  fixtureId: string;
  /** The viewer's own reactions on this post. Empty for a guest. */
  mine: PanelReaction[];
  /** The viewer's username, or null for a guest. */
  me: string | null;
  /** Whom the viewer already follows. Empty for a guest. */
  followed: ReadonlySet<string>;
}) {
  if (post.removed !== null) {
    // Kept in place rather than dropped. A panel with holes makes the posts
    // around a removal read as non sequiturs, and "the author thought better of
    // it" is a different fact from "a moderator took it down".
    return (
      <li
        className="rounded border border-current/20 p-3 text-sm opacity-60"
        data-testid="panel-post-removed"
      >
        {post.removed === 'author'
          ? 'The author removed this post.'
          : 'A moderator removed this post.'}
      </li>
    );
  }
  return (
    <li
      className="flex flex-col gap-2 rounded border border-current/20 p-3"
      data-testid="panel-post"
    >
      <Standing
        author={post.author}
        follow={
          // A member, and not the author. Approval is deliberately not asked
          // about: following a contributor is what a reader of a panel does
          // next, and gating it would be a second, quieter approval (T-252).
          me !== null && me !== post.author.username ? (
            <FollowButton
              locale={locale}
              fixtureId={fixtureId}
              username={post.author.username}
              following={followed.has(post.author.username)}
            />
          ) : null
        }
      />
      <p className="whitespace-pre-wrap text-sm">{post.body}</p>
      <PanelReactions
        locale={locale}
        fixtureId={fixtureId}
        postId={post.id}
        tallies={post.reactions}
        mine={mine}
        signedIn={me !== null}
      />
      <time className="text-xs opacity-60" dateTime={post.created_at}>
        {post.created_at}
      </time>
    </li>
  );
}

function Compose({ locale, fixtureId }: { locale: string; fixtureId: string }) {
  const [state, formAction, pending] = useActionState(
    postToPanelAction.bind(null, locale, fixtureId),
    null,
  );

  return (
    <form action={formAction} className="flex flex-col gap-2" data-testid="panel-compose">
      <label className="flex flex-col gap-1 text-sm">
        <span>Add to the discussion</span>
        <textarea
          name="body"
          rows={3}
          maxLength={4000}
          required
          className="rounded border border-current/30 bg-transparent p-2"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded border border-current/30 px-3 py-1 text-sm disabled:opacity-50"
      >
        {pending ? 'Posting…' : 'Post'}
      </button>
      {state !== null && (
        // The refusal the API worded, shown as it came. The server decided; this
        // repeats the sentence rather than composing a second one that could
        // disagree with it.
        <p
          role="status"
          data-testid="panel-compose-result"
          className={state.ok ? 'text-sm' : 'text-sm text-red-800'}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}

export function MatchPanel({
  locale,
  fixtureId,
  page,
  permission,
  reachable,
  me,
  followed,
}: {
  locale: string;
  fixtureId: string;
  page: MatchPanelPage | null;
  /** Null for a viewer whose permission could not be fetched, never for a guest. */
  permission: PanelPermission | null;
  /** False when the panel itself could not be fetched at all. */
  reachable: boolean;
  /** The viewer's username, or null for a guest (T-252). */
  me?: string | null;
  /** Whom the viewer already follows. Empty for a guest. */
  followed?: readonly string[];
}) {
  const viewer = me ?? null;
  const follows = new Set(followed ?? []);
  // Keyed once for the whole page rather than searched per post: a panel of
  // fifty posts should not walk a list fifty times to draw its own buttons.
  const myReactions = new Map(
    (permission?.my_reactions ?? []).map((entry) => [entry.post_id, entry.reactions]),
  );

  return (
    <section className="flex flex-col gap-3" data-testid="match-panel">
      <h2 className="text-lg font-semibold">Match discussion</h2>

      {!reachable || page === null ? (
        // Stated, not vanished: "the discussion could not be fetched" and "nobody
        // has posted" are different facts and a reader must be able to tell them
        // apart (rule 3).
        <p role="alert" data-testid="panel-unreachable">
          The discussion cannot be shown right now.
        </p>
      ) : page.state === 'none' ? (
        // Not the same as an empty discussion, and it must not read like one
        // (T-253). One is a match nobody opened a panel on; the other is one
        // where nobody has spoken yet, and only the second is something a
        // reader can act on.
        <p className="text-sm opacity-70" data-testid="panel-none">
          Nobody has opened a discussion on this match.
        </p>
      ) : page.posts.length === 0 ? (
        <p className="text-sm opacity-70" data-testid="panel-empty">
          {page.state === 'closed'
            ? 'This discussion is closed, and nothing was posted on it.'
            : 'Nobody has posted about this match yet.'}
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {page.posts.map((post) => (
              <Post
                key={post.id}
                post={post}
                locale={locale}
                fixtureId={fixtureId}
                mine={myReactions.get(post.id) ?? []}
                me={viewer}
                followed={follows}
              />
            ))}
          </ul>
          {page.cursor !== null && (
            // The count, so a first page never implies the whole discussion is
            // this short.
            <p className="text-sm opacity-70" data-testid="panel-more">
              Showing {page.posts.length} of {page.total} posts.
            </p>
          )}
        </>
      )}

      {permission !== null && permission.may_post ? (
        <Compose locale={locale} fixtureId={fixtureId} />
      ) : permission !== null && permission.refusal !== null ? (
        <div className="flex flex-col gap-1" data-testid="panel-refusal">
          <p className="text-sm opacity-70">{REFUSALS[permission.refusal]}</p>
          {permission.refusal === 'not_approved' &&
            (permission.shortfalls.length > 0 ? (
              <ul
                className="list-inside list-disc text-sm opacity-70"
                data-testid="panel-shortfalls"
              >
                {permission.shortfalls.map((shortfall) => (
                  <li key={shortfall}>{shortfall}</li>
                ))}
              </ul>
            ) : (
              // Meeting every requirement and waiting for somebody to decide is a
              // real state, and it reads nothing like falling short. Saying "you
              // need a rating of 70" to a member who has 82 would be worse than
              // saying nothing.
              permission.qualifies && (
                <p className="text-sm opacity-70" data-testid="panel-qualifies">
                  You meet every requirement. Approval is a person&rsquo;s decision and has not been
                  made yet.
                </p>
              )
            ))}
        </div>
      ) : null}
    </section>
  );
}
