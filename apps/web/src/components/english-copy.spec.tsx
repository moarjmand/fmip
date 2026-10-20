import type {
  ForecastVersion,
  ForecastVersionsResponse,
  MatchCentre,
  MatchPlayerStats,
} from '@fmip/contracts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { formatVersionStamp } from '@/i18n/format';
import { cardForecast } from '@/lib/score-card-products';
import { forecastBarWords, matchWords } from '@/lib/words-server';
import { ForecastBar } from './forecast-bar';
import { ForecastPanel } from './forecast-panel';
import { MatchCentreView } from './match-centre-view';

/**
 * T-1395 (D-210): the English site's reader-facing copy. Forecast stamps on
 * the page's clock in one format with the zone named, the player statistics
 * table scrolling visibly and reachable by keyboard, one player-name style on
 * a match page, and no "provider" or "feed" in what a reader is shown.
 */

// 23:30 UTC on 11 October is 00:30 on 12 October in the UK (BST).
const LATE = '2026-10-11T23:30:00.000Z';

const version = (n: number, computedAt: string): ForecastVersion => ({
  id: `v${n}`,
  fixture_id: 'f1',
  version_number: n,
  kind: 'early',
  model_version: 'dixon-coles-elo@0.6.0',
  computed_at: computedAt,
  status: 'available',
  probabilities: { home: 0.46, draw: 0.34, away: 0.2 },
  expected_goals: null,
  most_likely_scorelines: null,
  leading_factors: null,
  data_completeness: 'available',
  inputs: null,
  unavailable_reason: null,
  unavailable_detail: null,
});

const forecasts = {
  fixture_id: 'f1',
  coverage: 'available',
  last_updated_at: LATE,
  latest: version(2, LATE),
  versions: [version(1, '2026-10-11T08:00:00.000Z'), version(2, LATE)],
} as ForecastVersionsResponse;

/** The visible text of some markup, tags dropped. */
const text = (html: string) => html.replace(/<[^>]+>/g, '');

describe('forecast stamps on the page’s clock (T-1395)', () => {
  it('formats one way, in the zone it is given', () => {
    expect(formatVersionStamp('en', LATE, 'Europe/London')).toBe('12 Oct, 00:30');
    expect(formatVersionStamp('en', LATE, 'UTC')).toBe('11 Oct, 23:30');
  });

  it('writes the panel’s stamps in UK time on /en, named, and never the UTC date', () => {
    const html = renderToStaticMarkup(
      <ForecastPanel
        forecasts={forecasts}
        evaluations={null}
        home="Arsenal"
        away="Chelsea"
        timeZone="Europe/London"
        locale="en"
      />,
    );
    const words = text(html);
    expect(words).toContain('12 Oct, 00:30 UK time');
    expect(words).not.toContain('2026-10-11');
    expect(words).not.toMatch(/23:30/);
  });

  it('names the zone on the bar, and keeps naming UTC where that is the page’s zone', () => {
    const bar = (timeZone: string, zone?: string) =>
      text(
        renderToStaticMarkup(
          <ForecastBar
            forecast={cardForecast(version(2, LATE))}
            home="Arsenal"
            away="Chelsea"
            locale="en"
            timeZone={timeZone}
            zone={zone}
            words={forecastBarWords('en')}
          />,
        ),
      );
    expect(bar('Europe/London', 'UK time')).toContain('computed 12 Oct, 00:30 UK time');
    expect(bar('UTC')).toContain('computed 11 Oct, 23:30 UTC');
  });
});

