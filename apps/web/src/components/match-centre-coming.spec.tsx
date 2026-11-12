import type { CoverageState, MatchCentre } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EN } from '@/i18n/messages';
import { matchWords } from '@/lib/words-server';
import { ComingCard, type ComingItem } from './match-centre-cards';
import { MatchCentreView, comingModules } from './match-centre-view';

/**
 * "After kick-off you'll see" (T-1745, D-366; board P2-3): before kick-off
 * the in-play modules with nothing yet -- live timeline, statistics, player
 * statistics, xG, line-ups -- are one card, not an empty card each. The card
 * says what the season's declared coverage says of each: coming, limited,
 * or not supplied in this competition. Once a module has data it is drawn as
 * itself, and from kick-off on there is no card.
 */

const empty = { coverage: 'not_supplied' as const, last_updated_at: null, data: null };
const team = (id: string, name: string) => ({
  id,
  name,
  short_name: null,
  code: null,
  formation: null,
  coach: null,
});
const COVERED: MatchCentre['coverage'] = {
  scores: 'available',
  incidents: 'available',
  lineups: 'available',
  statistics: 'available',
  standings: 'available',
  availability: 'available',
  advanced_statistics: 'available',
};
/** The Persian Gulf Pro League's shape on the board: two limited, the rest not supplied. */
const LIMITED: MatchCentre['coverage'] = {
  ...COVERED,
  incidents: 'limited',
  lineups: 'limited',
  statistics: 'not_supplied',
  availability: 'not_supplied',
  advanced_statistics: 'not_supplied',
};
const centre = (
  fixture: Partial<MatchCentre['fixture']> = {},
  rest: Partial<MatchCentre> = {},
): MatchCentre =>
  ({
    fixture: {
      id: 'f1',
      kickoff_at: '2099-11-06T20:00:00.000Z',
      status: 'scheduled',
      minute: null,
      competition: { id: 'c', name: 'Premier League', short_name: null, country_id: null },
      season: { id: 's', label: '2026/27' },
      stage: null,
      round: null,
      group_name: null,
      leg: null,
      home: team('h', 'Everton'),
      away: team('a', 'Coventry'),
      scores: {
        current: null,
        half_time: null,
        full_time: null,
        extra_time: null,
        penalties: null,
        aggregate: null,
      },
      venue: null,
      is_neutral_venue: false,
      referee: null,
      attendance: null,
      periods: [],
      last_updated_at: '2026-11-06T15:07:00.000Z',
      freshness: null,
      ...fixture,
    },
    timeline: empty,
    statistics: empty,
    lineups: empty,
    availability: empty,
    player_statistics: empty,
    player_expected_goals: { ...empty, source: 'highlightly', unplaced: 0 },
    form: { home: empty, away: empty },
    head_to_head: empty,
    coverage: COVERED,
    ...rest,
  }) as unknown as MatchCentre;
const view = (c: MatchCentre, locale = 'en') =>
  renderToStaticMarkup(
    <MatchCentreView
      words={matchWords(locale)}
      centre={c}
      timeZone="Europe/London"
      locale={locale}
      slots={{ players: <p>PLAYERS</p> }}
    />,
  );
/** Every card on the page, as its markup. */
const cards = (html: string): string[] =>
  [...html.matchAll(/<section[^>]*data-testid="coming"[^]*?<\/section>/g)].map((m) => m[0]);
const chips = (html: string): [string, string][] =>
  [...html.matchAll(/data-coverage-chip="([a-z_]+)" data-module="([a-z_]+)"/g)].map((m) => [
    m[2] ?? '',
    m[1] ?? '',
  ]);
/** The empty module cards the card replaces. */
const MODULES = ['timeline', 'statistics', 'player-statistics', 'player-expected-goals', 'lineups'];

