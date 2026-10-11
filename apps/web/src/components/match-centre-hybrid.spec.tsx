import type {
  CommunityConsensusResponse,
  FixtureEvaluationsResponse,
  ForecastEvaluation,
  ForecastVersion,
  ForecastVersionsResponse,
  FounderAnalysisResponse,
  MatchCentre,
  MatchLineupPlayer,
  MatchViewing,
} from '@fmip/contracts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EN } from '@/i18n/messages';
import { pitchLines } from '@/lib/formation';
import { matchWords } from '@/lib/words-server';
import { CommunityVerdict } from './community-consensus';
import { ModelVerdict } from './forecast-panel';
import { FounderVerdict } from './founder-analysis';
import { MatchCentreView } from './match-centre-view';
import { MatchLineupsView } from './match-lineups';
import { HighlightsLink, WatchLine } from './viewing-panel';

/**
 * The Hybrid match centre (T-1384, D-202): the score band before, during and
 * after a match, the line-ups on a pitch only where the feed places every
 * starter, the phone's tabs, where to watch under the score, and after full
 * time the three products against the result, each in its own lane.
 */

// ---------------------------------------------------------------------------
// The pitch: placed from the formation and the roles, never invented
// ---------------------------------------------------------------------------

let next = 0;
const player = (
  position: MatchLineupPlayer['position'],
  over: Partial<MatchLineupPlayer> = {},
): MatchLineupPlayer => {
  next += 1;
  return {
    id: `p${next}`,
    name: `Player ${next}`,
    role: 'starter',
    shirt_number: next,
    position,
    is_captain: false,
    ...over,
  };
};
const eleven = (d: number, m: number, f: number): MatchLineupPlayer[] => [
  player('goalkeeper'),
  ...Array.from({ length: d }, () => player('defender')),
  ...Array.from({ length: m }, () => player('midfielder')),
  ...Array.from({ length: f }, () => player('forward')),
];

describe('where the starters stand (pitchLines)', () => {
  it('fills a three-line formation from the roles, goalkeeper first', () => {
    const lines = pitchLines('4-3-3', [...eleven(4, 3, 3), player('defender', { role: 'bench' })]);
    expect(lines.state).toBe('pitch');
    if (lines.state !== 'pitch') return;
    expect(lines.lines.map((line) => line.length)).toEqual([1, 4, 3, 3]);
    expect(lines.lines[0]?.[0]?.position).toBe('goalkeeper');
  });

  it('will not split the midfield of a four-line formation: it does not know who stood where', () => {
    expect(pitchLines('4-2-3-1', eleven(4, 5, 1))).toEqual({
      state: 'lines_unknown',
      formation: '4-2-3-1',
    });
  });

  it('says why when the formation, a role or the counts are missing or wrong', () => {
    expect(pitchLines(null, eleven(4, 4, 2)).state).toBe('no_formation');
    expect(pitchLines('4 4 2', eleven(4, 4, 2)).state).toBe('no_formation');
    const noRole = eleven(4, 4, 2);
    noRole[5] = { ...noRole[5]!, position: null };
    expect(pitchLines('4-4-2', noRole).state).toBe('no_roles');
    expect(pitchLines('4-4-2', eleven(4, 4, 1)).state).toBe('no_roles');
    expect(pitchLines('4-4-2', eleven(5, 3, 2))).toEqual({ state: 'mismatch', formation: '4-4-2' });
    expect(pitchLines('4-4-3', eleven(4, 4, 2)).state).toBe('mismatch');
  });
});

const team = (id: string, name: string, formation: string | null) => ({
  id,
  name,
  short_name: null,
  code: null,
  formation,
  coach: id === 'h' ? { id: 'c', name: 'Dragan Skočić' } : null,
});

