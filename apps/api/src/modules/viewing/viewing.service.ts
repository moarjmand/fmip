import { Injectable } from '@nestjs/common';
import type {
  AuthUser,
  Covered,
  Highlight,
  HighlightCompetition,
  HighlightListItem,
  HighlightsResponse,
  MatchViewing,
  ViewingOption,
  ViewingTerritory,
} from '@fmip/contracts';
import { HIGHLIGHTS_PAGE_SIZE, TERRITORY_CODE } from '@fmip/contracts';
import { ProfileService } from '../profile/profile.service';
import { offeredEverywhere, offeredIn } from './internal/highlight-feed';
import {
  type CoverageRow,
  type FeedHighlightRow,
  type FeedIndexRow,
  type FeedItemRow,
  type HighlightRow,
  type OptionRow,
  PostgresViewingReadStore,
} from './internal/viewing-read-store';

const NOT_SUPPLIED: Covered<never[]> = {
  coverage: 'not_supplied',
  last_updated_at: null,
  data: null,
};

/**
 * The viewing module for a match (blueprint 11, T-313): where it can be
 * watched and where its highlight is, in one territory, with the truth about
 * what is known.
 *
 * Three answers and three sentences. No territory: both modules are
 * `not_supplied` and the surface asks. A territory with no coverage row for
 * the match's season: `not_supplied` -- nobody has said anything about this
 * country, and "not available here" would be an invention (rule 3). A
 * territory a source covers: the list, possibly empty, and only then does an
 * empty list mean there is nothing to watch.
 */
@Injectable()
export class ViewingService {
  constructor(
    private readonly store: PostgresViewingReadStore,
    private readonly profiles: ProfileService,
  ) {}

  /**
   * The territory to answer for. An explicit one wins -- a guest has nowhere
   * to store a choice and a member may look at another country on purpose;
   * otherwise the member's stored choice; otherwise nobody's. A code that is
   * not a territory is `unknown`, never its nearest neighbour.
   */
  async territory(
    asked: string | undefined,
    viewer: AuthUser | null,
  ): Promise<ViewingTerritory | 'unknown'> {
    if (asked !== undefined && asked.trim() !== '') {
      const code = asked.trim().toUpperCase();
      if (!TERRITORY_CODE.test(code)) return 'unknown';
      const territory = await this.store.territory(code);
      return territory === null ? 'unknown' : { state: 'chosen', territory };
    }
    if (viewer === null) return { state: 'not_chosen' };
    return this.profiles.viewingTerritory(viewer.id);
  }

  /** The module for each id that is a match, in the order asked. */
  async forFixtures(ids: string[], territory: ViewingTerritory): Promise<MatchViewing[]> {
    const fixtures = await this.store.fixtures(ids);
    const bySeason = new Map(fixtures.map((f) => [f.id, f.season_id]));
    const ordered = ids.filter((id) => bySeason.has(id));
    if (territory.state === 'not_chosen') {
      return ordered.map((fixture_id) => ({
        fixture_id,
        territory,
        options: NOT_SUPPLIED,
        highlights: NOT_SUPPLIED,
      }));
    }
    const code = territory.territory.code;
    const seasons = [...new Set(bySeason.values())];
    const [coverage, options, highlights, feed] = await Promise.all([
      this.store.coverage(seasons, code),
      this.store.options(ordered, code),
      this.store.highlights(ordered, code),
      this.store.feedHighlights(ordered),
    ]);
    const declared = new Map(coverage.map((c) => [`${c.season_id}/${c.module}`, c]));
    return ordered.map((fixture_id) => {
      const season = bySeason.get(fixture_id)!;
      return {
        fixture_id,
        territory,
        options: covered(
          declared.get(`${season}/viewing`),
          options.filter((o) => o.fixture_id === fixture_id),
          option,
        ),
        highlights: highlightsModule(
          declared.get(`${season}/highlights`),
          highlights.filter((h) => h.fixture_id === fixture_id),
          feed.filter(
            (h) =>
              h.fixture_id === fixture_id &&
              offeredIn({ allowed: h.allowed_territories, blocked: h.blocked_territories }, code),
          ),
          code,
        ),
      };
    });
  }

