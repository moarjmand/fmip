import Link from 'next/link';
import {
  isDeletedMember,
  type ConversationSummary,
  type FriendPrediction,
  type PanelLatest,
  type PredictionOutcome,
  type RatingTier,
  type ScoreCard,
} from '@fmip/contracts';
import { MemberName } from '@/components/member-name';
import { conversationTitle } from '@/lib/conversation-title';
import { formatKickoff } from '@/lib/scores';
import { memberName } from '@/lib/member-name';

/**
 * The homepage's member sections and today's panels (blueprint 2.3, T-942,
 * D-115). Server components over answers the page fetched once per section.
 *
 * **Three products, three sections.** A friend's call is a member's own
 * prediction and is labelled so; it never sits beside, averages with or
 * borrows a label from the model's forecast or the community consensus above
 * it (rule 6). A panel post is a contributor's opinion, signed with their
 * standing.
 *
 * **A section with nothing in it says so once**, and one that could not be
 * loaded says that instead (rule 3). The page renders the member sections for
 * a member only; a guest is not told they are empty.
 */

const OUTCOME: Record<PredictionOutcome, (p: FriendPrediction) => string> = {
  home: (p) => `${p.fixture.home.short_name ?? p.fixture.home.name} to win`,
  draw: () => 'a draw',
  away: (p) => `${p.fixture.away.short_name ?? p.fixture.away.name} to win`,
};

const TIER_LABEL: Record<RatingTier, string> = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
  elite: 'Elite',
};

/** The stored settlement, repeated as it stands (D-063); never recomputed here. */
function verdict(p: FriendPrediction): string | null {
  const s = p.settlement;
  if (s === null) return null;
  if (s.status === 'void') return 'void';
  return s.outcome_correct === true ? 'right' : 'wrong';
}

const excerpt = (text: string, max = 140): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

export function FriendPredictionsSection({
  locale,
  timeZone,
  result,
}: {
  locale: string;
  timeZone: string;
  /** `null` when the request failed. */
  result: FriendPrediction[] | null;
}) {
  return (
    <section className="flex flex-col gap-2" data-testid="home-friend-predictions">
      <h2 className="text-lg font-semibold">Your friends&rsquo; predictions</h2>
      {result === null ? (
        <p className="text-sm text-muted" data-testid="home-friend-predictions-unreachable">
          Your friends&rsquo; predictions could not be loaded.
        </p>
      ) : result.length === 0 ? (
        <p className="text-sm text-muted" data-testid="home-friend-predictions-empty">
          No predictions from your friends in the last seven days that you can see.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-1">
            {result.map((p) => {
              const said = verdict(p);
              return (
                <li
                  key={`${p.username}:${p.fixture.id}`}
                  className="flex flex-wrap items-baseline gap-x-2 text-sm"
                  data-testid="home-friend-prediction"
                >
                  <MemberName locale={locale} member={p} link className="underline" />
                  <span>
                    called {OUTCOME[p.version.outcome](p)}
                    {p.version.score !== null &&
                      ` (${p.version.score.home}–${p.version.score.away})`}
                  </span>
                  <Link href={`/${locale}/match/${p.fixture.id}`} className="underline">
                    {p.fixture.home.name} v {p.fixture.away.name}
                  </Link>
                  <span className="text-xs text-muted">
                    {formatKickoff(locale, p.fixture.kickoff_at, timeZone)}
                    {said !== null && ` · ${said}`}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted">
            Your friends&rsquo; own calls, shown as each of them lets you see their history. Not the
            model&rsquo;s forecast, and not the community&rsquo;s.
          </p>
        </>
      )}
    </section>
  );
}

export function GroupDiscussionsSection({
  locale,
  viewer,
  result,
}: {
  locale: string;
  viewer: string;
  result: ConversationSummary[] | null;
}) {
  return (
    <section className="flex flex-col gap-2" data-testid="home-group-discussions">
      <h2 className="text-lg font-semibold">In your groups</h2>
      {result === null ? (
        <p className="text-sm text-muted" data-testid="home-group-discussions-unreachable">
          Your groups&rsquo; discussions could not be loaded.
        </p>
      ) : result.length === 0 ? (
        <p className="text-sm text-muted" data-testid="home-group-discussions-empty">
          Nothing has been said in your groups in the last two days.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {result.map((conversation) => {
            const last = conversation.last_message;
            return (
              <li
                key={conversation.id}
                className="flex flex-col text-sm"
                data-testid="home-group-discussion"
              >
                <Link
                  href={`/${locale}/messages/${conversation.id}`}
                  className="font-medium underline"
                >
                  {conversationTitle(conversation, viewer, locale)}
                </Link>
                <span className="text-muted">
                  {last === null
                    ? 'Nothing said yet.'
                    : last.removed !== null
                      ? 'A message was removed.'
                      : `${memberName(locale, { username: last.author })}: ${excerpt(
                          last.body ?? 'shared a football card.',
                        )}`}
                  {conversation.unread > 0 && ` · ${conversation.unread} unread`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function PanelsSection({
  locale,
  panels,
  cards,
}: {
  locale: string;
  /** `null` when the request failed. Already chosen by `homePanels`. */
  panels: PanelLatest[] | null;
  cards: Map<string, ScoreCard>;
}) {
  return (
    <section className="flex flex-col gap-2" data-testid="home-panels">
      <h2 className="text-lg font-semibold">On today&rsquo;s match discussions</h2>
      {panels === null ? (
        <p className="text-sm text-muted" data-testid="home-panels-unreachable">
          Today&rsquo;s match discussions could not be loaded.
        </p>
      ) : panels.length === 0 ? (
        <p className="text-sm text-muted" data-testid="home-panels-empty">
          Nothing has been posted on today&rsquo;s match discussions yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {panels.map((panel) => {
            const card = cards.get(panel.fixture_id);
            return (
              <li key={panel.fixture_id} className="flex flex-col gap-1" data-testid="home-panel">
                <Link href={`/${locale}/match/${panel.fixture_id}`} className="underline">
                  {card === undefined ? 'The match' : `${card.home.name} v ${card.away.name}`}
                </Link>
                <ul className="flex flex-col gap-1 ps-3">
                  {panel.posts.map((post) => (
                    <li key={post.id} className="text-sm">
                      <MemberName locale={locale} member={post.author} className="font-medium" />
                      {/* A deleted author keeps the post and loses the name and the standing (D-094). */}
                      {!isDeletedMember(post.author.username) && (
                        <span className="text-xs text-muted">
                          {' '}
                          (
                          {post.author.tier === null || post.author.rating === null
                            ? 'not rated yet'
                            : `${TIER_LABEL[post.author.tier]} · ${post.author.rating}`}
                          {post.author.approved ? '' : ', formerly approved'})
                        </span>
                      )}
                      : {excerpt(post.body ?? '')}
                    </li>
                  ))}
                </ul>
                {panel.total > panel.posts.length && (
                  <span className="text-xs text-muted">
                    {panel.total} posts in all, on the match page.
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