describe('the line-ups on a pitch', () => {
  const words = matchWords('en');
  const render = (homeFormation: string | null, awayFormation: string | null, locale = 'en') =>
    renderToStaticMarkup(
      <MatchLineupsView
        home={team('h', 'Tractor', homeFormation)}
        away={team('a', 'Esteghlal', awayFormation)}
        lineups={{
          home: [...eleven(4, 3, 3), player('forward', { role: 'bench', name: 'Sub Home' })],
          away: eleven(4, 5, 1),
        }}
        locale={locale}
        words={locale === 'en' ? words : matchWords(locale)}
      />,
    );

  it('draws both halves, away at the top and home at the bottom, each goalkeeper at its own goal', () => {
    const html = renderToStaticMarkup(
      <MatchLineupsView
        home={team('h', 'Tractor', '4-3-3')}
        away={team('a', 'Esteghlal', '4-4-2')}
        lineups={{ home: eleven(4, 3, 3), away: eleven(4, 4, 2) }}
        locale="en"
        words={words}
      />,
    );
    expect(html).toContain('data-sides="away home"');
    expect(html.indexOf('data-testid="pitch-away"')).toBeLessThan(
      html.indexOf('data-testid="pitch-home"'),
    );
    const away = html.slice(
      html.indexOf('data-testid="pitch-away"'),
      html.indexOf('data-testid="pitch-home"'),
    );
    const home = html.slice(html.indexOf('data-testid="pitch-home"'));
    // Away: goalkeeper's row first (a row of one), then four, four, two.
    expect(
      [...away.matchAll(/<ol class="flex justify-around py-1.5">(.*?)<\/ol>/g)].map(
        (m) => (m[1] ?? '').split('<li').length - 1,
      ),
    ).toEqual([1, 4, 4, 2]);
    // Home: forwards first, goalkeeper last.
    expect(
      [...home.matchAll(/<ol class="flex justify-around py-1.5">(.*?)<\/ol>/g)].map(
        (m) => (m[1] ?? '').split('<li').length - 1,
      ),
    ).toEqual([3, 3, 4, 1]);
    expect(html).toContain(
      'aria-label="Line-ups on the pitch: Esteghlal in the top half, Tractor in the bottom half"',
    );
    expect(html).toContain(EN['matchCentre.lineups.pitchNote']);
    // Every name still goes to the player page.
    expect(html).toContain('href="/en/player/');
    expect(html).not.toMatch(/data-testid="lineup-fallback"/);
  });

  it('falls back to a list for a side it cannot place, and says why', () => {
    const html = render('4-3-3', '4-2-3-1');
    expect(html).toContain('data-sides="home"');
    expect(html).toContain('data-testid="lineup-list-away"');
    expect(html).toContain('data-reason="lines_unknown"');
    expect(html).toContain(
      'The feed does not say which midfielder played in which line of the ⁦4-2-3-1⁩, so this line-up is a list.',
    );
    const both = render(null, null);
    expect(both).not.toContain('data-testid="lineup-pitch"');
    expect(both.match(/data-reason="no_formation"/g)).toHaveLength(2);
  });

  it('keeps the bench and the coach for each side, and says when a coach is not supplied', () => {
    const html = render('4-3-3', '4-5-1');
    const benches = html.slice(html.indexOf('data-testid="lineup-benches"'));
    expect(benches).toContain('Sub Home');
    expect(benches).toContain('Coach: Dragan Skočić');
    expect(benches).toContain('Coach: not supplied');
  });

  it('says it in Persian, the formation kept left to right inside the sentence', () => {
    const html = render('4-3-3', '4-2-3-1', 'fa');
    expect(html).toContain('داده‌ها نمی‌گویند هر هافبک در کدام خطِ آرایش ⁦4-2-3-1⁩ بازی کرد');
    expect(html).toContain('میزبان در پایین.');
    expect(html).not.toContain('data-translation="untranslated"');
  });

  it('says a line-up with nobody in it is not supplied, rather than two empty lists', () => {
    const html = renderToStaticMarkup(
      <MatchLineupsView
        home={team('h', 'Tractor', '4-3-3')}
        away={team('a', 'Esteghlal', null)}
        lineups={{ home: [], away: [] }}
        locale="en"
        words={words}
      />,
    );
    expect(html).toContain('data-testid="lineup-empty"');
    expect(html).toContain('Not supplied for this match.');
    expect(html).not.toContain('<ul');
  });
});

