import { Injectable } from '@nestjs/common';
import {
  PANEL_LATEST_POSTS,
  type MatchPanelPage,
  type PanelAuthor,
  type PanelLatest,
  type PanelLink,
  type PanelLinkRequest,
  type PanelPermission,
  type PanelPost,
  type PanelReactionTally,
  type PanelRefusal,
  type RatingTier,
} from '@fmip/contracts';
import { ProfileService } from '../profile/profile.service';
import { ContributorService } from '../reputation/contributor.service';
import { PanelSocialService } from './panel-social.service';
import { RATING_FORMULA_V1, tierOf } from '../reputation/reputation.service';
import {
  PostgresPanelStore,
  decodeCursor,
  encodeCursor,
  type PanelLinkRow,
  type PanelPostRow,
} from './internal/panel-store';
import { linkOf, predictionOf } from './internal/panel-link';

/**
 * The public match discussion (blueprint 10.2, T-251).
 *
 * **Reading is open; posting is granted.** The two are separate methods and
 * separate shapes, because they have different audiences: `panel` answers
 * anybody including a signed-out reader, and `permissionFor` answers one member
 * about themselves. A single method returning both would have made every public
 * read carry a viewer-specific field.
 *
 * **Nothing here decides whether a post may be written.** The three triggers on
 * `panel_post` do that (T-251). `permissionFor` asks the same questions in order
 * to *explain*, which is a different job: it tells a member what would happen,
 * and the database decides what does. When the two ever disagree the database
 * wins and the member is told the truth a moment late, which is the right way
 * round — the other way is a gate that can be talked past.
 */

const DEFAULT_PAGE = 50;
const MAX_PAGE = 100;
export const MAX_POST_LENGTH = 4000;

/** The database's refusals, and what each one means to the person refused. */
const REFUSALS: Record<string, PanelRefusal> = {
  PL015: 'no_panel',
  PL014: 'not_approved',
  PL004: 'restricted',
  PL005: 'restricted',
};

export interface PostOutcome {
  ok: boolean;
  post?: PanelPost;
  /** Set when `ok` is false. */
  refusal?: PanelRefusal;
  /** Set when the refusal was the hourly ceiling rather than a judgement. */
  tooMany?: boolean;
  /** Set when the link was refused (`PL020`): which kind was not of this match. */
  badLink?: PanelLinkRequest['kind'];
}

function authorOf(row: PanelPostRow): PanelAuthor {
  const rating = row.rating === null ? null : Number(row.rating);
  return {
    username: row.username,
    display_name: row.display_name,
    rating,
    // Null exactly when the rating is. A tier computed from a rating that does
    // not exist would be a judgement about somebody who has never been judged.
    tier: rating === null ? null : (tierOf(rating, RATING_FORMULA_V1) as RatingTier),
    approved: row.approved,
  };
}

function postOf(
  row: PanelPostRow,
  reactions: PanelReactionTally[] = [],
  link: PanelLink | null = null,
): PanelPost {
  return {
    id: row.id,
    author: authorOf(row),
    body: row.body,
    created_at: row.created_at.toISOString(),
    removed: (row.removed_kind as PanelPost['removed']) ?? null,
    // A removed post carries none, and the database has already deleted them
    // (T-252). Passing an empty array here as well is belt and braces on a
    // promise the contract makes out loud.
    reactions: row.removed_kind === null ? reactions : [],
    // The link goes with the words (T-1030); the store returns none for a
    // removed post, and this says it again.
    link: row.removed_kind === null ? link : null,
  };
}

@Injectable()
export class PanelService {
  constructor(
    private readonly store: PostgresPanelStore,
    private readonly contributors: ContributorService,
    private readonly social: PanelSocialService,
    private readonly profiles: ProfileService,
  ) {}

  /**
   * The cards for a set of posts (T-1030), in one query. A linked prediction
   * is shown on this public document only where the author's history is
   * visible to a guest -- asked of the profile boundary exactly as
   * `GET /users/:username/predictions` asks it (D-063), once per author.
   */
  private async cardsFor(postIds: string[]): Promise<Map<string, PanelLink>> {
    const rows = await this.store.links({ postIds });
    const access = await this.publicPredictionAccess(rows);
    const cards = new Map<string, PanelLink>();
    for (const row of rows) {
      const card = linkOf(row, access.get(row.author_username) ?? 'private');
      if (card !== null) cards.set(row.post_id, card);
    }
    return cards;
  }