describe('what the card names', () => {
  it('before kick-off, every in-play module with nothing yet, by the season’s coverage', () => {
    expect(comingModules(centre()).map((i) => [i.id, i.tab, i.state])).toEqual([
      ['timeline', 'summary', 'coming'],
      ['statistics', 'stats', 'coming'],
      ['player_statistics', 'stats', 'coming'],
      ['expected_goals', 'stats', 'coming'],
      ['lineups', 'lineups', 'coming'],
    ]);
    expect(comingModules(centre({}, { coverage: LIMITED })).map((i) => [i.id, i.state])).toEqual([
      ['timeline', 'limited'],
      ['statistics', 'not_supplied'],
      ['player_statistics', 'not_supplied'],
      ['expected_goals', 'not_supplied'],
      ['lineups', 'limited'],
    ]);
  });

  it('says a season declared delayed is delayed, never coming', () => {
    const delayed = { ...COVERED, statistics: 'delayed' as CoverageState };
    expect(
      comingModules(centre({}, { coverage: delayed })).find((i) => i.id === 'statistics')?.state,
    ).toBe('delayed');
  });

  it('leaves out a module that already has data: line-ups an hour before kick-off', () => {
    const announced = centre(
      {},
      {
        lineups: {
          coverage: 'available',
          last_updated_at: '2026-11-06T19:00:00.000Z',
          data: { home: [], away: [] } as never,
        },
      },
    );
    expect(comingModules(announced).map((i) => i.id)).not.toContain('lineups');
    expect(comingModules(announced)).toHaveLength(4);
  });

  it('names nothing once there is play, for a match not played, or one awaiting an update', () => {
    for (const status of ['live', 'finished', 'postponed', 'cancelled'] as const) {
      expect(comingModules(centre({ status })), status).toEqual([]);
    }
    expect(comingModules(centre({ freshness: 'awaiting_update' }))).toEqual([]);
  });
});

describe('before kick-off, standard coverage', () => {
  const html = view(centre());

  it('draws one card for the five modules, and none of their empty cards', () => {
    const [summary] = cards(html).filter((c) => c.includes('data-coming="all"'));
    expect(summary).toBeDefined();
    expect(cards(html).filter((c) => c.includes('data-coming="all"'))).toHaveLength(1);
    expect(summary).toContain('After kick-off you&#x27;ll see');
    expect(summary).toContain(EN['matchCentre.fromKickoffWhy']);
    expect(chips(summary ?? '')).toEqual([
      ['timeline', 'coming'],
      ['statistics', 'coming'],
      ['player_statistics', 'coming'],
      ['expected_goals', 'coming'],
      ['lineups', 'coming'],
    ]);
    for (const name of [
      'Live timeline',
      'Statistics',
      'Player statistics',
      'Expected goals by player',
      'Line-ups',
    ]) {
      expect(summary).toContain(name);
    }
    // The line-ups keep their own sentence: they come before kick-off (T-1627).
    expect(summary).toContain(EN['matchCentre.lineupsNotYet']);
    for (const id of MODULES) expect(html).not.toContain(`data-testid="${id}"`);
    expect(html).not.toContain('data-not-yet');
  });

  it('says each state with an icon and a word, never colour alone', () => {
    const [summary] = cards(html).filter((c) => c.includes('data-coming="all"'));
    // The group's name in words behind its glyph.
    expect(summary).toMatch(
      /data-coming-group="coming"><h3[^>]*><svg[^>]*data-icon="delayed"[^]*?Coming at kick-off/,
    );
    // Each chip: the glyph, the module's name, and the state's words for a screen reader.
    const all = [...(summary ?? '').matchAll(/<li[^>]*data-coverage-chip="coming"[^]*?<\/li>/g)];
    expect(all).toHaveLength(5);
    for (const [chip] of all) {
      expect(chip).toContain('<svg');
      expect(chip).toContain('aria-hidden="true"');
      expect(chip).toMatch(/<span class="sr-only"> · [^]*Coming at kick-off/);
    }
    // No hue carries a state: the card uses the quiet text colours only.
    expect(summary).not.toMatch(
      /(text|bg|border)-(accent|brand|model|live|warning|danger|success)/,
    );
  });

  it('on a phone the Stats and Line-ups tabs show the card for their own modules', () => {
    const tabCards = cards(html).filter((c) => c.includes('data-coming="tab"'));
    expect(tabCards).toHaveLength(2);
    // Phone only: from 768px every section is open and the Summary's card says it.
    for (const card of tabCards) expect(card).toMatch(/class="[^"]*md:hidden[^"]*"/);
    const stats = /id="stats"[^>]*data-tab="stats">([^]*?)<\/section>/.exec(html)?.[1] ?? '';
    expect(chips(stats).map(([id]) => id)).toEqual([
      'statistics',
      'player_statistics',
      'expected_goals',
    ]);
    const lineups = /id="lineups"[^>]*data-tab="lineups">([^]*?)<\/section>/.exec(html)?.[1] ?? '';
    expect(chips(lineups).map(([id]) => id)).toEqual(['lineups']);
    expect(lineups).toContain(EN['matchCentre.lineupsNotYet']);
    // The Summary's card is on the Summary tab, and is not a phone-only copy.
    expect(html).toMatch(
      /data-tab="summary"><div id="timeline"[^>]*><section class="(?![^"]*md:hidden)[^"]*" data-testid="coming" data-coming="all"/,
    );
  });

  it('keeps every anchor, the lifted sections directly above the card from 768px', () => {
    // No box on a phone; one block without a gap from 768px: Stats and
    // Line-ups, empty there, stand above the card their jump links land on.
    expect(html).toMatch(
      /<div class="contents md:flex md:flex-col" data-coming-anchors=""><div id="stats"[^>]*data-tab="stats">[^]*?<div id="lineups"[^>]*data-tab="lineups">[^]*?<div class="[^"]*" data-tab="summary"><div id="timeline"/,
    );
    for (const id of ['timeline', 'stats', 'lineups', 'players']) {
      expect(html.split(`id="${id}"`).length - 1, id).toBe(1);
    }
    // The key players keep the Line-ups tab's panel.
    expect(html).toMatch(/data-tab="lineups"><div id="players"[^>]*><p>PLAYERS/);
  });

  it('uses logical properties only (rule 7)', () => {
    for (const card of cards(html)) {
      expect(card).not.toMatch(
        /class="[^"]*(?<![\w-])(left|right|ml|mr|pl|pr|text-left|text-right)-[^"]*"/,
      );
    }
  });
});

