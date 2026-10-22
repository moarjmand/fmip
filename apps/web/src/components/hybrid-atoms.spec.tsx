import type {
  CommunityConsensusResponse,
  MatchViewing,
  Prediction,
  TeamFixture,
} from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { message, resolveMessages } from '@/i18n/messages';
import type { CardForecast } from '@/lib/score-card-products';
import { forecastBarWords } from '@/lib/words-server';
import { CommunityForecastPanel, CommunitySplit } from './community-consensus';
import { ForecastBar } from './forecast-bar';
import { FreshnessStamp } from './freshness-stamp';
import { NextMatchCard } from './next-match-card';
import { PredictionForm, type PredictionFormWords, pickState } from './prediction-form';
import { CommunityLane, FounderLane, ModelLane, ThreeProductsNote } from './product-lanes';
import { CoverageBadge, LinkOut } from './ui';

/**
 * The Hybrid design's shared data atoms (T-1388, D-206), each in its states:
 * the forecast bar with and without a forecast, the freshness stamp fresh
 * and behind, the four coverage badges, the three lanes, the link-out, the
 * pick before and after, and the next-match card -- in English and in
 * Persian, where the reading order turns round and the digits are Persian.
 */

const AVAILABLE: CardForecast = {
  state: 'available',
  home: 46.4,
  draw: 33.6,
  away: 20,
  version: 3,
  model_version: 'dixon-coles-elo@0.6.0',
  computed_at: '2026-10-11T09:30:00.000Z',
};

const bar = (forecast: CardForecast, locale = 'en', started = false) =>
  renderToStaticMarkup(
    <ForecastBar
      forecast={forecast}
      home="Tractor"
      away="Esteghlal"
      started={started}
      locale={locale}
      timeZone="UTC"
      words={forecastBarWords(locale)}
    />,
  );

