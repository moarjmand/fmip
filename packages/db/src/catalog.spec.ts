import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// A namespace import on one line, on purpose: `@ts-expect-error` suppresses the
// line below it, and a named-import list long enough for Prettier to split
// leaves the directive pointing at `import {` while the error lands on the
// module specifier three lines down.
// @ts-expect-error -- a plain script, deliberately not part of the TypeScript build.
import * as catalog from '../scripts/catalog.mjs';

const {
  COMPETITION_KINDS,
  COMPETITION_SCOPES,
  PROVIDERS,
  STAGE_KINDS,
  emptyQueueNote,
  parseAliases,
  parseArgs,
} = catalog;

/**
 * The refusals in `scripts/catalog.mjs` (T-029).
 *
 * This tool writes the rows that decide what the product believes exists, on a
 * server, from a terminal. The database enforces the value sets again
 * (`competition_kind_check`, `competition_scope_check`,
 * `competition_domestic_has_country`); refusing here as well means the message
 * names the flag rather than the constraint.
 */
describe('catalog arguments', () => {
  it('offers exactly the values the schema allows', () => {
    expect(PROVIDERS).toEqual(['api_football', 'football_data_org', 'highlightly']);
    expect(COMPETITION_KINDS).toEqual(['league', 'cup', 'super_cup', 'qualifying', 'friendly']);
    expect(COMPETITION_SCOPES).toEqual(['domestic', 'continental', 'international']);
  });

  it('reads a listing, an adoption and a dry run', () => {
    expect(parseArgs(['--list'])).toMatchObject({
      command: 'list',
      provider: 'api_football',
      limit: 50,
    });
    expect(parseArgs(['--list', '--type', 'team', '--limit', '5'])).toMatchObject({
      type: 'team',
      limit: 5,
    });
    expect(parseArgs(['--adopt-teams'])).toMatchObject({ command: 'adopt-teams', dryRun: false });
    expect(parseArgs(['--adopt-teams', '--dry-run'])).toMatchObject({ dryRun: true });
    // People and grounds are adopted the same way (D-079).
    expect(parseArgs(['--adopt-people', '--by', 'a@b.c'])).toMatchObject({
      command: 'adopt-people',
      by: 'a@b.c',
      dryRun: false,
    });
    expect(parseArgs(['--adopt-venues', '--dry-run'])).toMatchObject({
      command: 'adopt-venues',
      dryRun: true,
    });
    expect(parseArgs(['--adopt-people', '--adopt-teams']).error).toContain('One verb at a time');
  });

  it('insists on one verb, and says which two it was given', () => {
    expect(parseArgs([]).error).toContain('Name one verb');
    const both = parseArgs(['--list', '--adopt-teams']);
    expect(both.error).toContain('One verb at a time');
    expect(both.error).toContain('list');
    expect(both.error).toContain('adopt-teams');
  });

  it('reads a competition, and refuses one the schema would refuse', () => {
    expect(
      parseArgs([
        '--add-competition',
        '--external-id',
        '140',
        '--name',
        'La Liga',
        '--kind',
        'league',
        '--scope',
        'domestic',
        '--country',
        'ES',
      ]),
    ).toMatchObject({ command: 'add-competition', externalId: '140', name: 'La Liga' });

    const badKind = parseArgs([
      '--add-competition',
      '--external-id',
      '1',
      '--name',
      'X',
      '--kind',
      'tournament',
      '--scope',
      'domestic',
      '--country',
      'ES',
    ]);
    expect(badKind.error).toContain('league, cup, super_cup, qualifying, friendly');
  });

  /**
   * The migrations write FIFA's member associations (D-078); this is for a
   * country outside that list, and was once the only way a new server got
   * one at all.
   */
  it('reads a country by its FIFA trigram, with an ISO code only where one exists', () => {
    expect(
      parseArgs(['--add-country', '--code', 'esp', '--iso2', 'es', '--name', 'Spain']),
    ).toMatchObject({ command: 'add-country', code: 'ESP', iso2: 'ES', name: 'Spain' });
    // England plays as England and has no ISO 3166 code of its own.
    expect(parseArgs(['--add-country', '--code', 'ENG', '--name', 'England'])).toMatchObject({
      command: 'add-country',
      code: 'ENG',
      iso2: '',
    });
    expect(parseArgs(['--add-country', '--code', 'ES', '--name', 'Spain']).error).toContain(
      'FIFA trigram',
    );
    expect(parseArgs(['--add-country', '--code', 'ESP']).error).toContain('--name is required');
    expect(
      parseArgs(['--add-country', '--code', 'ENG', '--iso2', 'GBR', '--name', 'England']).error,
    ).toContain('--iso2 is two letters');
  });

  it('asks for a country only where the database will', () => {
    const domestic = ['--add-competition', '--external-id', '1', '--name', 'X', '--kind', 'league'];
    expect(parseArgs([...domestic, '--scope', 'domestic']).error).toContain(
      '--country is required',
    );
    // A continental competition has no country, and the constraint agrees.
    expect(parseArgs([...domestic, '--scope', 'continental'])).toMatchObject({
      command: 'add-competition',
      country: '',
    });
  });

  it('reads a season, and refuses a label or a date it cannot trust', () => {
    const base = ['--add-season', '--competition', '39'];
    expect(
      parseArgs([...base, '--label', '2026/27', '--start', '2026-08-21', '--end', '2027-05-30']),
    ).toMatchObject({ command: 'add-season', label: '2026/27', current: false });
    expect(
      parseArgs([...base, '--label', '2026', '--start', '2026-08-21', '--end', '2027-05-30']),
    ).toMatchObject({ label: '2026' });
    expect(
      parseArgs([...base, '--label', 'this year', '--start', '2026-08-21', '--end', '2027-05-30'])
        .error,
    ).toContain('2026/27');
    expect(
      parseArgs([...base, '--label', '2026/27', '--start', '21 August', '--end', '2027-05-30'])
        .error,
    ).toContain('YYYY-MM-DD');
    // An end before a start is caught here as well as by `season_dates_ordered`.
    expect(
      parseArgs([...base, '--label', '2026/27', '--start', '2027-05-30', '--end', '2026-08-21'])
        .error,
    ).toContain('--end is before --start');
  });

  it('will not map without somewhere to map onto', () => {
    expect(
      parseArgs(['--map', '--type', 'team', '--external-id', '40', '--to', 'abc']),
    ).toMatchObject({ command: 'map', type: 'team', externalId: '40', to: 'abc' });
    expect(parseArgs(['--map', '--type', 'team', '--external-id', '40']).error).toContain(
      '--to is required',
    );
  });

  /**
   * An empty queue is the same sentence for a finished catalogue and for one
   * that does not exist, and those are opposite states: the second fetches
   * nothing at all and will queue nothing to place. A deployment is in it from
   * the moment it is migrated until someone adds a competition.
   */
  it('tells a finished queue from a deployment with nothing to poll', () => {
    const fresh = emptyQueueNote('api_football', 0, 0);
    expect(fresh).toContain('No competition is mapped to api_football');
    expect(fresh).toContain('--add-competition');
    expect(fresh).toContain('--add-season');

    const noSeason = emptyQueueNote('api_football', 3, 0);
    expect(noSeason).toContain('3 competition(s)');
    expect(noSeason).toContain('none has a current season');
    expect(noSeason).toContain('--add-season');
    expect(noSeason).not.toContain('--add-competition');

    const working = emptyQueueNote('api_football', 6, 4);
    expect(working).toContain('4 of 6');
    expect(working).toContain('being polled');
    expect(working).not.toContain('--add-');
  });

  it('refuses a provider the mapping table does not know, and an unknown flag', () => {
    expect(parseArgs(['--list', '--provider', 'opta']).error).toContain(
      '--provider must be one of',
    );
    expect(parseArgs(['--list', '--force']).error).toContain('Unknown option: --force');
    expect(parseArgs(['--list', '--limit']).error).toContain('--limit needs a value');
    expect(parseArgs(['--list', '--limit', 'lots']).error).toContain('whole number');
  });

  it('reads which football-data.co.uk division a competition is in', () => {
    expect(parseArgs(['--set-division', '--competition', '39', '--division', 'e0'])).toMatchObject({
      command: 'set-division',
      competition: '39',
      division: 'E0',
    });
    expect(
      parseArgs(['--set-division', '--competition', '39', '--division', 'EPL']).error,
    ).toContain('football-data.co.uk code');
    expect(parseArgs(['--set-division', '--division', 'E0']).error).toContain('--competition');
  });

  it('reads a stage, with the season defaulting to the current one', () => {
    const stage = ['--add-stage', '--competition', '2', '--name', 'League Stage', '--kind'];
    expect(parseArgs([...stage, 'league', '--order', '5'])).toMatchObject({
      command: 'add-stage',
      competition: '2',
      name: 'League Stage',
      kind: 'league',
      order: 5,
      legs: 1,
      label: null,
    });
    expect(
      parseArgs([...stage, 'knockout', '--order', '7', '--legs', '2', '--label', '2026/27']),
    ).toMatchObject({ legs: 2, label: '2026/27' });
    expect(parseArgs([...stage, 'cup', '--order', '5']).error).toContain('--kind must be one of');
    expect(parseArgs([...stage, 'league', '--order', '0']).error).toContain('--order');
    expect(parseArgs([...stage, 'league', '--order', '5', '--legs', '3']).error).toContain(
      '--legs',
    );
    expect(parseArgs(['--add-stage', '--competition', '2', '--kind', 'league']).error).toContain(
      '--name',
    );
  });

  it('reads a competition’s place on the scores page, and a zero that clears it', () => {
    expect(parseArgs(['--set-order', '--competition', '39', '--order', '2'])).toMatchObject({
      command: 'set-order',
      competition: '39',
      order: 2,
    });
    expect(parseArgs(['--set-order', '--competition', '39', '--order', '0'])).toMatchObject({
      order: null,
    });
    expect(parseArgs(['--set-order', '--competition', '39', '--order', 'top']).error).toContain(
      '--order',
    );
    expect(parseArgs(['--set-order', '--order', '1']).error).toContain('--competition');
  });

  it('knows the same stage kinds the database does', () => {
    // `stage_kind_check`; `@fmip/ingestion`'s `STAGE_KINDS` is the same list.
    expect(STAGE_KINDS).toEqual(['league', 'group', 'knockout', 'playoff', 'qualifying']);
  });
});