  /**
   * The Highlights page (T-1434, D-226, D-260): every feed clip offered to
   * this reader, or every clip with none chosen, newest match first, one page of it with the competitions the
   * filter offers. Which clips is `highlightsPage`'s choice; the details are
   * read for the page's clips only.
   */
  async list(
    territory: ViewingTerritory,
    competition: string | null,
    page: number,
  ): Promise<HighlightsResponse> {
    const chosen = highlightsPage(await this.store.feedIndex(), territory, competition, page);
    const rows = await this.store.feedItems(chosen.ids);
    const restricted = new Set(chosen.restricted);
    const items = rows.map((row) => listItem(row, restricted.has(row.id)));
    const newest = rows.reduce<Date | null>(
      (at, row) => (at === null || row.fetched_at > at ? row.fetched_at : at),
      null,
    );
    return {
      generated_at: new Date().toISOString(),
      territory,
      offered: territory.state === 'chosen' ? 'territory' : 'all',
      competition,
      competitions: chosen.competitions,
      page,
      page_size: HIGHLIGHTS_PAGE_SIZE,
      total: chosen.total,
      items,
      last_updated_at: newest === null ? null : newest.toISOString(),
    };
  }

  /**
   * Every listing for these matches in one territory, whatever the coverage
   * says: the desk's own view (T-1360), never a reader's. By fixture id.
   */
  async listings(fixtureIds: string[], territory: string): Promise<Map<string, ViewingOption[]>> {
    const byFixture = new Map<string, ViewingOption[]>(fixtureIds.map((id) => [id, []]));
    if (fixtureIds.length === 0) return byFixture;
    for (const row of await this.store.options(fixtureIds, territory)) {
      byFixture.get(row.fixture_id)?.push(option(row));
    }
    return byFixture;
  }
}

/**
 * A module under its coverage row. No row: `not_supplied` with no time,
 * because nothing was ever said. A row that says `not_supplied`: the same
 * state, dated, because somebody said so and when matters. Anything else:
 * the rows, dated by the newest of them or by the declaration when there are
 * none -- an empty list is then the answer, not the absence of one.
 */
function covered<Row extends { fetched_at: Date }, Shape>(
  declaration: CoverageRow | undefined,
  rows: Row[],
  shape: (row: Row) => Shape,
): Covered<Shape[]> {
  if (declaration === undefined) return NOT_SUPPLIED;
  if (declaration.state === 'not_supplied') {
    return {
      coverage: 'not_supplied',
      last_updated_at: declaration.updated_at.toISOString(),
      data: null,
    };
  }
  const newest = rows.reduce(
    (at, row) => (row.fetched_at > at ? row.fetched_at : at),
    declaration.updated_at,
  );
  return {
    coverage: declaration.state,
    last_updated_at: newest.toISOString(),
    data: rows.map(shape),
  };
}

/**
 * The highlights module (T-1366, D-184): the desk's page and a licensed
 * feed's clip, never both for one match in one territory. Where the desk
 * covers the season in the territory, its declaration rules as before and
 * the desk's row wins; the feed's clip shows only where the desk entered
 * none. Where nobody declared anything -- or the desk declared it does not
 * cover it -- a clip the feed offers in this territory is `limited`: a source
 * did say something about this match here, and nothing more is claimed;
 * without one the answer is what it was, `not_supplied` (rule 3).
 */
function highlightsModule(
  declaration: CoverageRow | undefined,
  desk: HighlightRow[],
  feed: FeedHighlightRow[],
  territory: string,
): Covered<Highlight[]> {
  if (declaration !== undefined && declaration.state !== 'not_supplied') {
    if (desk.length > 0) return covered(declaration, desk, highlight);
    return covered(declaration, feed, (row) => feedHighlight(row, territory));
  }
  if (feed.length === 0) return covered(declaration, desk, highlight);
  const newest = feed.reduce(
    (at, row) => (row.fetched_at > at ? row.fetched_at : at),
    feed[0]!.fetched_at,
  );
  return {
    coverage: 'limited',
    last_updated_at: newest.toISOString(),
    data: feed.map((row) => feedHighlight(row, territory)),
  };
}

function option(row: OptionRow): ViewingOption {
  return {
    id: row.id,
    broadcaster: {
      id: row.broadcaster_id,
      name: row.broadcaster_name,
      homepage_url: row.broadcaster_homepage_url,
      kind: row.broadcaster_kind,
    },
    access: row.access,
    url: row.url,
    territory: row.territory,
    source: { id: row.source_id, name: row.source_name, rights: row.source_rights },
    from_default: row.default_id !== null,
    last_updated_at: row.fetched_at.toISOString(),
  };
}

