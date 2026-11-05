import type { CommunityConsensusResponse, MatchViewing, TeamFixture } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CardForecast } from '@/lib/score-card-products';
import { CommunityForecastPanel, CommunitySplit } from './community-consensus';
import { NextMatchCard } from './next-match-card';

/**
 * The Hybrid design's shared data atoms (T-1388, D-206) not yet rebuilt to
 * the Design System, each in its states: the community spread and the
 * next-match card -- in English and in Persian, where the reading order
 * turns round and the digits are Persian. The pick is the pick control's
 * (`pick-control.spec.tsx`, T-1738) on every page since T-1739. The
 * coverage badge, the freshness stamp and the link-out have their own specs
 * (T-1493), and so do the forecast bar, the receipt and the match row
 * (T-1508) and the three voices (T-1509).
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

  it('asks for the viewing country with a 44px target on a phone (T-1608)', () => {
    const asked = {
      ...VIEWING,
      territory: { state: 'not_chosen' },
    } as unknown as MatchViewing;
    const link = /<a[^>]*href="\/en\/match\/[^"]*#watch"[^>]*>/.exec(card(AVAILABLE, asked))?.[0];
    expect(link).toContain('max-md:min-h-touch');
  });

  it('in Persian: the words, the zone and the digits are Persian', () => {
    const html = card(AVAILABLE, VIEWING, 'fa');
    expect(html).toContain('بازی بعدی');
    expect(html).toContain('به وقت تهران');
    expect(html).toContain('۱۷:۰۰');
  });
});
