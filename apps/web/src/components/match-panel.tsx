import {
  isDeletedMember,
  type MatchPanelPage,
  type PanelLinkedPrediction,
  type PanelPermission,
  type PanelPost,
  type PanelReaction,
  type RatingTier,
} from '@fmip/contracts';
import { FollowButton, PanelReactions } from '@/components/panel-social';
import { postToPanelAction } from '@/lib/panel-actions';
import { linkCard, type LinkChoiceGroup } from '@/lib/panel-link';
import { CommunityAction } from '@/components/community-action';
import { Said } from '@/components/community-text';
import { Translated } from '@/components/translated';
import { formatDateTime, formatNumber } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { type MessageKey, resolveMessages, t } from '@/i18n/messages';
import { Card, Notice, Select, TextArea } from '@/components/ui';

/*
 * A server component since T-1308: the words are chosen from the catalogue
 * here, and the few client pieces (the compose form, the reactions, the
 * follow control) are handed them already resolved (T-1040).
 */

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
const REFUSALS: Record<PanelPermission['refusal'] & string, MessageKey> = {
  no_panel: 'panel.none',
  panel_closed: 'panel.refusal.closed',
  not_signed_in: 'panel.refusal.signIn',
  not_approved: 'panel.refusal.notApproved',
  paused: 'panel.refusal.paused',
  withdrawn: 'panel.refusal.withdrawn',
  restricted: 'panel.refusal.restricted',
};

const TIER_LABEL: Record<RatingTier, MessageKey> = {
  bronze: 'panel.tier.bronze',
  silver: 'panel.tier.silver',
  gold: 'panel.tier.gold',
  platinum: 'panel.tier.platinum',
  elite: 'panel.tier.elite',
};