  private async publicPredictionAccess(
    rows: PanelLinkRow[],
  ): Promise<Map<string, 'visible' | 'friends' | 'private'>> {
    const authors = [
      ...new Set(rows.filter((r) => r.link_kind === 'prediction').map((r) => r.author_username)),
    ];
    const access = new Map<string, 'visible' | 'friends' | 'private'>();
    for (const username of authors) {
      const answer = await this.profiles.predictionHistoryAccess(username, null);
      access.set(
        username,
        answer.kind === 'visible'
          ? 'visible'
          : answer.kind === 'restricted'
            ? answer.visibility
            : 'private',
      );
    }
    return access;
  }

  /**
   * The linked predictions on this match that the public panel withholds and
   * this viewer may see: the same rule, asked with the viewer (D-063).
   */
  private async linkedPredictionsFor(
    viewerId: string,
    fixtureId: string,
  ): Promise<PanelPermission['linked_predictions']> {
    const rows = (await this.store.links({ fixtureId })).filter(
      (row) => row.link_kind === 'prediction',
    );
    if (rows.length === 0) return [];
    const guest = await this.publicPredictionAccess(rows);
    const withheld = rows.filter((row) => guest.get(row.author_username) !== 'visible');
    if (withheld.length === 0) return [];
    const audience = await this.profiles.predictionHistoryAudience(
      [...new Set(withheld.map((row) => row.author_id))],
      viewerId,
    );
    return withheld.flatMap((row) => {
      const prediction = audience.has(row.author_id) ? predictionOf(row) : null;
      return prediction === null ? [] : [{ post_id: row.post_id, prediction }];
    });
  }

  /** Null when there is no such fixture — an unknown match is not an empty panel. */
  async panel(fixtureId: string, cursor?: string, limit?: number): Promise<MatchPanelPage | null> {
    if (!(await this.store.fixtureExists(fixtureId))) return null;
    const size = Math.min(Math.max(limit ?? DEFAULT_PAGE, 1), MAX_PAGE);
    // A cursor this server did not write is treated as no cursor rather than as
    // a 400: a stale or mangled link should show the panel from the start, not
    // an error page about pagination.
    const state = await this.store.panelState(fixtureId);
    const { rows, total } = await this.store.page(fixtureId, decodeCursor(cursor), size);
    // One query for the whole page. One per post would cost fifty round trips
    // to draw the cheapest thing on the screen.
    const reactions = await this.social.talliesFor(rows.map((row) => row.id));
    const cards = await this.cardsFor(rows.map((row) => row.id));
    const last = rows.at(-1);
    return {
      // Said, never inferred. A match nobody opened a discussion on and one
      // where nobody has spoken yet both come back with no posts, and only the
      // second is something a reader can do anything about (rule 3, T-253).
      state,
      posts: rows.map((row) => postOf(row, reactions.get(row.id) ?? [], cards.get(row.id) ?? null)),
      // Only when the page was full. A cursor on a short page would invite one
      // more request that is certain to be empty.
      cursor:
        rows.length === size && last !== undefined
          ? encodeCursor(last.created_text, last.id)
          : null,
      total,
    };
  }

  /**
   * The newest standing posts on several matches' panels at once (blueprint
   * 2.3, T-942): the homepage's "on today's panels". One entry per fixture
   * that exists, in the order asked; a match with no panel says `none` rather
   * than being dropped (rule 3). Four queries for the whole list.
   */
  async latest(fixtureIds: string[]): Promise<PanelLatest[]> {
    if (fixtureIds.length === 0) return [];
    const { known, states, totals, rows } = await this.store.latest(fixtureIds, PANEL_LATEST_POSTS);
    const reactions = await this.social.talliesFor(rows.map((row) => row.id));
    const cards = await this.cardsFor(rows.map((row) => row.id));
    return fixtureIds
      .filter((id) => known.has(id))
      .map((id) => ({
        fixture_id: id,
        state: states.get(id) ?? 'none',
        posts: rows
          .filter((row) => row.fixture_id === id)
          .map((row) => postOf(row, reactions.get(row.id) ?? [], cards.get(row.id) ?? null)),
        total: totals.get(id) ?? 0,
      }));
  }