describe('before kick-off, limited coverage', () => {
  const html = view(centre({}, { coverage: LIMITED }));
  const [summary] = cards(html).filter((c) => c.includes('data-coming="all"'));

  it('names what is limited and what is not supplied, apart', () => {
    expect(summary).toContain('After kick-off you&#x27;ll see');
    expect(summary).toMatch(
      /data-coming-group="limited"><h3[^>]*><svg[^>]*data-icon="limited"[^]*?Coming, with limited coverage/,
    );
    expect(summary).toContain(EN['matchCentre.coming.limitedWhy']);
    expect(summary).toMatch(
      /data-coming-group="not_supplied"><h3[^>]*><svg[^>]*data-icon="not_supplied"[^]*?Not supplied in this competition/,
    );
    expect(summary).toContain(EN['matchCentre.coming.notSuppliedWhy']);
    expect(summary).not.toContain('data-coming-group="coming"');
    expect(chips(summary ?? '')).toEqual([
      ['timeline', 'limited'],
      ['lineups', 'limited'],
      ['statistics', 'not_supplied'],
      ['player_statistics', 'not_supplied'],
      ['expected_goals', 'not_supplied'],
    ]);
    // What will not come sits on a plain edge, what will on a dashed one.
    expect(summary).toMatch(
      /class="[^"]*border-default text-muted[^"]*" data-coverage-chip="not_supplied"/,
    );
    expect(summary).toMatch(/class="[^"]*border-dashed[^"]*" data-coverage-chip="limited"/);
  });

  it('the limited sentence says what limited means: part of it, so some can be missing', () => {
    // `limited` in the coverage contract: the module carries data with some
    // of it missing, not none (packages/contracts/src/coverage.ts).
    expect(EN['matchCentre.coming.limitedWhy']).toBe(
      'Limited: our source supplies only part of this in this competition, so some of it can be missing for this match.',
    );
  });

  it('a tab with nothing to come says so once, under that name', () => {
    const stats = /id="stats"[^>]*data-tab="stats">([^]*?)<\/section>/.exec(html)?.[1] ?? '';
    expect(stats).toContain('data-expected="false"');
    expect(stats).toContain('Not supplied in this competition');
    expect(stats).not.toContain('After kick-off you');
    expect(stats).not.toContain(EN['matchCentre.fromKickoffWhy']);
    // Said once: the title is the group's name, so the group has no second label.
    expect(stats).not.toContain('<h3');
    expect(chips(stats)).toHaveLength(3);
    expect(stats).toContain(EN['matchCentre.coming.notSuppliedWhy']);
  });

  it('promises no line-up sentence for a competition that does not supply line-ups', () => {
    const none = view(centre({}, { coverage: { ...LIMITED, lineups: 'not_supplied' } }));
    expect(none).not.toContain(EN['matchCentre.lineupsNotYet']);
  });
});