/** What each link group offers, named in the reader's language (T-1030, T-1308). */
const LINK_GROUP: Record<LinkChoiceGroup['kind'], MessageKey> = {
  incidents: 'panel.compose.group.incidents',
  players: 'panel.compose.group.players',
  statistics: 'panel.compose.group.statistics',
  prediction: 'panel.compose.group.prediction',
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
  locale,
  author,
  follow,
  deletedMemberLabel,
}: {
  locale: string;
  author: PanelPost['author'];
  /** The control, when the viewer is a member who is not this author. */
  follow: React.ReactNode;
  deletedMemberLabel: string;
}) {
  if (isDeletedMember(author.username)) {
    // The post stays; the name, the standing and the follow control do not
    // (T-812, D-094). A rating beside "a deleted member" would still be theirs.
    return (
      <span className="text-xs text-muted" data-testid="panel-author-deleted">
        <span className="font-medium text-fg">{deletedMemberLabel}</span>
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <span className="font-medium text-fg">{author.display_name}</span>
      <span>@{author.username}</span>
      {author.rating === null || author.tier === null ? (
        // Said, not left blank. "Not rated yet" and "rated badly" are different
        // facts and a missing number reads as neither.
        <span data-testid="panel-author-unrated">
          <Translated locale={locale} message="panel.unrated" />
        </span>
      ) : (
        <span data-testid="panel-author-rating">
          <Translated locale={locale} message={TIER_LABEL[author.tier]} /> ·{' '}
          {formatNumber(locale, author.rating)}
        </span>
      )}
      <span
        data-testid={author.approved ? 'panel-author-approved' : 'panel-author-former'}
        className="rounded border border-default px-1"
      >
        <Translated
          locale={locale}
          message={author.approved ? 'panel.approved' : 'panel.formerlyApproved'}
        />
      </span>
      {follow}
    </span>
  );
}

/**
 * The one thing of this match a post links to (T-1030, D-136), beside the
 * post. What was linked and has since changed or gone says so in a note; the
 * old value is never shown as current (rule 4). A prediction card is labelled
 * as the member's own call (rule 6).
 */
function LinkCard({
  locale,
  post,
  names,
  revealed,
  deletedMemberLabel,
}: {
  locale: string;
  post: PanelPost;
  names: { home: string; away: string };
  revealed: PanelLinkedPrediction | null;
  deletedMemberLabel: string;
}) {
  // `?? null`: a panel served by an API older than T-1030 carries no field.
  const link = post.link ?? null;
  if (link === null) return null;
  const author = isDeletedMember(post.author.username)
    ? deletedMemberLabel
    : post.author.display_name;
  const card = linkCard(link, author, names, revealed, locale);
  return (
    <aside
      className="flex flex-col gap-1 rounded border border-default p-2 text-sm"
      data-testid={`panel-link-${link.kind}`}
    >
      <span className="text-xs font-medium text-muted">{card.heading}</span>
      {card.lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
      {card.note !== null && (
        <span className="text-xs text-muted" data-testid="panel-link-note">
          {card.note}
        </span>
      )}
    </aside>
  );
}

function Post({
  post,
  locale,
  fixtureId,
  timeZone,
  mine,
  me,
  followed,
  deletedMemberLabel,
  names,
  revealed,
}: {
  post: PanelPost;
  timeZone: string;
  names: { home: string; away: string };
  revealed: PanelLinkedPrediction | null;
  deletedMemberLabel: string;
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
        className="rounded border border-default p-3 text-sm text-muted"
        data-testid="panel-post-removed"
      >
        <Translated
          locale={locale}
          message={post.removed === 'author' ? 'panel.removedByAuthor' : 'panel.removedByModerator'}
        />
      </li>
    );
  }
  return (
    <Card as="li" padding="sm" data-testid="panel-post">
      <Standing
        locale={locale}
        author={post.author}
        deletedMemberLabel={deletedMemberLabel}
        follow={
          // A member, and not the author. Approval is deliberately not asked
          // about: following a contributor is what a reader of a panel does
          // next, and gating it would be a second, quieter approval (T-252).
          me !== null && me !== post.author.username && !isDeletedMember(post.author.username) ? (
            <FollowButton
              locale={locale}
              fixtureId={fixtureId}
              username={post.author.username}
              following={followed.has(post.author.username)}
              labels={{
                follow: <Translated locale={locale} message="panel.follow" />,
                following: <Translated locale={locale} message="panel.following" />,
                working: <Translated locale={locale} message="panel.working" />,
              }}
            />
          ) : null
        }
      />
      <p className="whitespace-pre-wrap text-sm">{post.body}</p>
      <LinkCard
        locale={locale}
        post={post}
        names={names}
        revealed={revealed}
        deletedMemberLabel={deletedMemberLabel}
      />
      <PanelReactions
        locale={locale}
        fixtureId={fixtureId}
        postId={post.id}
        tallies={post.reactions}
        mine={mine}
        signedIn={me !== null}
        labels={reactionLabels(locale)}
        yours={t(here(locale), 'panel.reaction.yours')}
      />
      <time className="text-xs text-muted" dateTime={post.created_at}>
        {formatDateTime(locale, post.created_at, timeZone)}
        {timeZone === 'UTC' ? ' UTC' : ''}
      </time>
    </Card>
  );
}

function here(locale: string) {
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}

/** The six reactions' names, resolved here for the client buttons. */
function reactionLabels(locale: string) {
  const m = resolveMessages(here(locale), [
    'panel.reaction.agree',
    'panel.reaction.disagree',
    'panel.reaction.laugh',
    'panel.reaction.surprise',
    'panel.reaction.sad',
    'panel.reaction.celebrate',
  ]);
  return {
    agree: m['panel.reaction.agree'],
    disagree: m['panel.reaction.disagree'],
    laugh: m['panel.reaction.laugh'],
    surprise: m['panel.reaction.surprise'],
    sad: m['panel.reaction.sad'],
    celebrate: m['panel.reaction.celebrate'],
  };
}

/**
 * The compose form. The refusal the API worded is shown as it came: the
 * server decided, and this repeats the sentence rather than composing a
 * second one that could disagree with it.
 */
function Compose({
  locale,
  fixtureId,
  choices,
}: {
  locale: string;
  fixtureId: string;
  choices: LinkChoiceGroup[];
}) {
  const at = here(locale);
  return (
    <CommunityAction
      action={postToPanelAction.bind(null, locale, fixtureId)}
      submit={<Translated locale={locale} message="panel.compose.post" />}
      working={<Translated locale={locale} message="panel.compose.posting" />}
      formClassName="flex flex-col gap-2"
      formTestId="panel-compose"
      testId="panel-compose-submit"
      resultTestId="panel-compose-result"
    >
      <TextArea
        label={<Translated locale={locale} message="panel.compose.label" />}
        name="body"
        rows={3}
        maxLength={4000}
        required
      />
      {choices.length > 0 && (
        // One link at most, to something of this match (T-1030). The options
        // come from what the match centre already carries. An <option> holds
        // text, not markup, so the words come as text.
        <Select
          label={<Translated locale={locale} message="panel.compose.link" />}
          name="link"
          defaultValue=""
          data-testid="panel-compose-link"
        >
          <option value="">{t(at, 'panel.compose.noLink')}</option>
          {choices.map((group) => (
            <optgroup key={group.kind} label={t(at, LINK_GROUP[group.kind])}>
              {group.choices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.value === 'prediction'
                    ? t(at, 'panel.compose.myPrediction')
                    : choice.label}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      )}
    </CommunityAction>
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
  deletedMemberLabel,
  linkChoices,
  names,
  timeZone,
}: {
  locale: string;
  fixtureId: string;
  /** The reader's zone, for when each post was written; UTC when the page has none. */
  timeZone?: string;
  page: MatchPanelPage | null;
  /** What a post may link to (T-1030). Empty offers no link control. */
  linkChoices?: LinkChoiceGroup[];
  /** The two sides' names, for the link cards. */
  names?: { home: string; away: string };
  /** "A deleted member", resolved from the catalogue by the page (T-812). */
  deletedMemberLabel: string;
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
  // Linked predictions the public document withholds and this viewer may see
  // (T-1030, D-063): the author themselves, or a friend when the setting says so.
  const revealed = new Map(
    (permission?.linked_predictions ?? []).map((entry) => [entry.post_id, entry.prediction]),
  );
  const sides = names ?? {
    home: t(here(locale), 'panel.home'),
    away: t(here(locale), 'panel.away'),
  };
  const zone = timeZone ?? 'UTC';

  return (
    <section className="flex flex-col gap-3" data-testid="match-panel">
      <h2 className="text-lg font-semibold">
        <Translated locale={locale} message="panel.title" />
      </h2>

      {!reachable || page === null ? (
        // Stated, not vanished: "the discussion could not be fetched" and "nobody
        // has posted" are different facts and a reader must be able to tell them
        // apart (rule 3).
        <Notice tone="danger" data-testid="panel-unreachable">
          <Translated locale={locale} message="panel.unreachable" />
        </Notice>
      ) : page.state === 'none' ? (
        // Not the same as an empty discussion, and it must not read like one
        // (T-253). One is a match nobody opened a panel on; the other is one
        // where nobody has spoken yet, and only the second is something a
        // reader can act on.
        <p className="text-sm text-muted" data-testid="panel-none">
          <Translated locale={locale} message="panel.none" />
        </p>
      ) : page.posts.length === 0 ? (
        <p className="text-sm text-muted" data-testid="panel-empty">
          <Translated
            locale={locale}
            message={page.state === 'closed' ? 'panel.emptyClosed' : 'panel.empty'}
          />
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
                timeZone={zone}
                mine={myReactions.get(post.id) ?? []}
                me={viewer}
                followed={follows}
                deletedMemberLabel={deletedMemberLabel}
                names={sides}
                revealed={revealed.get(post.id) ?? null}
              />
            ))}
          </ul>
          {page.cursor !== null && (
            // The count, so a first page never implies the whole discussion is
            // this short.
            <p className="text-sm text-muted" data-testid="panel-more">
              <Said
                locale={locale}
                message="panel.more"
                params={{
                  shown: formatNumber(locale, page.posts.length),
                  total: formatNumber(locale, page.total),
                }}
              />
            </p>
          )}
        </>
      )}

      {permission !== null && permission.may_post ? (
        <Compose locale={locale} fixtureId={fixtureId} choices={linkChoices ?? []} />
      ) : permission !== null && permission.refusal !== null ? (
        <div className="flex flex-col gap-1" data-testid="panel-refusal">
          <p className="text-sm text-muted">
            <Translated locale={locale} message={REFUSALS[permission.refusal]} />
          </p>
          {permission.refusal === 'not_approved' &&
            (permission.shortfalls.length > 0 ? (
              <ul
                className="list-inside list-disc text-sm text-muted"
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
                <p className="text-sm text-muted" data-testid="panel-qualifies">
                  <Translated locale={locale} message="panel.qualifies" />
                </p>
              )
            ))}
        </div>
      ) : null}
    </section>
  );
}