/**
 * The committed bridge from the provider's clubs to the training data's names
 * (D-080). One row per club and per name in each division: two clubs sharing a
 * name, or one club under two, would put one club's history under another.
 */
describe('the training alias list', () => {
  const text = readFileSync(
    join(__dirname, '..', 'scripts', 'data', 'training-aliases.csv'),
    'utf8',
  );

  it('parses, covers the eleven leagues, and names every club and every name once per division', () => {
    const parsed = parseAliases(text);
    expect(parsed.error).toBeUndefined();
    const rows = parsed.rows as { teamId: string; division: string; name: string }[];
    // The first five (D-080) and the six Phase 6 added (T-502).
    expect(new Set(rows.map((r) => r.division))).toEqual(
      new Set(['E0', 'SP1', 'D1', 'I1', 'F1', 'E1', 'N1', 'P1', 'T1', 'B1', 'SC0']),
    );
    // `team_alias`'s key: a club has one name per division, and a promoted or
    // relegated club a row in each division it has played in.
    expect(new Set(rows.map((r) => `${r.division}:${r.teamId}`)).size).toBe(rows.length);
    expect(new Set(rows.map((r) => `${r.division}:${r.name}`)).size).toBe(rows.length);
  });

  it('refuses a list it cannot read rather than guessing at it', () => {
    const header = 'provider,provider_team_id,division,training_name';
    expect(parseAliases(['team,name', '1,Arsenal'].join('\n')).error).toContain('header');
    expect(parseAliases([header, 'api_football,x,E0,Arsenal'].join('\n')).error).toContain(
      'line 2',
    );
    expect(parseAliases([header, 'api_football,42,EPL,Arsenal'].join('\n')).error).toContain(
      'division',
    );
  });
});