const empty = { coverage: 'not_supplied' as const, last_updated_at: null, data: null };
const team = (id: string, name: string) => ({
  id,
  name,
  short_name: null,
  code: null,
  formation: null,
  coach: null,
});
const stats = (id: string, name: string): MatchPlayerStats => ({
  id,
  name,
  side: 'home',
  stats: { minutes: 90, goals: 1 },
});
const centre = (): MatchCentre =>
  ({
    fixture: {
      id: '00000000-0000-4000-8000-000000000901',
      kickoff_at: '2026-10-11T14:00:00.000Z',
      status: 'finished',
      minute: null,
      competition: { id: 'c', name: 'Premier League', short_name: null, country_id: null },
      season: { id: 's', label: '2026/27' },
      stage: null,
      round: null,
      group_name: null,
      leg: null,
      home: team('h', 'Liverpool'),
      away: team('a', 'Manchester City'),
      scores: {
        current: { home: 2, away: 1 },
        half_time: null,
        full_time: { home: 2, away: 1 },
        extra_time: null,
        penalties: null,
        aggregate: null,
      },
      venue: null,
      is_neutral_venue: false,
      referee: null,
      attendance: null,
      periods: [],
      last_updated_at: '2026-10-11T16:00:00.000Z',
      freshness: null,
    },
    timeline: {
      coverage: 'available',
      last_updated_at: '2026-10-11T16:00:00.000Z',
      data: [
        {
          id: 'i1',
          sequence: 1,
          minute: 30,
          added_time: null,
          kind: 'goal',
          side: 'home',
          player: { id: 'p1', name: 'Mohamed Salah' },
          related_player: { id: 'p2', name: 'V. van Dijk' },
          detail: null,
        },
      ],
    },
    statistics: empty,
    lineups: empty,
    availability: empty,
    player_statistics: {
      coverage: 'available',
      last_updated_at: '2026-10-11T16:00:00.000Z',
      data: [stats('p1', 'Mohamed Salah'), stats('p2', 'V. van Dijk')],
    },
    player_expected_goals: { ...empty, source: 'highlightly', unplaced: 0 },
    form: { home: empty, away: empty },
    head_to_head: empty,
    coverage: {
      scores: 'available',
      incidents: 'available',
      lineups: 'not_supplied',
      statistics: 'not_supplied',
      standings: 'not_supplied',
      availability: 'not_supplied',
      advanced_statistics: 'not_supplied',
    },
  }) as unknown as MatchCentre;

const page = (locale: string) =>
  renderToStaticMarkup(
    <MatchCentreView
      words={matchWords(locale)}
      centre={centre()}
      timeZone="Europe/London"
      locale={locale}
    />,
  );

describe('the player statistics table on a phone (T-1395)', () => {
  it('is a named region a keyboard can reach, with the edge cue and a hint', () => {
    const html = page('en');
    const region =
      /<div role="region" aria-label="([^"]*)" tabindex="0" class="([^"]*)" data-testid="player-statistics-scroll">/.exec(
        html,
      );
    expect(region?.[1]).toBe('Liverpool: player statistics, scrolls sideways');
    expect(region?.[2]).toContain('scroll-cue');
    expect(region?.[2]).toContain('overflow-x-auto');
    expect(html).toContain('data-testid="player-statistics-scroll-hint"');
    expect(html).toContain('Scroll sideways to see every column.');
  });

  it('says it in Persian on /fa', () => {
    const html = page('fa');
    expect(html).toContain('آمار بازیکنان، با کشیدن به پهلو');
    expect(html).toContain('برای دیدن همه‌ی ستون‌ها');
  });

  it('draws the edge cue from tokens, the same on both edges', () => {
    const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
    const rule = css.slice(css.indexOf('@utility scroll-cue'));
    const body = rule.slice(0, rule.indexOf('\n}'));
    expect(body).toContain('var(--color-surface)');
    expect(body).toContain('local');
    expect(body).toMatch(/at 0 50%[\s\S]*at 100% 50%/);
  });
});

describe('one player-name style on a match page (T-1395)', () => {
  it("writes a full name in the feed's short style beside the short ones on /en", () => {
    const words = text(page('en'));
    expect(words).toContain('M. Salah');
    expect(words).not.toContain('Mohamed Salah');
    expect(words).toContain('V. van Dijk');
  });

  it('leaves the names as stored on /fa', () => {
    expect(text(page('fa'))).toContain('Mohamed Salah');
  });
});

describe('no provider or feed in what a reader is shown (T-1395)', () => {
  const en = JSON.parse(
    readFileSync(join(__dirname, '..', 'i18n', 'catalogues', 'en.json'), 'utf8'),
  ) as Record<string, string | Record<string, string>>;
  // "Your feed" is the member's own Following feed (T-631), a product word.
  const OWN_FEED = /\b(?:your|the) feed below\b|\byour feed\b|\bfeeds your\b/gi;
  const FORBIDDEN = /\bprovider|\bdata feed\b|\bthe feed\b|\bfeeds?['’]|\bfeeds\b/i;

  it('in any English sentence of the catalogue', () => {
    const offenders = Object.entries(en).filter(([, value]) =>
      (typeof value === 'string' ? [value] : Object.values(value)).some(
        (sentence) =>
          typeof sentence === 'string' && FORBIDDEN.test(sentence.replace(OWN_FEED, '')),
      ),
    );
    expect(offenders.map(([key]) => key)).toEqual([]);
  });
});
