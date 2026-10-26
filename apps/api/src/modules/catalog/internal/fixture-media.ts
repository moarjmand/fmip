import type { Covered, SeasonFixture, TableContext, TeamFixture } from '@fmip/contracts';
import type { MediaIndex } from '../../media/media.service';

/**
 * Crests and logos on the lists of matches (T-1617): the competition, team
 * and player pages name both sides of every fixture, and each side's crest
 * comes from our own origin, read with the page's other media in one query
 * (`MediaService.index`). A side with no stored crest says `not_supplied`,
 * never a stand-in (rule 3).
 */

/** Every team a list of fixtures names, once each, for the page's one media read. */
export function fixtureTeamIds(fixtures: readonly SeasonFixture[]): string[] {
  return [...new Set(fixtures.flatMap((f) => [f.home.id, f.away.id]))];
}

/** The fixture with both sides' crests. */
export function withCrests<F extends SeasonFixture>(
  fixture: F,
  media: Pick<MediaIndex, 'crest'>,
): F {
  return {
    ...fixture,
    home: { ...fixture.home, crest: media.crest(fixture.home.id) },
    away: { ...fixture.away, crest: media.crest(fixture.away.id) },
  };
}

/** A team page's fixture: both crests and the competition's logo. */
export function withFixtureMedia<F extends TeamFixture>(
  fixture: F,
  media: Pick<MediaIndex, 'crest' | 'logo'>,
): F {
  return {
    ...withCrests(fixture, media),
    competition: { ...fixture.competition, logo: media.logo(fixture.competition.id) },
  };
}

/** The teams on a table context's rows, for the same read. */
export function contextTeamIds(context: Covered<TableContext>): string[] {
  return (context.data?.rows ?? []).map((r) => r.team.id);
}

/** A table context with each row's crest. */
export function withContextCrests(
  context: Covered<TableContext>,
  media: Pick<MediaIndex, 'crest'>,
): Covered<TableContext> {
  if (context.data === null) return context;
  return {
    ...context,
    data: {
      ...context.data,
      rows: context.data.rows.map((r) => ({
        ...r,
        team: { ...r.team, crest: media.crest(r.team.id) },
      })),
    },
  };
}