function highlight(row: HighlightRow): Highlight {
  return {
    id: row.id,
    kind: row.kind,
    url: row.url,
    embed_url: row.embed_url,
    thumbnail_url: row.thumbnail_url,
    territory: row.territory,
    source: { id: row.source_id, name: row.source_name, rights: row.source_rights },
    publisher: null,
    last_updated_at: row.fetched_at.toISOString(),
  };
}

/** A feed clip in the viewer's territory: the original's page, link only (D-069, D-184). */
function feedHighlight(row: FeedHighlightRow, territory: string): Highlight {
  return {
    id: row.id,
    kind: 'official_page',
    url: row.url,
    embed_url: null,
    thumbnail_url: null,
    territory,
    source: { id: row.source_id, name: row.source_name, rights: row.source_rights },
    publisher: row.publisher,
    last_updated_at: row.fetched_at.toISOString(),
  };
}

/**
 * Which clips a page of the Highlights list holds (T-1434, D-226), pure. With
 * a territory chosen, a clip is listed where its rule offers it there
 * (`offeredIn`, the match page's rule). With none, every clip is listed
 * (T-1488, D-260), and those not offered in every territory
 * (`offeredEverywhere`) come back in `restricted`, to be said so. The
 * filter's competitions are those with a listed clip, whatever competition is
 * picked, by how many then by name; `total` and the page's ids are under the
 * competition picked. The index is already newest first.
 */
export function highlightsPage(
  index: readonly FeedIndexRow[],
  territory: ViewingTerritory,
  competition: string | null,
  page: number,
  size = HIGHLIGHTS_PAGE_SIZE,
): { ids: string[]; restricted: string[]; total: number; competitions: HighlightCompetition[] } {
  const rule = (row: FeedIndexRow) => ({
    allowed: row.allowed_territories,
    blocked: row.blocked_territories,
  });
  const offered =
    territory.state === 'chosen'
      ? index.filter((row) => offeredIn(rule(row), territory.territory.code))
      : index;
  const counts = new Map<string, HighlightCompetition>();
  for (const row of offered) {
    const held = counts.get(row.competition_id) ?? {
      id: row.competition_id,
      name: row.competition_name,
      short_name: row.competition_short_name,
      count: 0,
    };
    held.count += 1;
    counts.set(row.competition_id, held);
  }
  const competitions = [...counts.values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1),
  );
  const filtered =
    competition === null ? offered : offered.filter((row) => row.competition_id === competition);
  const start = (page - 1) * size;
  const shown = filtered.slice(start, start + size);
  return {
    ids: shown.map((row) => row.id),
    restricted:
      territory.state === 'chosen'
        ? []
        : shown.filter((row) => !offeredEverywhere(rule(row))).map((row) => row.id),
    total: filtered.length,
    competitions,
  };
}

/**
 * A listed clip (T-1434): the original's page, link only (D-184). The score is
 * the latest stored, as the team page reads it (the current score, which
 * holds extra time where it was played, else full time), and the shoot-out
 * beside it, never added to it.
 */
function listItem(row: FeedItemRow, restricted: boolean): HighlightListItem {
  const scores = row.scores ?? {};
  const score = scores.current ?? scores.full_time ?? null;
  const team = (id: string, name: string, short_name: string | null) => ({ id, name, short_name });
  return {
    id: row.id,
    url: row.url,
    publisher: row.publisher,
    source: { id: row.source_id, name: row.source_name, rights: row.source_rights },
    fixture: {
      id: row.fixture_id,
      kickoff_at: row.kickoff_at.toISOString(),
      status: row.status,
      competition: {
        id: row.competition_id,
        name: row.competition_name,
        short_name: row.competition_short_name,
      },
      home: team(row.home_id, row.home_name, row.home_short_name),
      away: team(row.away_id, row.away_name, row.away_short_name),
      score: score === null ? null : { home: score.home, away: score.away },
      penalties: scores.penalties
        ? { home: scores.penalties.home, away: scores.penalties.away }
        : null,
    },
    restricted,
    last_updated_at: row.fetched_at.toISOString(),
  };
}