// ---------------------------------------------------------------------------
// The score band before, during and after the match
// ---------------------------------------------------------------------------

const empty = { coverage: 'not_supplied' as const, last_updated_at: null, data: null };
const centre = (fixture: Partial<MatchCentre['fixture']>): MatchCentre => ({
  fixture: {
    id: '00000000-0000-4000-8000-000000000901',
    kickoff_at: '2026-10-08T13:30:00.000Z',
    status: 'live',
    minute: 78,
    competition: { id: 'c', name: 'Persian Gulf Pro League', short_name: null, country_id: null },
    season: { id: 's', label: '2026/27' },
    stage: null,
    round: null,
    group_name: null,
    leg: null,
    home: team('h', 'Tractor', null),
    away: team('a', 'Esteghlal', null),
    scores: {
      current: { home: 2, away: 1 },
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
    last_updated_at: '2026-10-08T14:50:00.000Z',
    freshness: null,
    ...fixture,
  },
  timeline: empty,
  statistics: empty,
  lineups: empty,
  availability: empty,
  player_statistics: empty,
  form: { home: empty, away: empty },
  head_to_head: empty,
  coverage: {
    scores: 'available',
    incidents: 'available',
    lineups: 'limited',
    statistics: 'delayed',
    standings: 'limited',
    availability: 'not_supplied',
    advanced_statistics: 'not_supplied',
  },
});
const band = (c: MatchCentre, locale = 'en', hero = {}) => {
  const html = renderToStaticMarkup(
    <MatchCentreView
      words={matchWords(locale)}
      centre={c}
      timeZone="Asia/Tehran"
      locale={locale}
      hero={hero}
    />,
  );
  return html.slice(0, html.indexOf('</header>'));
};

describe('the score band', () => {
  it('before kick-off shows the kick-off time large, and no score at all', () => {
    const html = band(
      centre({
        status: 'scheduled',
        minute: null,
        scores: { ...centre({}).fixture.scores, current: null },
      }),
    );
    // 13:30 UTC is 17:00 in Tehran.
    expect(html).toMatch(/data-testid="match-status">17:00</);
    expect(html).not.toContain('data-testid="score"');
    expect(html).not.toContain('live-dot');
  });

  it('live shows the minute in red with the live word, and the stream line under it', () => {
    const html = band(centre({}), 'en', { live: <p data-testid="live-state">STAMP</p> });
    expect(html).toMatch(
      /text-live"><span aria-hidden="true" class="live-dot[^"]*"><\/span><span>Live <\/span><span data-testid="match-status">78′</,
    );
    expect(html.indexOf('data-testid="match-status"')).toBeLessThan(html.indexOf('STAMP'));
  });

  it('at full time shows the full-time score and FT, and the highlight before the facts', () => {
    const html = band(
      centre({
        status: 'finished',
        minute: null,
        scores: {
          ...centre({}).fixture.scores,
          current: { home: 1, away: 1 },
          full_time: { home: 1, away: 1 },
        },
      }),
      'en',
      { highlights: <p data-testid="hero-highlights">CLIP</p> },
    );
    expect(html).toMatch(/data-testid="match-status">FT</);
    expect(html).not.toContain('text-live');
    expect(html.indexOf('CLIP')).toBeLessThan(html.indexOf('data-testid="last-update"'));
  });

  it('on /fa sets the score in Vazirmatn with Persian digits, home goals on the home side', () => {
    const html = band(centre({}), 'fa');
    expect(html).toMatch(
      /<span dir="rtl" class="[^"]*text-display-4[^"]*" data-testid="score">۲<span[^>]*>–<\/span>۱<\/span>/,
    );
    expect(html).not.toMatch(/data-testid="score"[^>]*font-stretch-condensed/);
    // The home team first in the DOM, so the grid puts it on the right.
    expect(html.indexOf('data-testid="home-team"')).toBeLessThan(
      html.indexOf('data-testid="away-team"'),
    );
    expect(html).toContain('۷۸′');
  });

  it('says that no event is recorded yet rather than drawing an empty list', () => {
    const html = renderToStaticMarkup(
      <MatchCentreView
        words={matchWords('en')}
        centre={{
          ...centre({}),
          timeline: { coverage: 'available', last_updated_at: null, data: [] },
        }}
        timeZone="UTC"
        locale="en"
      />,
    );
    expect(html).toContain('data-testid="no-events"');
    expect(html).toContain('No events recorded yet.');
  });

  it('puts the stamp and the watch line under the score, full width, so the names keep their room', () => {
    const html = band(centre({}), 'en', {
      live: <p>STAMP</p>,
      watch: <p>WATCH</p>,
    });
    expect(html.indexOf('data-testid="away-team"')).toBeLessThan(html.indexOf('STAMP'));
    expect(html.indexOf('STAMP')).toBeLessThan(html.indexOf('WATCH'));
  });

  it('never paints a club colour or a lane colour on the band', () => {
    const html = band(centre({}));
    expect(html).not.toMatch(/bg-(model|founder|community)|text-(model|founder|community)/);
  });
});

describe('the phone tabs need no script (T-1384)', () => {
  const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');

  it('shows the tab holding the target, else the Summary, below 768px only', () => {
    const block = css.slice(css.indexOf("The match centre's tabs on a phone"));
    expect(block).toContain('@media (width < 48rem)');
    expect(block).toContain(
      "[data-match-tabs]:not(:has(:target)) [data-tab]:not([data-tab='summary'])",
    );
    expect(block).toContain(
      '[data-match-tabs]:has(:target) [data-tab]:not(:target, :has(:target))',
    );
    for (const tab of ['summary', 'lineups', 'stats', 'predictions', 'watch', 'discussion']) {
      expect(block).toContain(`[data-tab-link='${tab}']`);
    }
  });
});

// ---------------------------------------------------------------------------
// Where to watch, and the highlight
// ---------------------------------------------------------------------------

const viewing = (over: Partial<MatchViewing> = {}): MatchViewing => ({
  fixture_id: 'f1',
  territory: { state: 'chosen', territory: { code: 'IR', name: 'Iran' } },
  options: empty,
  highlights: empty,
  ...over,
});
const option = (id: string, name: string, access: 'free' | 'registration' = 'free') => ({
  id: `${id}-${access}`,
  broadcaster: { id, name, homepage_url: null, kind: 'tv' as const },
  access,
  url: `https://${id}.example/live`,
  territory: 'IR',
  source: { id: 's', name: 'Desk', rights: 'link' as const },
  from_default: false,
  last_updated_at: '2026-10-08T07:00:00.000Z',
});

describe('where to watch under the score', () => {
  it('names each service once, as a link-out to its own page', () => {
    const html = renderToStaticMarkup(
      <WatchLine
        locale="en"
        viewing={viewing({
          options: {
            coverage: 'available',
            last_updated_at: '2026-10-08T07:00:00.000Z',
            data: [
              option('tv3', 'IRIB TV3'),
              option('tw', 'Telewebion'),
              option('tw', 'Telewebion', 'registration'),
            ],
          },
        })}
      />,
    );
    expect(html).toContain('Watch:');
    expect(html.match(/data-link-out="/g)).toHaveLength(2);
    expect(html).toContain('href="https://tv3.example/live"');
    expect(html).toContain('data-link-out="Telewebion"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('sends the reader to the Watch section when nothing is listed, and says nothing when unreachable', () => {
    const ask = renderToStaticMarkup(
      <WatchLine locale="en" viewing={viewing({ territory: { state: 'not_chosen' } })} />,
    );
    expect(ask).toContain('href="#watch"');
    expect(ask).toContain('data-state="ask"');
    expect(ask).not.toContain('data-link-out');
    expect(renderToStaticMarkup(<WatchLine locale="en" viewing={null} />)).toBe('');
  });

  it('puts the official highlight first after full time, naming its publisher or its site', () => {
    const clip = (publisher: string | null) =>
      renderToStaticMarkup(
        <HighlightsLink
          locale="en"
          viewing={viewing({
            highlights: {
              coverage: 'available',
              last_updated_at: '2026-10-08T17:00:00.000Z',
              data: [
                {
                  id: 'h1',
                  kind: 'official_page',
                  url: 'https://www.telewebion.com/clip/1',
                  embed_url: null,
                  thumbnail_url: null,
                  territory: 'IR',
                  source: { id: 's', name: 'Desk', rights: 'link' },
                  publisher,
                  last_updated_at: '2026-10-08T17:00:00.000Z',
                },
              ],
            },
          })}
        />,
      );
    expect(clip('Persian Gulf Pro League')).toContain(
      'Official highlights (<bdi>Persian Gulf Pro League</bdi>)',
    );
    expect(clip(null)).toContain('data-link-out="telewebion.com"');
    expect(clip(null)).toContain(
      'Highlights open on telewebion.com&#x27;s site. We don&#x27;t host video.',
    );
    expect(renderToStaticMarkup(<HighlightsLink locale="en" viewing={viewing()} />)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// What was forecast, and what happened: three lanes, three components
// ---------------------------------------------------------------------------

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
const forecasts: ForecastVersionsResponse = {
  fixture_id: 'f1',
  coverage: 'available',
  last_updated_at: '2026-10-08T12:00:00.000Z',
  latest: version(2, '2026-10-08T14:00:00.000Z'),
  versions: [version(1, '2026-10-08T12:00:00.000Z'), version(2, '2026-10-08T14:00:00.000Z')],
} as ForecastVersionsResponse;
const evaluation: ForecastEvaluation = {
  id: 'e1',
  forecast_id: 'v1',
  fixture_id: 'f1',
  version_number: 1,
  kind: 'early',
  model_version: 'dixon-coles-elo@0.6.0',
  computed_at: '2026-10-08T12:00:00.000Z',
  evaluated_at: '2026-10-08T16:00:00.000Z',
  pre_kickoff: true,
  actual: { home: 1, away: 1 },
  outcome: 'draw',
  p_outcome: 0.34,
  log_loss: 1.08,
  brier: 0.6,
  rps: 0.1258,
  correct: false,
  scoreline_hit: false,
};
const evaluations: FixtureEvaluationsResponse = {
  fixture_id: 'f1',
  coverage: 'available',
  last_updated_at: '2026-10-08T16:00:00.000Z',
  evaluations: [evaluation],
};
const KICKOFF = '2026-10-08T13:30:00.000Z';
const DRAW = { home: 1, away: 1 };

describe('the model against the result', () => {
  const model = (
    f: ForecastVersionsResponse | null,
    e: FixtureEvaluationsResponse | null,
    locale = 'en',
  ) =>
    renderToStaticMarkup(
      <ModelVerdict
        forecasts={f}
        evaluations={e}
        kickoffAt={KICKOFF}
        result={DRAW}
        home="Tractor"
        away="Esteghlal"
        timeZone="UTC"
        locale={locale}
      />,
    );

  it('shows the scored pre-match version, what it gave the result and its RPS', () => {
    const html = model(forecasts, evaluations);
    expect(html).toContain('data-lane="model"');
    expect(html).toContain('Result: a draw. The model gave it 34.0%.');
    expect(html).toMatch(/data-testid="model-verdict-rps"[^]*0\.126/);
    expect(html).toContain('ranked probability score for this match · 0 is perfect');
    // Never the founder's or the community's colour.
    expect(html).not.toMatch(/founder|community/);
  });

  it('without an evaluation shows the last version before kick-off, unscored', () => {
    const html = model(forecasts, null);
    expect(html).toContain('Result: a draw.');
    expect(html).toContain('data-testid="model-verdict-unscored"');
    expect(html).not.toContain('data-testid="model-verdict-rps"');
  });

  it('says so when there was no version before kick-off, or the service did not answer', () => {
    const late = { ...forecasts, versions: [version(3, '2026-10-08T15:00:00.000Z')] };
    expect(model(late, null)).toContain(EN['forecastBar.noneBefore']);
    expect(model(late, null)).not.toContain('data-testid="model-verdict-result"');
    expect(model(null, null)).toContain('data-state="unreachable"');
  });

  it('says it in Persian with Persian digits', () => {
    const html = model(forecasts, evaluations, 'fa');
    expect(html).toContain('۰٫۱۲۶');
    expect(html).toContain('نتیجه:');
    expect(html).not.toContain('data-translation="untranslated"');
  });
});

describe('the founder against the result', () => {
  const analysis = (
    outcome: 'home' | 'draw' | 'away',
    score: { home: number; away: number } | null,
  ): FounderAnalysisResponse => ({
    fixture_id: 'f1',
    analysis: {
      id: 'a1',
      fixture_id: 'f1',
      author: { id: 'u1', display_name: 'Mostafa' },
      versions: [
        {
          id: 'av1',
          version_number: 1,
          predicted_outcome: outcome,
          predicted_score: score,
          confidence: 3,
          reasoning: 'Tractor at home are hard to beat.',
          lineup_impact: null,
          key_players: null,
          form_and_context: null,
          published_at: '2026-10-07T10:00:00.000Z',
        },
      ],
    },
  });
  const founder = (a: FounderAnalysisResponse | null) =>
    renderToStaticMarkup(
      <FounderVerdict
        analysis={a}
        result={DRAW}
        home="Tractor"
        away="Esteghlal"
        timeZone="UTC"
        locale="en"
      />,
    );

  it('settles the published pick on the result, signed', () => {
    const right = founder(analysis('draw', { home: 1, away: 1 }));
    expect(right).toContain('data-lane="founder"');
    expect(right).toContain('data-state="right"');
    expect(right).toContain('The result matched the pick. The score was exact too.');
    expect(right).toContain('data-testid="founder-signature"');
    const wrong = founder(analysis('home', { home: 2, away: 0 }));
    expect(wrong).toContain('data-state="wrong"');
    expect(wrong).toContain('The result did not match the pick.');
    expect(wrong).not.toContain('exact');
  });

  it('says once that there is no analysis', () => {
    expect(founder(null)).toContain(EN['analysis.founder.none']);
    expect(founder({ fixture_id: 'f1', analysis: null })).toContain('data-state="none"');
  });
});

describe('the community against the result', () => {
  const community = (c: CommunityConsensusResponse | null) =>
    renderToStaticMarkup(
      <CommunityVerdict consensus={c} result={DRAW} home="Tractor" away="Esteghlal" locale="en" />,
    );

  it('says the share that picked what happened, over its spread and sample', () => {
    const html = community({
      coverage: 'available',
      last_updated_at: '2026-10-08T13:30:00.000Z',
      data: {
        fixture_id: 'f1',
        sample: 40,
        crowd: {
          counts: { home: 22, draw: 10, away: 8 },
          shares: { home: 0.55, draw: 0.25, away: 0.2 },
        },
        weighted: null,
        last_submitted_at: '2026-10-08T13:29:00.000Z',
        computed_at: '2026-10-08T13:30:00.000Z',
      },
    });
    expect(html).toContain('25.0% picked a draw');
    expect(html).toContain('bg-community');
    expect(html).not.toMatch(/bg-model|bg-founder/);
  });

  it('below the floor has no consensus to set against the result', () => {
    expect(community({ coverage: 'not_supplied', last_updated_at: null, data: null })).toContain(
      'data-state="not_supplied"',
    );
    expect(community(null)).toContain('data-state="unreachable"');
  });
});