/** The `data-outcome` values in document order: the reading order of the segments. */
const outcomeOrder = (html: string) =>
  [...html.matchAll(/<span data-outcome="(\w+)" class="rounded-sm/g)].map((m) => m[1]);

describe('ForecastBar', () => {
  it('draws one hue in three steps, labelled, with the model id and computation time', () => {
    const html = bar(AVAILABLE);
    expect(html).toContain('data-state="available"');
    // One hue: the model token at full, 55% and 25%, home strongest.
    expect(html).toMatch(/data-outcome="home" class="rounded-sm bg-model"/);
    expect(html).toMatch(/data-outcome="draw" class="rounded-sm bg-model\/55"/);
    expect(html).toMatch(/data-outcome="away" class="rounded-sm bg-model\/25"/);
    expect(html).not.toMatch(/bg-(community|founder|accent)/);
    expect(html).toContain('46.4%');
    expect(html).toContain('33.6%');
    expect(html).toContain('20.0%');
    expect(html).toContain(
      'aria-label="Model forecast: Tractor 46.4%, draw 33.6%, Esteghlal 20.0%"',
    );
    // Always the model id and the time, in the mono face.
    expect(html).toMatch(/font-mono[^"]*" data-testid="forecast-bar-meta"/);
    expect(html).toContain('dixon-coles-elo<span>@</span>0.6.0');
    expect(html).toMatch(/computed <time dateTime="2026-10-11T09:30:00.000Z">11 Oct, 09:30 UTC/);
  });

  it('keeps home first in the source, so a right-to-left page puts it on the right, in Persian digits', () => {
    const html = bar(AVAILABLE, 'fa');
    expect(outcomeOrder(html)).toEqual(['home', 'draw', 'away']);
    expect(html).toContain('۴۶٫۴٪');
    expect(html).toContain('محاسبه‌شده');
    // The model id stays a left-to-right island inside Persian.
    expect(html).toContain('<span dir="ltr" class="text-model">dixon-coles-elo<span>@</span>0.6.0</span>');
    // Nothing physical: the direction does the mirroring (rule 7).
    expect(html).not.toMatch(/\b(ml|mr|pl|pr|left|right)-/);
  });

  it('says in words when there is no forecast, never an empty bar', () => {
    const none = bar({ state: 'none' });
    expect(none).toContain('data-state="none"');
    expect(none).toContain('No model forecast for this match yet.');
    expect(none).not.toContain('role="img"');
    expect(bar({ state: 'none' }, 'en', true)).toContain(
      'The model had no forecast for this match before kick-off.',
    );
    expect(
      bar({
        state: 'unavailable',
        reason: 'no_history',
        version: 2,
        computed_at: AVAILABLE.computed_at,
      }),
    ).toContain('The model gave no probabilities in version 2.');
    expect(bar({ state: 'unreachable' })).toContain('could not be loaded');
    expect(bar({ state: 'none' }, 'fa')).toContain('مدل آماری هنوز');
  });
});

const FRESH_WORDS = resolveMessages('en', ['freshness.checked', 'freshness.behind']);
const NOW = Date.parse('2026-10-11T10:00:00.000Z');

describe('FreshnessStamp', () => {
  const stamp = (agoMs: number, extra: { behind?: boolean; locale?: string } = {}) =>
    renderToStaticMarkup(
      <FreshnessStamp
        checkedAt={NOW - agoMs}
        now={NOW}
        staleAfterMs={45_000}
        behind={extra.behind}
        locale={extra.locale ?? 'en'}
        words={
          extra.locale === 'fa'
            ? resolveMessages('fa', ['freshness.checked', 'freshness.behind'])
            : FRESH_WORDS
        }
      />,
    );

  it('says how long ago the check was, quietly, while it is within the threshold', () => {
    const html = stamp(8_000);
    expect(html).toContain('data-freshness="current"');
    expect(html).toContain('text-muted');
    expect(html).toMatch(/Last checked <time[^>]*>8 sec(\.)? ago<\/time>/);
    expect(html).not.toContain('may be behind');
  });

  it('turns to the warning colour and says "may be behind" past the threshold', () => {
    const html = stamp(4 * 60_000);
    expect(html).toContain('data-freshness="behind"');
    expect(html).toContain('text-warning');
    expect(html).toMatch(/4 min(\.)? ago<\/time> · may be behind/);
  });

  it('is behind whenever the surface already knows it is, however recent the last word', () => {
    expect(stamp(2_000, { behind: true })).toContain('data-freshness="behind"');
  });

  it('speaks Persian with Persian digits', () => {
    const html = stamp(8_000, { locale: 'fa' });
    expect(html).toContain('آخرین بررسی');
    expect(html).toContain('۸ ثانیه پیش');
  });

  it('shows nothing without a clock, rather than an age that would be wrong when read', () => {
    expect(
      renderToStaticMarkup(
        <FreshnessStamp
          checkedAt={NOW}
          now={undefined}
          staleAfterMs={45_000}
          locale="en"
          words={FRESH_WORDS}
        />,
      ),
    ).toBe('');
  });
});

describe('CoverageBadge', () => {
  const badge = (state: 'available' | 'limited' | 'not_supplied' | 'delayed') =>
    renderToStaticMarkup(<CoverageBadge state={state} label={state} />);

  it('gives each of the four states its own icon as well as its colour', () => {
    const icons = (['available', 'limited', 'not_supplied', 'delayed'] as const).map(
      (state) => /data-icon="(\w+)"/.exec(badge(state))?.[1],
    );
    expect(icons).toEqual(['check', 'limited', 'dash', 'clock']);
    expect(new Set(icons).size).toBe(4);
    expect(badge('available')).toContain('text-success');
    expect(badge('limited')).toContain('text-warning');
    expect(badge('delayed')).toContain('text-warning');
    // Not supplied is the quiet one, and its edge is dashed: not hue alone.
    expect(badge('not_supplied')).toContain('border-dashed border-caption text-caption');
    expect(badge('available')).toContain('data-coverage-badge="available"');
  });
});

describe('LinkOut', () => {
  it('always names who hosts the destination, with the external-link mark', () => {
    const inline = renderToStaticMarkup(<LinkOut href="https://example.org/tv3" host="IRIB TV3" />);
    expect(inline).toContain('href="https://example.org/tv3"');
    expect(inline).toContain('rel="noopener noreferrer"');
    expect(inline).toContain('<bdi>IRIB TV3</bdi>');
    expect(inline).toContain('data-icon="external"');
    const button = renderToStaticMarkup(
      <LinkOut href="https://example.org/clip" host="the publisher" look="button" icon="play">
        Official highlights
      </LinkOut>,
    );
    expect(button).toContain('Official highlights (<bdi>the publisher</bdi>)');
    expect(button).toContain('min-h-touch');
  });
});

describe('the three lanes', () => {
  it('give each product its own colour, icon and name, and the note says they stay separate', () => {
    const lanes = [
      [renderToStaticMarkup(<ModelLane locale="en">x</ModelLane>), 'model', 'Statistical model'],
      [
        renderToStaticMarkup(<FounderLane locale="en">x</FounderLane>),
        'founder',
        'Founder’s analysis',
      ],
      [
        renderToStaticMarkup(<CommunityLane locale="en">x</CommunityLane>),
        'community',
        'Community picks',
      ],
    ] as const;
    for (const [html, lane, name] of lanes) {
      expect(html).toContain(`data-lane="${lane}"`);
      expect(html).toContain(`border-${lane} bg-${lane}/8`);
      expect(html).toContain(`data-icon="${lane}"`);
      expect(html).toContain(name);
      for (const other of ['model', 'founder', 'community'].filter((o) => o !== lane)) {
        expect(html).not.toContain(`-${other}`);
      }
    }
    expect(renderToStaticMarkup(<ThreeProductsNote locale="en" />)).toContain(
      'Three separate products.',
    );
    expect(renderToStaticMarkup(<ModelLane locale="fa">x</ModelLane>)).toContain('مدل آماری');
  });
});

const CONSENSUS: CommunityConsensusResponse = {
  coverage: 'available',
  last_updated_at: '2026-10-11T09:00:00.000Z',
  data: {
    fixture_id: 'f1',
    sample: 12,
    crowd: {
      counts: { home: 6, draw: 4, away: 2 },
      shares: { home: 0.5, draw: 0.3333, away: 0.1667 },
    },
    weighted: null,
    last_submitted_at: '2026-10-11T09:00:00.000Z',
    computed_at: '2026-10-11T09:01:00.000Z',
  },
};

describe('the community spread opens only after the reader’s own pick', () => {
  const panel = (revealed: boolean) =>
    renderToStaticMarkup(
      <CommunityForecastPanel
        consensus={CONSENSUS}
        home="Tractor"
        away="Esteghlal"
        timeZone="UTC"
        locale="en"
        model={null}
        revealed={revealed}
      />,
    );

  it('says how many have picked and nothing about what, until then', () => {
    const html = panel(false);
    expect(html).toContain('data-spread="hidden"');
    expect(html).toContain('12 members have picked');
    expect(html).not.toContain('data-testid="consensus-crowd"');
    expect(html).not.toContain('50.0%');
  });

  it('draws the spread in the community colour once revealed', () => {
    const html = panel(true);
    expect(html).toContain('data-spread="revealed"');
    expect(html).toContain('data-testid="consensus-crowd"');
    expect(html).toMatch(/data-outcome="home" class="rounded-sm bg-community"/);
    expect(html).toContain('50.0%');
    expect(html).not.toMatch(/bg-model/);
  });

  it('the split under the pick names its sample and that it locks at kick-off', () => {
    const html = renderToStaticMarkup(
      <CommunitySplit consensus={CONSENSUS} home="Tractor" away="Esteghlal" locale="en" />,
    );
    expect(html).toContain('Community split · revealed after your pick');
    expect(html).toContain('12 picks · locks at kick-off');
    const below = renderToStaticMarkup(
      <CommunitySplit
        consensus={{ ...CONSENSUS, data: null }}
        home="Tractor"
        away="Esteghlal"
        locale="en"
      />,
    );
    expect(below).toContain('data-state="not_supplied"');
    expect(below).toContain('no consensus to show yet');
  });
});

const FORM_WORDS: PredictionFormWords = {
  call: 'Your call',
  draw: 'Draw',
  score: 'Score',
  homeGoals: { text: 'Tractor goals' },
  awayGoals: { text: 'Esteghlal goals' },
  confidence: 'Confidence',
  confidenceOptions: ['1', '2', '3', '4', '5'],
  reasons: 'Reasons',
  reasonTags: {
    form: 'Form',
    lineup: 'Line-up',
    home_advantage: 'Home advantage',
    injuries: 'Injuries',
    tactics: 'Tactics',
    fatigue: 'Fatigue',
    competition_importance: 'Competition importance',
    head_to_head: 'Head-to-head',
    motivation: 'Motivation',
  },
  why: 'Why',
  submit: 'Submit prediction',
  update: 'Update prediction',
  version: 'Version 1',
  share: 'Share',
  shareTitle: 'Tractor v Esteghlal',
  shareMessages: { copied: message('en', 'share.copied'), manual: message('en', 'share.manual') },
  makePick: 'Make your pick',
  group: { text: 'Your pick: Tractor v Esteghlal' },
};

const PREDICTION: Prediction = {
  id: 'p1',
  fixture_id: 'f1',
  locks_at: '2026-10-12T15:30:00.000Z',
  locked: false,
  latest: {
    id: 'v1',
    version_number: 1,
    outcome: 'home',
    score: null,
    confidence: 3,
    reason_tags: [],
    explanation: null,
    submitted_at: '2026-10-11T09:00:00.000Z',
  },
  versions: [],
  settlement: null,
};

describe('Make your pick', () => {
  const form = (current: Prediction | null) =>
    renderToStaticMarkup(
      <PredictionForm
        action={async () => null}
        current={current}
        home="Tractor"
        away="Esteghlal"
        split={<p data-testid="the-split">split</p>}
        words={FORM_WORDS}
      />,
    );

  it('moves before, choosing, picked', () => {
    expect(pickState(false, false)).toBe('before');
    expect(pickState(false, true)).toBe('choosing');
    expect(pickState(true, false)).toBe('picked');
    expect(pickState(true, true)).toBe('picked');
  });

  it('starts as one control in the community colour, with the split nowhere on the page', () => {
    const html = form(null);
    expect(html).toContain('data-pick="before"');
    expect(html).toContain('Make your pick');
    expect(html).toContain('border-community');
    expect(html).not.toContain('bg-accent text-on-accent');
    expect(html).not.toContain('type="radio"');
    expect(html).not.toContain('the-split');
  });

  it('once picked, shows the choice pressed in the community colour and reveals the split', () => {
    const html = form(PREDICTION);
    expect(html).toContain('data-pick="picked"');
    expect(html).toMatch(/checked="" value="home"/);
    expect(html).toContain('has-checked:bg-community');
    expect(html).toContain('aria-label="Your pick: Tractor v Esteghlal"');
    expect(html).toContain('data-testid="the-split"');
    expect(html).toContain('Update prediction');
  });
});

const FIXTURE: TeamFixture = {
  id: 'f1',
  kickoff_at: '2026-10-12T13:30:00.000Z',
  status: 'scheduled',
  round: 'Matchweek 8',
  stage: null,
  home: { id: 't1', name: 'Tractor', short_name: null },
  away: { id: 't2', name: 'Esteghlal', short_name: null },
  score: null,
  competition: { id: 'c1', name: 'Persian Gulf Pro League', short_name: 'Pro League' },
  season: { id: 's1', label: '2026/27' },
};

const VIEWING: MatchViewing = {
  fixture_id: 'f1',
  territory: { state: 'chosen', territory: { code: 'IR', name: 'Iran' } },
  options: {
    coverage: 'available',
    last_updated_at: '2026-10-11T09:00:00.000Z',
    data: [
      {
        id: 'o1',
        broadcaster: { id: 'b1', name: 'IRIB TV3', homepage_url: null, kind: 'tv' },
        access: 'free',
        url: 'https://example.org/tv3',
        territory: 'IR',
        source: 'editorial',
        from_default: false,
        last_updated_at: '2026-10-11T09:00:00.000Z',
      },
      {
        id: 'o2',
        broadcaster: { id: 'b2', name: 'Telewebion', homepage_url: null, kind: 'streaming' },
        access: 'free',
        url: 'https://example.org/twb',
        territory: 'IR',
        source: 'editorial',
        from_default: false,
        last_updated_at: '2026-10-11T09:00:00.000Z',
      },
    ],
  },
  highlights: { coverage: 'not_supplied', last_updated_at: null, data: null },
} as unknown as MatchViewing;

describe('NextMatchCard', () => {
  const card = (forecast: CardForecast, viewing: MatchViewing | null, locale = 'en') =>
    renderToStaticMarkup(
      <NextMatchCard
        fixture={FIXTURE}
        forecast={forecast}
        viewing={viewing}
        locale={locale}
        timeZone="Asia/Tehran"
      />,
    );

  it('names the opponent, the Tehran time, the model with its version, and who broadcasts it', () => {
    const html = card(AVAILABLE, VIEWING);
    expect(html).toContain('Next match');
    expect(html).toContain('Tractor');
    expect(html).toContain('Esteghlal');
    expect(html).toContain('17:00');
    expect(html).toContain('Tehran time');
    expect(html).toContain('dixon-coles-elo<span>@</span>0.6.0');
    expect(html).toContain('data-state="listed"');
    expect(html).toContain('<bdi>IRIB TV3</bdi>');
    expect(html).toContain('<bdi>Telewebion</bdi>');
    expect(html.match(/data-icon="external"/g)).toHaveLength(2);
  });

  it('says so when there is no forecast yet, or nobody answered about viewing', () => {
    const html = card({ state: 'none' }, null);
    expect(html).toContain('No model forecast for this match yet.');
    expect(html).not.toContain('role="img"');
    expect(html).toMatch(/data-testid="next-match-watch" data-state="unreachable"/);
  });

  it('in Persian: the words, the zone and the digits are Persian', () => {
    const html = card(AVAILABLE, VIEWING, 'fa');
    expect(html).toContain('بازی بعدی');
    expect(html).toContain('به وقت تهران');
    expect(html).toContain('۱۷:۰۰');
  });
});
