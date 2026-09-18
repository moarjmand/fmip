import { Injectable } from '@nestjs/common';
import type {
  AuthUser,
  Covered,
  Highlight,
  MatchViewing,
  ViewingOption,
  ViewingTerritory,
} from '@fmip/contracts';
import { TERRITORY_CODE } from '@fmip/contracts';
import { ProfileService } from '../profile/profile.service';
import {
  type CoverageRow,
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
    const [coverage, options, highlights] = await Promise.all([
      this.store.coverage(seasons, code),
      this.store.options(ordered, code),
      this.store.highlights(ordered, code),
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
        highlights: covered(
          declared.get(`${season}/highlights`),
          highlights.filter((h) => h.fixture_id === fixture_id),
          highlight,
        ),
      };
    });
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
    last_updated_at: row.fetched_at.toISOString(),
  };
}