  /**
   * What would happen if this member tried to post, and why.
   *
   * The refusals are ordered the way the triggers are, so the reason a member is
   * shown is the reason they would actually hit. An unapproved and restricted
   * member hears that they are not approved, because that is the refusal that
   * outlives the sanction (T-251).
   */
  async permissionFor(
    viewer: { id: string; username: string } | null,
    fixtureId: string,
  ): Promise<PanelPermission> {
    // The viewer's own reactions travel with the permission because this is
    // already the request that depends on who is asking (T-252). Putting them on
    // the panel would have made every public read viewer-specific to save one
    // round trip.
    const mine = await this.social.myReactions(fixtureId, viewer?.id ?? null);
    const linked = viewer === null ? [] : await this.linkedPredictionsFor(viewer.id, fixtureId);
    const none = {
      shortfalls: [],
      qualifies: false,
      my_reactions: mine,
      linked_predictions: linked,
    };

    // First, and before anything about the viewer, because it is the refusal
    // that is true of everybody (T-253). Telling a member they are not approved
    // would send them to read about approval, and none of it would help: there
    // is no discussion here, and there would not be one for them if they were
    // approved tomorrow. The trigger refuses in this order too.
    const state = await this.store.panelState(fixtureId);
    if (state === 'none') return { may_post: false, refusal: 'no_panel', ...none };
    if (state === 'closed') return { may_post: false, refusal: 'panel_closed', ...none };

    if (viewer === null) {
      return { may_post: false, refusal: 'not_signed_in', ...none };
    }
    const status = await this.contributors.statusOf(viewer.id, viewer.username);
    if (status === null) {
      return { may_post: false, refusal: 'not_signed_in', ...none };
    }
    const shortfalls = status.eligibility.shortfalls.map((s) => s.message);
    const qualifies = status.eligibility.qualifies;
    const seen = { shortfalls, qualifies, my_reactions: mine, linked_predictions: linked };

    if (status.grant === null) {
      return { may_post: false, refusal: 'not_approved', ...seen };
    }
    if (status.grant.standing === 'withdrawn') {
      return { may_post: false, refusal: 'withdrawn', ...seen };
    }
    if (status.grant.standing === 'paused') {
      return { may_post: false, refusal: 'paused', ...seen };
    }
    // Approved. A `post` sanction still stops them — and it is asked for by
    // name, through the same `member_sanctioned(user, 'post')` the trigger uses.
    // `eligibility.under_sanction` is the wrong question here: it is true for a
    // contact restriction too, which stops friend requests and nothing else.
    if (await this.store.postSanctioned(viewer.id)) {
      return { may_post: false, refusal: 'restricted', ...seen };
    }
    return { may_post: true, refusal: null, ...seen };
  }

  /**
   * Writes the post, or reports which guard refused it and why.
   *
   * **The database refuses; this asks it a second question to explain.** The
   * approval trigger knows only that there is no live grant (`PL014`) -- from
   * inside `member_may_contribute` a paused grant, a withdrawn one and one that
   * never existed are the same fact. They are not the same fact to the member:
   * two of them have a moderator and a reason behind them and one does not. So a
   * `PL014` refusal is handed to `permissionFor`, which can tell them apart, and
   * the member is told the one that is true of them.
   *
   * The order matters and is the safe one. The write is attempted first and the
   * explanation comes second, so nothing here can admit a post the database
   * would have refused -- the worst this lookup can do is describe a refusal
   * imprecisely, never undo one.
   */
  async post(
    viewer: { id: string; username: string },
    fixtureId: string,
    body: string,
    link: PanelLinkRequest | null = null,
  ): Promise<PostOutcome> {
    try {
      const row = await this.store.write(fixtureId, viewer.id, body, link);
      const cards = await this.cardsFor([row.id]);
      return { ok: true, post: postOf(row, [], cards.get(row.id) ?? null) };
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      // The link guard runs last (T-1030), so a member refused for anything
      // else never reaches it; this one is about the link alone. A statistic
      // naming a side with no participant fails the shape CHECK instead, and
      // means the same thing.
      if (link !== null && (code === 'PL020' || code === '23514')) {
        return { ok: false, badLink: link.kind };
      }
      const refusal = REFUSALS[code];
      if (refusal === undefined) throw error;
      if (code !== 'PL014') return { ok: false, refusal, tooMany: code === 'PL005' };
      const permission = await this.permissionFor(viewer, fixtureId);
      return { ok: false, refusal: permission.refusal ?? refusal };
    }
  }

  /** So a write to an unknown match is a 404 without assembling a page first. */
  fixtureExists(fixtureId: string): Promise<boolean> {
    return this.store.fixtureExists(fixtureId);
  }

  removeOwn(postId: string, authorId: string): Promise<boolean> {
    return this.store.removeOwn(postId, authorId);
  }
}