describe('once data exists, the real modules', () => {
  it('draws announced line-ups as themselves before kick-off, the card naming the rest', () => {
    const html = view(
      centre(
        {},
        {
          lineups: {
            coverage: 'available',
            last_updated_at: '2026-11-06T19:00:00.000Z',
            data: { home: [], away: [] } as never,
          },
        },
      ),
    );
    expect(html).toContain('data-testid="lineups"');
    const [summary] = cards(html).filter((c) => c.includes('data-coming="all"'));
    expect(chips(summary ?? '').map(([id]) => id)).toEqual([
      'timeline',
      'statistics',
      'player_statistics',
      'expected_goals',
    ]);
    expect(summary).not.toContain(EN['matchCentre.lineupsNotYet']);
    // Line-ups are in their own tab's panel again, not lifted.
    expect(html).toMatch(/data-tab="lineups"><div id="lineups"/);
    expect(cards(html).filter((c) => c.includes('data-coming="tab"'))).toHaveLength(1);
  });

  it('live: no card; a module with nothing says "Not in yet"', () => {
    const html = view(
      centre(
        {
          status: 'live',
          minute: 11,
          scores: {
            current: { home: 0, away: 0 },
            half_time: null,
            full_time: null,
            extra_time: null,
            penalties: null,
            aggregate: null,
          },
        },
        { timeline: { coverage: 'available', last_updated_at: null, data: [] } },
      ),
    );
    expect(html).not.toContain('data-testid="coming"');
    expect(html).not.toContain('data-coming-anchors');
    for (const id of MODULES) expect(html).toContain(`data-testid="${id}"`);
    expect(html).toContain('data-testid="not-in-yet"');
  });

  it('finished: no card; every module with its own coverage state', () => {
    const html = view(centre({ status: 'finished' }));
    expect(html).not.toContain('data-testid="coming"');
    for (const id of MODULES) expect(html).toContain(`data-testid="${id}"`);
    expect(html).toContain('data-coverage-badge="not_supplied"');
  });

  it('postponed: no card; each module says the match was not played', () => {
    const html = view(centre({ status: 'postponed' }));
    expect(html).not.toContain('data-testid="coming"');
    expect(html.split('data-not-yet="unplayed"').length - 1).toBe(5);
  });

  it('awaiting an update long after kick-off: no card, nothing promised', () => {
    const html = view(centre({ freshness: 'awaiting_update' }));
    expect(html).not.toContain('data-testid="coming"');
    expect(html).not.toContain('data-not-yet');
    for (const id of MODULES) expect(html).toContain(`data-testid="${id}"`);
  });
});

describe('the card alone', () => {
  const items: ComingItem[] = [
    { id: 'timeline', title: 'matchCentre.timeline', tab: 'summary', state: 'coming' },
    { id: 'statistics', title: 'matchCentre.statistics', tab: 'stats', state: 'delayed' },
  ];

  it('draws nothing with nothing to name', () => {
    expect(renderToStaticMarkup(<ComingCard items={[]} words={matchWords('en')} />)).toBe('');
  });

  it('names a delayed module under the coverage word, with its sentence', () => {
    const html = renderToStaticMarkup(<ComingCard items={items} words={matchWords('en')} />);
    expect(html).toMatch(/data-coming-group="delayed">[^]*?Data delayed|data delayed/);
    expect(html).toContain(EN['matchCentre.moduleDelayed']);
  });

  it('is Persian on /fa, nothing left in English', () => {
    const html = view(centre({}, { coverage: LIMITED }), 'fa');
    const [summary] = cards(html).filter((c) => c.includes('data-coming="all"'));
    expect(summary).toContain('پس از شروع بازی می‌بینید');
    expect(summary).toContain('می‌آید، با پوشش ناقص');
    expect(summary).toContain('در این رقابت ارائه نمی‌شود');
    expect(summary).not.toContain('data-translation="untranslated"');
  });
});
