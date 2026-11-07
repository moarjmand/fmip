import type {
  FixtureEvaluationsResponse,
  ForecastVersion,
  ForecastVersionsResponse,
  MatchCentre,
  MatchIncident,
  MatchLineupPlayer,
} from '@fmip/contracts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EN } from '@/i18n/messages';
import { matchWords } from '@/lib/words-server';
import {
  ForecastDetails,
  ForecastReality,
  cardVersion,
  leadTime,
  receipt,
} from '../app/[locale]/match/[id]/forecast-reality';
import { ForecastPanel } from './forecast-panel';
import { MatchCentreView, ratingsOf } from './match-centre-view';
import { Translated } from './translated';
import { scoreDisputeHero } from './score-dispute';
import { matchJsonLd } from '@/lib/seo';
import { MatchLineupsView } from './match-lineups';

/**
 * The Stadiomind match centre (T-1497): the Summary's "what was forecast,
 * what happened" card with every version and its receipt, the live states
 * ("Not in yet", the badge, a feed that has fallen behind), the timeline's
 * axis, the ratings on the pitch and the best rated.
 */

const KICKOFF = '2026-10-24T11:30:00.000Z';

const version = (
  n: number,
  computedAt: string,
  p: ForecastVersion['probabilities'] = { home: 0.211, draw: 0.248, away: 0.541 },
): ForecastVersion => ({
  id: `v${n}`,
  fixture_id: 'f1',
  version_number: n,
  kind: n === 3 ? 'lineups_confirmed' : 'early',
  model_version: 'dixon-coles-elo@0.6.0',
  computed_at: computedAt,
  status: p === null ? 'unavailable' : 'available',
  probabilities: p,
  expected_goals: p === null ? null : { home: 1.11, away: 1.87 },
  most_likely_scorelines:
    p === null
      ? null
      : [
          { home: 1, away: 1, probability: 0.117 },
          { home: 1, away: 2, probability: 0.099 },
          { home: 0, away: 2, probability: 0.089 },
          { home: 0, away: 1, probability: 0.083 },
          { home: 0, away: 0, probability: 0.062 },
        ],
  leading_factors: null,
  data_completeness: 'available',
  inputs: {
    model_version: 'dixon-coles-elo@0.6.0',
    fit_date: '2026-10-23',
    matches_used: 1120,
    elo_used: true,
    history_from: '2023-10-01',
    data_completeness: 'available',
  },
  unavailable_reason: p === null ? 'model_unreachable' : null,
  unavailable_detail: null,
});

// Sent out of order on purpose: the card lists them by number.
const versions = [
  version(3, '2026-10-24T11:03:00.000Z'),
  version(1, '2026-10-17T11:32:00.000Z', { home: 0.224, draw: 0.251, away: 0.525 }),
  version(2, '2026-10-18T11:35:00.000Z', null),
];
const forecasts: ForecastVersionsResponse = {
  fixture_id: 'f1',
  coverage: 'available',
  last_updated_at: '2026-10-24T11:03:00.000Z',
  latest: versions[0] ?? null,
  versions,
};
const team = (id: string, name: string) => ({
  id,
  name,
  short_name: null,
  code: null,
  formation: '4-4-2',
  coach: null,
});
const fixture = (status: 'scheduled' | 'live' | 'finished') => ({
  status,
  kickoff_at: KICKOFF,
  home: team('h', 'Aston Villa'),
  away: team('a', 'Manchester City'),
});

const card = (
  status: 'scheduled' | 'live' | 'finished',
  over: {
    forecasts?: ForecastVersionsResponse | null;
    evaluations?: FixtureEvaluationsResponse | null;
    final?: { home: number; away: number } | null;
    matchXg?: { home: number; away: number } | null;
    locale?: string;
  } = {},
) =>
  renderToStaticMarkup(
    <ForecastReality
      forecasts={over.forecasts === undefined ? forecasts : over.forecasts}
      evaluations={over.evaluations ?? null}
      fixture={fixture(status)}
      final={
        over.final === undefined
          ? status === 'finished'
            ? { home: 2, away: 1 }
            : null
          : over.final
      }
      matchXg={over.matchXg === undefined ? { home: 0.6, away: 1.53 } : over.matchXg}
      timeZone="Europe/London"
      locale={over.locale ?? 'en'}
    />,
  );

describe('what was forecast, what happened (the Summary card)', () => {
  it('after full time sets the version from before kick-off against the result, the outcome outlined, ticked and named', () => {
    const html = card('finished');
    expect(html).toContain('What was forecast, what happened');
    // The one bar at headline size (T-1748, D-368).
    const bar = /data-testid="outcome-bar"[^]*?<\/div><\/div>/.exec(html)?.[0] ?? '';
    expect(bar).toContain('data-size="headline"');
    expect(bar).toContain('data-outcome-happened="home"');
    // The home win happened: a tick before its number, the word after its
    // name, an ink outline round its segment -- and no saffron (T-1749, D-369).
    expect(bar).toMatch(
      /data-outcome="home" data-happened=""[^]*?data-icon="check"[^]*?<span dir="ltr"[^>]*>21\.1%<\/span>[^]*?<bdi>Aston Villa<\/bdi><span class="[^"]*" data-happened-word="">· happened<\/span>/,
    );
    expect(bar).toMatch(
      /data-segment="home" data-step="3" data-happened="" class="bg-model\/50 [^"]*outline-2 outline-offset-1 outline-fg/,
    );
    // The steps follow rank: Manchester City, the likeliest, is the full
    // turquoise although it is the away side and did not win.
    expect(bar).toMatch(/data-segment="away" data-step="1" class="bg-model /);
    expect(bar).toMatch(/data-segment="draw" data-step="2" class="bg-model\/75 /);
    expect(bar).not.toMatch(/bg-accent|text-accent|bg-brand/);
    expect(bar).toContain(
      'aria-label="Model forecast: Aston Villa 21.1% (happened), draw 24.8%, Manchester City 54.1%"',
    );
    // The word is written once on the page: on the headline, not in the version list.
    expect(html.match(/data-happened-word/g)).toHaveLength(1);
    // What happened against what the model gave it, in the card (T-1744).
    expect(html).toContain('data-testid="forecast-reality-result"');
    expect(html).toContain('The model gave it 21.1%.');
  });

  it('sets the model’s expected goals beside the match’s xG and the goals', () => {
    const html = card('finished');
    expect(html).toMatch(
      /Model, before kick-off<\/dt><dd class="[^"]*text-model[^"]*">⁦1\.11 – 1\.87/,
    );
    expect(html).toMatch(/Chances created \(match xG\)<\/dt><dd[^>]*>⁦0\.60 – 1\.53/);
    expect(html).toMatch(/Goals<\/dt><dd class="[^"]*text-accent[^"]*">⁦2 – 1/);
    // A match xG the feed did not send is said, never a 0.00.
    expect(card('finished', { matchXg: null })).toMatch(
      /Chances created \(match xG\)<\/dt><dd[^>]*>not supplied/,
    );
  });

  it('says whether the score was among the five likeliest', () => {
    expect(card('finished')).toContain('2–1⁩ was not among them.');
    expect(card('finished', { final: { home: 1, away: 1 } })).toContain('1–1⁩ was among them.');
  });

  it('lists every version by its number, each as computed, the one it is about marked (rule 5)', () => {
    const html = card('finished');
    const rows = [...html.matchAll(/data-version="(\d)"/g)].map((m) => m[1]);
    expect(rows).toEqual(['1', '2', '3']);
    expect(html).toMatch(/data-version="3" data-current=""/);
    // Each row its own figures: v1 as it was, never re-drawn from v3.
    const first = /data-version="1"[^]*?(?=data-version="2")/.exec(html)?.[0] ?? '';
    expect([...first.matchAll(/<span dir="ltr"[^>]*>([^<]+)<\/span>/g)].map((m) => m[1])).toEqual([
      '22.4%',
      '25.1%',
      '52.5%',
    ]);
    // The one bar at row size with a label on each segment (T-1748): the
    // order no longer has to be known, the names are there where they fit.
    expect(first).toContain('data-testid="version-bar"');
    expect(first).toContain('data-size="row"');
    expect(first).toMatch(
      /<bdi>Aston Villa<\/bdi>[^]*<span>Draw<\/span>[^]*<bdi>Manchester City<\/bdi>/,
    );
    expect(first).toContain('aria-label="Model forecast: Aston Villa 22.4% (happened), draw 25.1%');
    // What happened is marked on every version that gave figures (T-1749).
    expect(html.match(/data-testid="version-bar"/g)).toHaveLength(2);
    expect(html.match(/data-segment="home" data-step="3" data-happened=""/g)).toHaveLength(3);
    expect(html).not.toMatch(/bg-model\/(55|25)|bg-accent/);
    // A version that gave no figures says why.
    expect(html).toMatch(/data-version="2"[^]*The model service could not be reached/);
    // The card renders the stored rows and never changes them.
    expect(versions.map((v) => v.version_number)).toEqual([3, 1, 2]);
  });

  it('carries the receipt: model, version, time, lead, kind and what it was fitted on', () => {
    const html = card('finished');
    // The `@` set apart: no "name@x.y.z" run for Cloudflare to rewrite (T-1580).
    expect(html).not.toMatch(/\S+@\d+\.\d+\.\d+/);
    expect(html.replace(/<[^>]+>/g, '')).toContain(
      'dixon-coles-elo@0.6.0 · v3 computed 24 Oct, 12:03 UK time, 27 min before kick-off · Confirmed line-ups · fitted 23 Oct on 1,120 matches since Oct 2023 · Elo prior on · inputs complete',
    );
  });

  it('while the match is on, shows the forecast from before kick-off, fixed', () => {
    const html = card('live');
    expect(html).toContain('Before kick-off');
    expect(html).not.toContain('data-happened');
    expect(html).toContain('fixed at kick-off, not changed during play');
    expect(html).not.toContain('Chances created');
  });

  it('before kick-off shows the latest; with none, or no answer, says so (rule 3)', () => {
    expect(card('scheduled')).toContain('Model forecast');
    expect(card('scheduled')).toMatch(/v3 computed 24 Oct, 12:03 UK time/);
    const none = { ...forecasts, latest: null, versions: [] };
    expect(card('scheduled', { forecasts: none })).toContain(EN['forecast.none']);
    expect(card('finished', { forecasts: none })).toContain(EN['forecastBar.noneBefore']);
    expect(card('finished', { forecasts: null })).toContain(EN['forecast.unreachable']);
    expect(card('finished', { forecasts: null })).not.toContain('data-testid="receipt"');
  });

  it('with no version answered, says why once: no version list, no receipt, no placeholder (T-1524)', () => {
    const none = {
      ...version(1, '2026-10-17T11:32:00.000Z', null),
      model_version: 'none@0.0.0',
      inputs: null,
      unavailable_reason: 'competition_not_mapped' as const,
    };
    const unanswered = { ...forecasts, latest: none, versions: [none] };
    const html = card('finished', { forecasts: unanswered });
    expect(html).toContain('data-testid="forecast-reality-unavailable"');
    // The reason once, in the card's sentence.
    expect(
      html.replaceAll('&#x27;', "'").split(EN['forecast.reason.competitionNotMapped']).length - 1,
    ).toBe(1);
    expect(html).not.toContain('data-testid="forecast-versions-list"');
    expect(html).not.toContain('data-testid="receipt"');
    expect(html).not.toContain('none@');
    // One answered version among unanswered ones: the list stays, every version in it.
    const mixed = { ...forecasts, versions: [none, version(2, '2026-10-18T11:35:00.000Z')] };
    expect(card('finished', { forecasts: mixed })).toContain(
      'data-testid="forecast-versions-list"',
    );
  });

  it('a later version without numbers does not unsay an earlier forecast (rule 3)', () => {
    // v1 gave probabilities; the model could not be reached for v2, which is
    // the latest. The match has a forecast: the card keeps its title, says why
    // this version has no numbers, and does not claim "No model forecast".
    const failed = {
      ...version(2, '2026-10-18T11:35:00.000Z', null),
      unavailable_reason: 'model_unreachable' as const,
    };
    const later = {
      ...forecasts,
      latest: failed,
      versions: [version(1, '2026-10-17T11:32:00.000Z'), failed],
    };
    const html = card('scheduled', { forecasts: later });
    expect(html).toContain('data-state="unavailable"');
    expect(html).toContain('Model forecast');
    expect(html).not.toContain(EN['matchCentre.noForecast.title']);
    expect(html).not.toContain('data-testid="forecast-coverage-link"');
    expect(html).not.toContain('data-testid="forecast-reality-no-power"');
    expect(html).toContain('data-testid="forecast-reality-unavailable"');
    expect(html).not.toContain('data-testid="outcome-bar"');
    // With no version that gave numbers, the card does say so, once.
    const only = { ...forecasts, latest: failed, versions: [failed] };
    const none = card('scheduled', { forecasts: only });
    expect(none).toContain('data-state="none"');
    expect(none).toContain(EN['matchCentre.noForecast.title']);
    expect(none).toContain('data-testid="forecast-coverage-link"');
  });

  it('picks the scored version, else the last before kick-off, else the latest before it starts', () => {
    const scored: FixtureEvaluationsResponse = {
      fixture_id: 'f1',
      coverage: 'available',
      last_updated_at: null,
      evaluations: [{ version_number: 1, pre_kickoff: true } as never],
    };
    expect(cardVersion(forecasts, scored, 'finished', KICKOFF)?.version_number).toBe(1);
    expect(
      cardVersion(forecasts, null, 'finished', '2026-10-20T00:00:00.000Z')?.version_number,
    ).toBe(2);
    expect(cardVersion(forecasts, null, 'scheduled', KICKOFF)?.version_number).toBe(3);
  });

  it('says how long before kick-off in minutes, hours or days', () => {
    expect(leadTime('en', '2026-10-24T11:03:00.000Z', KICKOFF)).toBe('27 min before kick-off');
    expect(leadTime('en', '2026-10-23T11:30:00.000Z', KICKOFF)).toBe('24 h before kick-off');
    expect(leadTime('en', '2026-10-17T11:32:00.000Z', KICKOFF)).toBe('6 days before kick-off');
    expect(leadTime('en', '2026-10-24T12:00:00.000Z', KICKOFF)).toBe('after kick-off');
  });

  it('says it in Persian with Persian digits', () => {
    const html = card('finished', { locale: 'fa' });
    expect(html).toContain('آنچه پیش‌بینی شد و آنچه رخ داد');
    expect(html).toContain('۲۷ دقیقه پیش از شروع بازی');
    expect(html).toContain('۱٬۱۲۰');
    expect(html).not.toContain('data-translation="untranslated"');
    // The receipt's time and lead joined by the Persian comma, not a Latin one (T-1554).
    expect(html.replace(/<[^>]+>/g, '')).toContain('، ۲۷ دقیقه پیش از شروع بازی');
  });

  it('names no model on the receipt of a version no model answered (T-1554)', () => {
    const none = {
      ...version(2, '2026-10-18T11:35:00.000Z', null),
      model_version: 'none@0.0.0',
      inputs: null,
    };
    const text = receipt('en', none, KICKOFF, 'Europe/London', false);
    expect(text).not.toContain('none@');
    expect(text).toMatch(/^v2 computed 18 Oct, 12:35 UK time, 5 days before kick-off · /);
  });

  it('is the model’s card alone: no founder, no community', () => {
    expect(card('finished')).not.toMatch(/founder|community/i);
  });
});

// ---------------------------------------------------------------------------
// The forecast once on the page (T-1744, D-365)
// ---------------------------------------------------------------------------

describe('the forecast is drawn once: headline, details, and why (T-1744)', () => {
  const details = (status: 'scheduled' | 'live' | 'finished', f = forecasts, locale = 'en') =>
    renderToStaticMarkup(
      <ForecastDetails
        forecasts={f}
        evaluations={null}
        fixture={fixture(status)}
        matchXg={null}
        timeZone="Europe/London"
        locale={locale}
      />,
    );
  const factored: ForecastVersionsResponse = {
    ...forecasts,
    versions: versions.map((v) =>
      v.version_number === 3
        ? {
            ...v,
            leading_factors: [
              { factor: 'team_strength', favours: 'away', magnitude: 0.4, note: 'n' },
              { factor: 'home_advantage', favours: 'home', magnitude: 0.2, note: 'n' },
            ],
          }
        : v,
    ),
  };
  const scored: FixtureEvaluationsResponse = {
    fixture_id: 'f1',
    coverage: 'available',
    last_updated_at: '2026-10-24T14:00:00.000Z',
    evaluations: [
      {
        id: 'e1',
        forecast_id: 'v3',
        fixture_id: 'f1',
        version_number: 3,
        kind: 'lineups_confirmed',
        model_version: 'dixon-coles-elo@0.6.0',
        computed_at: '2026-10-24T11:03:00.000Z',
        evaluated_at: '2026-10-24T14:00:00.000Z',
        pre_kickoff: true,
        actual: { home: 2, away: 1 },
        outcome: 'home',
        p_outcome: 0.211,
        log_loss: 1.556,
        brier: 0.977,
        rps: 0.4577,
        correct: false,
        scoreline_hit: false,
      },
    ],
  };
  const how = (
    f: ForecastVersionsResponse | null = factored,
    e: FixtureEvaluationsResponse | null = scored,
    locale = 'en',
  ) =>
    renderToStaticMarkup(
      <ForecastPanel
        forecasts={f}
        evaluations={e}
        about={f === null ? null : (f.versions.find((v) => v.version_number === 3) ?? null)}
        home="Aston Villa"
        away="Manchester City"
        timeZone="Europe/London"
        locale={locale}
      />,
    );

  it('before kick-off the card is the headline: title, bar and one receipt line', () => {
    const html = card('scheduled');
    expect(html).toContain('data-part="headline"');
    expect(html).toContain('Model forecast');
    expect(html).toContain('data-testid="outcome-bar"');
    expect(html.replace(/<[^>]+>/g, '')).toContain(
      'dixon-coles-elo@0.6.0 · v3 computed 24 Oct, 12:03 UK time',
    );
    // A phone's line is the model and the version alone, so it stays one
    // line and the pick's outcomes fit on the first screen (board P2-4);
    // each width draws one of the two.
    expect(html).toMatch(
      /<span class="md:hidden" data-testid="receipt-brief">dixon-coles-elo<span>@<\/span>0\.6\.0 · v3<\/span><span class="max-md:hidden">/,
    );
    // The rest follows the pick, in the details card.
    expect(html).not.toContain('data-testid="reality-goals"');
    expect(html).not.toContain('data-testid="reality-scorelines"');
    expect(html).not.toContain('data-testid="forecast-versions-list"');
    expect(html).not.toContain('data-testid="receipt"');
    expect(html).not.toContain('data-testid="forecast-why-link"');
    expect(html).not.toContain('frozen at kick-off');
  });

  it('the details card holds the rest: nothing is removed, only reordered', () => {
    const html = details('scheduled');
    expect(html).toContain('data-testid="forecast-details"');
    expect(html).toContain('Forecast details');
    expect(html).toContain('data-testid="reality-goals"');
    expect(html).toContain('data-testid="reality-scorelines"');
    expect([...html.matchAll(/data-version="(\d)"/g)].map((m) => m[1])).toEqual(['1', '2', '3']);
    expect(html.replace(/<[^>]+>/g, '')).toContain(
      'dixon-coles-elo@0.6.0 · v3 computed 24 Oct, 12:03 UK time, 27 min before kick-off · Confirmed line-ups',
    );
    expect(html).toMatch(/href="#forecast"[^>]*data-testid="forecast-why-link"/);
    // The bar is the headline's: drawn once.
    expect(html).not.toContain('data-testid="outcome-bar"');
    // Headline and details together draw the bar once and each version once.
    const both = card('scheduled') + html;
    expect(both.split('data-testid="outcome-bar"').length - 1).toBe(1);
    expect(both.split('data-version="3"').length - 1).toBe(1);
  });

  it('there is no details card from kick-off on, nor when no version gave probabilities', () => {
    expect(details('live')).toBe('');
    expect(details('finished')).toBe('');
    const none = { ...forecasts, latest: null, versions: [] };
    expect(details('scheduled', none)).toBe('');
    const unanswered = { ...forecasts, versions: [version(1, '2026-10-17T11:32:00.000Z', null)] };
    expect(details('scheduled', unanswered)).toBe('');
  });

  it('from kick-off on the card is whole, says it is frozen, and links to why', () => {
    for (const status of ['live', 'finished'] as const) {
      const html = card(status);
      expect(html).toContain('data-part="whole"');
      expect(html).toContain('Pre-match forecast, frozen at kick-off.');
      expect(html).toContain('data-testid="reality-goals"');
      expect(html).toContain('data-testid="forecast-versions-list"');
      expect(html).toContain('data-testid="receipt"');
      expect(html).toMatch(/href="#forecast"[^>]*data-testid="forecast-why-link"/);
    }
    // The result sentence is full time's alone.
    expect(card('live')).not.toContain('data-testid="forecast-reality-result"');
  });

  it('after full time carries the result sentence and the match’s RPS, from the stored evaluation', () => {
    const html = card('finished', { evaluations: scored });
    expect(html.replace(/<[^>]+>/g, '')).toContain(
      'Result: ⁨Aston Villa⁩ win. The model gave it 21.1%. Ranked probability score for this match 0.458 (0 is perfect).',
    );
    expect(html).toContain('One match says little: the model&#x27;s record');
    expect(html).toMatch(/<a [^>]*href="\/en\/model-accuracy"[^>]*>One match says little/);
    // Not scored yet is said, never a number.
    const unscored = card('finished');
    expect(unscored).toContain(EN['forecast.verdict.unscored']);
    expect(unscored).not.toContain('data-testid="forecast-reality-rps"');
  });

  it('the lower section says only why: no bar, no percentages, no version list of figures', () => {
    const html = how();
    expect(html).toContain('data-voice="model"');
    expect(html).toContain('How the forecast was reached');
    // One line points to the summary.
    expect(html).toMatch(
      /data-testid="forecast-pointer">The forecast and every version are in <a href="#summary"[^>]*>the summary<\/a>; this section only says why\./,
    );
    expect(html).toContain('data-testid="leading-factors"');
    expect(html).toContain('favours Manchester City');
    expect(html).toContain('data-testid="forecast-versions"');
    // Nothing the summary's card draws is drawn again.
    expect(html).not.toContain('data-testid="outcome-bar"');
    expect(html).not.toContain('data-testid="probabilities"');
    expect(html).not.toContain('data-testid="forecast-latest"');
    expect(html).not.toContain('data-testid="forecast-meta"');
    expect(html).not.toContain('bg-model');
    for (const share of ['21.1%', '24.8%', '54.1%', '22.4%', '25.1%', '52.5%']) {
      // The evaluation states what the scored version gave the outcome, once.
      expect(html.split(share).length - 1, share).toBe(share === '21.1%' ? 1 : 0);
    }
    expect(html).not.toMatch(/Expected goals|Most likely scores/);
  });

  it('says the evaluation in plain words, and a verdict only where both scores agree', () => {
    const worse = how();
    expect(worse).toContain(
      'Both numbers measure how much probability the model put on what really happened.',
    );
    expect(worse).toContain('data-against-uniform="worse"');
    expect(worse).toContain('Here both are worse than knowing nothing.');
    const evaluation = scored.evaluations[0];
    if (evaluation === undefined) throw new Error('fixture');
    const better = how(factored, {
      ...scored,
      evaluations: [{ ...evaluation, log_loss: 0.6, brier: 0.3 }],
    });
    expect(better).toContain('Here both are better than knowing nothing.');
    // Log loss above the uniform line, Brier below it: no verdict is written.
    const mixed = how(factored, {
      ...scored,
      evaluations: [{ ...evaluation, log_loss: 1.2, brier: 0.6 }],
    });
    expect(mixed).toContain('data-against-uniform="mixed"');
    expect(mixed).not.toMatch(/Here both are/);
  });

  it('is not rendered when there is nothing to explain: the summary has said so once', () => {
    expect(how(null, null)).toBe('');
    const unanswered = {
      ...forecasts,
      versions: [{ ...version(3, '2026-10-24T11:03:00.000Z', null) }],
    };
    expect(how(unanswered, null)).toBe('');
  });

  it('says all of it in Persian', () => {
    for (const html of [how(factored, scored, 'fa'), details('scheduled', forecasts, 'fa')]) {
      expect(html).not.toContain('data-translation="untranslated"');
    }
    expect(how(factored, scored, 'fa')).toContain('پیش‌بینی چگونه به دست آمد');
    expect(card('finished', { evaluations: scored, locale: 'fa' })).toContain('۰٫۴۵۸');
  });
});

// ---------------------------------------------------------------------------
// "No forecast", said once (T-1746, D-367)
// ---------------------------------------------------------------------------

describe('no forecast is said once, in the Summary’s card (T-1746)', () => {
  const none = { ...forecasts, latest: null, versions: [] };
  const unmapped = {
    ...version(1, '2026-10-17T11:32:00.000Z', null),
    model_version: 'none@0.0.0',
    inputs: null,
    unavailable_reason: 'competition_not_mapped' as const,
  };
  const unanswered = { ...forecasts, latest: unmapped, versions: [unmapped] };
  const noForecast = (
    status: 'scheduled' | 'live' | 'finished',
    f: ForecastVersionsResponse,
    noPowerIndex = false,
    locale = 'en',
  ) =>
    renderToStaticMarkup(
      <ForecastReality
        forecasts={f}
        evaluations={null}
        fixture={fixture(status)}
        final={status === 'finished' ? { home: 1, away: 1 } : null}
        matchXg={null}
        timeZone="Europe/London"
        locale={locale}
        noPowerIndex={noPowerIndex}
      />,
    );

  it('is one card: the title, the stored reason and one link', () => {
    const html = noForecast('finished', none);
    expect(html).toContain('data-state="none"');
    expect(html).toMatch(/<h2[^>]*>.*Model<\/span>.*No model forecast for this match/);
    // The state as an icon and a word.
    expect(html).toMatch(/data-coverage-badge="not_supplied"[^]*<svg[^]*No forecast/);
    expect(html).toContain(EN['forecastBar.noneBefore']);
    expect(html).toMatch(
      /<a [^>]*href="\/en\/model-accuracy"[^>]*>.*Which competitions does the model cover\?/,
    );
    expect(html.split('href="/en/model-accuracy"').length - 1).toBe(1);
    // The old titles are not kept over an empty card.
    expect(html).not.toContain('What was forecast, what happened');
    // Nothing that would look like a forecast (rule 3).
    for (const id of ['outcome-bar', 'receipt', 'forecast-versions-list', 'forecast-why-link']) {
      expect(html).not.toContain(`data-testid="${id}"`);
    }
    expect(html).not.toMatch(/\d%/);
  });

  it('never says "yet" of a match that has kicked off', () => {
    expect(noForecast('scheduled', none)).toContain(EN['forecast.none']);
    for (const status of ['live', 'finished'] as const) {
      const html = noForecast(status, none);
      expect(html).not.toContain(EN['forecast.none']);
      expect(html).toContain(EN['forecastBar.noneBefore']);
    }
  });

  it('gives the stored reason when a version says why it could not answer', () => {
    const html = noForecast('finished', unanswered).replaceAll('&#x27;', "'");
    expect(html).toContain('data-testid="forecast-reality-unavailable"');
    expect(html.split(EN['forecast.reason.competitionNotMapped']).length - 1).toBe(1);
    expect(html).toContain('No model forecast for this match');
    expect(html).not.toContain('none@');
  });

  it('says there is no Power Index either only when the page knows there is none', () => {
    expect(noForecast('finished', none, true)).toMatch(
      /data-testid="forecast-reality-no-power"> .*There is no Power Index for it either\./,
    );
    expect(noForecast('finished', none)).not.toContain('Power Index');
    // A match with a forecast never says it, whatever it is handed.
    const withForecast = renderToStaticMarkup(
      <ForecastReality
        forecasts={forecasts}
        evaluations={null}
        fixture={fixture('finished')}
        final={{ home: 2, away: 1 }}
        matchXg={null}
        timeZone="Europe/London"
        locale="en"
        noPowerIndex
      />,
    );
    expect(withForecast).not.toContain('Power Index');
    expect(withForecast).not.toContain('No model forecast');
  });

  it('a service that did not answer is not "no forecast"', () => {
    const html = card('finished', { forecasts: null });
    expect(html).toContain('data-state="unreachable"');
    expect(html).not.toContain('No model forecast for this match');
    expect(html).not.toContain('data-testid="forecast-coverage-link"');
  });

  it('the page draws no second statement: no lower section and no Power Index block', () => {
    // The lower section is not rendered with nothing to explain (T-1744) ...
    expect(
      renderToStaticMarkup(
        <ForecastPanel
          forecasts={none}
          evaluations={null}
          about={null}
          home="Aston Villa"
          away="Manchester City"
          timeZone="Europe/London"
          locale="en"
        />,
      ),
    ).toBe('');
    // ... and the page leaves the Power Index block out when the card has
    // said there is none: one rule, in the page, read here from its source.
    const page = readFileSync(
      join(__dirname, '..', 'app', '[locale]', 'match', '[id]', 'page.tsx'),
      'utf8',
    );
    expect(page).toMatch(
      /const noPowerIndex =\s+forecastData !== null &&\s+!hasForecast\(forecastData\) &&\s+powerData !== null &&\s+powerData\.index === null;/,
    );
    expect(page).toContain('noPowerIndex={noPowerIndex}');
    expect(page).toMatch(/forecast: noPowerIndex \? null : \(/);
    expect(page.split('<PowerIndexPanel').length - 1).toBe(1);
  });

  it('says it in Persian', () => {
    const html = noForecast('finished', none, true, 'fa');
    expect(html).toContain('این بازی پیش‌بینی مدل آماری ندارد');
    expect(html).toContain('شاخص قدرت هم برای آن وجود ندارد.');
    expect(html).toContain('مدل کدام رقابت‌ها را پوشش می‌دهد؟');
    expect(html).not.toContain('data-translation="untranslated"');
  });
});

// ---------------------------------------------------------------------------
// The live match centre
// ---------------------------------------------------------------------------

const empty = { coverage: 'not_supplied' as const, last_updated_at: null, data: null };
const incident = (
  minute: number,
  kind: MatchIncident['kind'],
  side: 'home' | 'away',
  name: string,
): MatchIncident => ({
  id: `${kind}-${minute}`,
  sequence: minute,
  minute,
  added_time: null,
  kind,
  side,
  player: { id: `p-${name}`, name },
  related_player: null,
  detail: null,
});
const centre = (over: Partial<MatchCentre['fixture']> = {}, rest: Partial<MatchCentre> = {}) =>
  ({
    fixture: {
      id: 'f1',
      kickoff_at: KICKOFF,
      status: 'live',
      minute: 11,
      competition: { id: 'c', name: 'Serie A', short_name: null, country_id: null },
      season: { id: 's', label: '2026/27' },
      stage: null,
      round: null,
      group_name: null,
      leg: null,
      home: team('h', 'Lazio'),
      away: team('a', 'Parma'),
      scores: {
        current: { home: 0, away: 0 },
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
      last_updated_at: '2026-10-24T11:41:00.000Z',
      freshness: null,
      ...over,
    },
    timeline: { coverage: 'available', last_updated_at: null, data: [] },
    statistics: empty,
    lineups: empty,
    availability: empty,
    player_statistics: empty,
    player_expected_goals: { ...empty, source: 'highlightly', unplaced: 0 },
    form: { home: empty, away: empty },
    head_to_head: empty,
    coverage: {
      scores: 'available',
      incidents: 'available',
      lineups: 'available',
      statistics: 'available',
      standings: 'available',
      availability: 'available',
      advanced_statistics: 'not_supplied',
    },
    ...rest,
  }) as MatchCentre;
const view = (c: MatchCentre, now?: number, locale = 'en') =>
  renderToStaticMarkup(
    <MatchCentreView
      words={matchWords(locale)}
      centre={c}
      timeZone="Europe/London"
      locale={locale}
      now={now}
    />,
  );
const section = (html: string, testId: string) => {
  const start = html.indexOf(`data-testid="${testId}"`);
  return html.slice(start, html.indexOf('</section>', start));
};

describe('live', () => {
  it('says "Not in yet" for statistics the feed has not sent, and that nothing is estimated', () => {
    const stats = section(view(centre()), 'statistics');
    expect(stats).toContain('data-testid="not-in-yet"');
    expect(stats).toContain('Not in yet');
    expect(stats).toContain(EN['matchCentre.notInYetWhy']);
    expect(stats).not.toContain('data-coverage-badge');
    // After full time the same gap is the coverage state, not a wait.
    const done = section(
      view(
        centre({
          status: 'finished',
          minute: null,
          scores: { ...centre().fixture.scores, full_time: { home: 0, away: 0 } },
        }),
      ),
      'statistics',
    );
    expect(done).not.toContain('not-in-yet');
    expect(done).toContain('data-coverage-badge="not_supplied"');
  });

  it('carries the live badge, the minute along the match and the freshness stamp', () => {
    const html = view(centre(), Date.parse('2026-10-24T11:41:10.000Z'));
    expect(html).toMatch(/data-testid="live-badge" data-live="true"><span data-live-badge=""/);
    expect(html).toMatch(/inline-size:12\.2/);
    expect(html).not.toContain('data-testid="feed-behind"');
  });

  it('says "HT" at the half-time interval, never a minute that looks stalled (T-1551)', () => {
    const at = Date.parse('2026-10-24T11:41:10.000Z');
    const html = view(centre({ minute: 45, at_half_time: true }), at);
    expect(html).toMatch(/data-testid="match-status">HT</);
    expect(html).not.toMatch(/data-testid="match-status">45′</);
    // The second half: the minute again.
    expect(view(centre({ minute: 46, at_half_time: false }), at)).toMatch(
      /data-testid="match-status">46′</,
    );
    // Persian.
    const fa = view(centre({ minute: 45, at_half_time: true }), at, 'fa');
    expect(fa).not.toMatch(/data-testid="match-status">[۴4][۵5]/);
  });

  it('heads a match after extra time with its result, the ninety minutes and the shoot-out beside it (T-1665)', () => {
    // Manresa v Sant Andreu, Copa del Rey 2026-10-27: 0-0 at ninety, 2-2 after extra time, 1-4 on penalties.
    const scores = {
      current: { home: 2, away: 2 },
      half_time: { home: 0, away: 0 },
      full_time: { home: 0, away: 0 },
      extra_time: { home: 2, away: 2 },
      penalties: { home: 1, away: 4 },
      aggregate: null,
    };
    const html = view(centre({ status: 'finished', minute: null, scores }));
    const text = html.replace(/<[^>]+>/g, '');
    expect(text).toMatch(/2–2/);
    expect(text).toContain('Pens 1–4 · 90′ 0–0 · HT 0–0');
    // Without extra time no ninety-minute line.
    const ft = view(
      centre({
        status: 'finished',
        minute: null,
        scores: { ...scores, extra_time: null, penalties: null, current: { home: 0, away: 0 } },
      }),
    );
    expect(ft).not.toContain('data-testid="ninety"');
    // Persian.
    const fa = view(centre({ status: 'finished', minute: null, scores }), undefined, 'fa');
    expect(fa).toContain('۹۰ دقیقه');
  });

  it('says a scheduled match long past its kick-off is awaiting an update, never to come (T-1708, D-343)', () => {
    // Rangers v Aberdeen, still "scheduled" two days after its kick-off (aud-2026-11-01-01).
    const scheduled = {
      status: 'scheduled' as const,
      minute: null,
      scores: { ...centre().fixture.scores, current: null },
    };
    const late = centre({ ...scheduled, freshness: 'awaiting_update' });
    const after = Date.parse('2026-10-26T11:30:00.000Z');
    // The page hands the band the notice (`page.tsx`); the stream's line is a marker here.
    const notice = (locale: string) => (
      <p data-testid="awaiting-update">
        <Translated locale={locale} message="matchCentre.awaitingUpdate" />
      </p>
    );
    const band = (c: MatchCentre, locale = 'en') =>
      renderToStaticMarkup(
        <MatchCentreView
          words={matchWords(locale)}
          centre={c}
          timeZone="Europe/London"
          locale={locale}
          now={after}
          hero={{ awaiting: notice(locale), live: <span data-testid="live-state" /> }}
        />,
      );
    const html = band(late);
    expect(html).toContain('data-testid="awaiting-update"');
    expect(html).toContain(EN['matchCentre.awaitingUpdate']);
    // The kick-off time is not the band's figure: a dash, no score invented.
    expect(html).not.toMatch(/data-testid="match-status">12:30</);
    expect(html).toMatch(/data-testid="score">–</);
    // No "last checked": our check is not news of the match.
    expect(html).not.toContain('data-testid="live-state"');
    // Without the notice it is a match to come, its kick-off time the figure.
    const coming = view(centre(scheduled), Date.parse(KICKOFF) - 60_000);
    expect(coming).not.toContain('awaiting-update');
    expect(coming).toMatch(/data-testid="match-status">12:30</);
    // Once a snapshot brings what happened, the notice goes.
    const done = band(centre({ status: 'finished', minute: null }));
    expect(done).not.toContain('awaiting-update');
    expect(band(centre({ status: 'postponed', minute: null }))).not.toContain('awaiting-update');
    // In Persian.
    expect(band(late, 'fa')).toContain('زمان شروع بازی گذشته است');
  });

  it('shows a result its recorded goals disagree with as unclear, neither number as final (T-1717, D-347)', () => {
    // Pafos v Hajduk: the score says 2-0 after an extra-time line, the goals 4-0.
    const scores = {
      ...centre().fixture.scores,
      current: { home: 2, away: 0 },
      half_time: { home: 1, away: 0 },
      full_time: { home: 4, away: 0 },
      extra_time: { home: 0, away: 0 },
    };
    const score_dispute = { recorded_goals: 4, reported: { home: 2, away: 0 } };
    const disputed = centre({ status: 'finished', minute: null, scores, score_dispute });
    const band = (c: MatchCentre, locale: string) =>
      renderToStaticMarkup(
        <MatchCentreView
          words={matchWords(locale)}
          centre={c}
          timeZone="Europe/London"
          locale={locale}
          hero={{ disputed: scoreDisputeHero(locale, c.fixture) }}
        />,
      );
    const html = band(disputed, 'en');
    const text = html.replace(/<[^>]+>/g, '');
    expect(html).toContain('data-testid="score-unclear"');
    expect(html).toContain('data-coverage-badge="limited"');
    expect(text).toContain('Score unclear in the source');
    expect(text).toContain(
      'The recorded goals (4) and the reported result (2–0) do not agree, so neither is shown as final.',
    );
    // The score in the quiet colour, and no ninety minutes beside it.
    expect(html).toMatch(/class="[^"]*text-muted[^"]*" data-testid="score"/);
    expect(html).not.toContain('data-testid="ninety"');
    // The structured data states no result.
    expect(JSON.stringify(matchJsonLd('en', disputed.fixture))).not.toContain('Full time');
    expect(
      JSON.stringify(matchJsonLd('en', { ...disputed.fixture, score_dispute: null })),
    ).toContain('Full time');
    // In Persian, with its own digits.
    const fa = band(disputed, 'fa').replace(/<[^>]+>/g, '');
    expect(fa).toContain('نتیجه در منبع نامشخص است');
    expect(fa).toContain('گل‌های ثبت‌شده (۴)');
    expect(fa).toContain('هیچ‌کدام به‌عنوان نتیجه‌ی نهایی نشان داده نمی‌شود');
    // Agreed, or not finished: nothing said, the ninety minutes back.
    const agreed = band(centre({ status: 'finished', minute: null, scores }), 'en');
    expect(agreed).not.toContain('score-unclear');
    expect(agreed).toContain('data-testid="ninety"');
    expect(scoreDisputeHero('en', { status: 'live', score_dispute })).toBeUndefined();
  });

  it('sets the forecast from before kick-off on a match awaiting an update, never as to come (T-1708)', () => {
    const awaiting = renderToStaticMarkup(
      <ForecastReality
        forecasts={forecasts}
        evaluations={null}
        fixture={{ ...fixture('scheduled'), freshness: 'awaiting_update' }}
        final={null}
        matchXg={null}
        timeZone="Europe/London"
        locale="en"
      />,
    );
    expect(awaiting).toContain('Before kick-off');
    // The title a match still to come carries is not on the page (the bar's
    // accessible name does begin with those words).
    expect(awaiting.replace(/<[^>]*>/g, '')).not.toContain('Model forecast');
    // The last version computed before kick-off, stored as it was (rule 5).
    expect(awaiting).toMatch(/data-version="3" data-current=""/);
    expect(cardVersion(forecasts, null, 'scheduled', KICKOFF, true)?.version_number).toBe(3);
    const later = { ...forecasts, latest: version(4, '2026-10-24T13:00:00.000Z') };
    later.versions = [...forecasts.versions, later.latest];
    expect(cardVersion(later, null, 'scheduled', KICKOFF)?.version_number).toBe(4);
    expect(cardVersion(later, null, 'scheduled', KICKOFF, true)?.version_number).toBe(3);
  });

  it('says when the feed has fallen behind, in the warning colour, never as current (rule 4)', () => {
    const html = view(centre(), Date.parse('2026-10-24T12:30:00.000Z'));
    // No live badge while the feed may be behind: amber words instead.
    expect(html).toMatch(
      /data-testid="live-badge" data-live="false"><span class="[^"]*bg-warning\/15[^"]*text-warning">/,
    );
    expect(html).not.toContain('data-live-badge');
    expect(html).not.toContain('live-dot');
    expect(html).toContain('data-testid="feed-behind"');
    expect(html).toContain('The data for this match is behind');
  });

  it('lists events latest first while the match is on, in order after full time', () => {
    const events = [
      incident(6, 'goal', 'home', 'N. Jackson'),
      incident(32, 'yellow_card', 'away', 'M. Guéhi'),
      incident(52, 'goal', 'away', 'E. Haaland'),
    ];
    const timeline = { coverage: 'available' as const, last_updated_at: null, data: events };
    const live = section(view(centre({}, { timeline })), 'timeline');
    expect(live.indexOf('E. Haaland')).toBeLessThan(live.indexOf('N. Jackson'));
    const done = section(
      view(centre({ status: 'finished', minute: null }, { timeline })),
      'timeline',
    );
    expect(done.indexOf('N. Jackson')).toBeLessThan(done.indexOf('E. Haaland'));
    // From 768px each side's events in its own column.
    expect(done).toMatch(/data-side="away"[^>]*>[^]*?md:col-start-3/);
  });

  it('draws goals and cards on the axis, home above the line and away below', () => {
    const timeline = {
      coverage: 'available' as const,
      last_updated_at: null,
      data: [
        incident(6, 'goal', 'home', 'N. Jackson'),
        incident(54, 'yellow_card', 'away', 'J. Manzambi'),
        incident(59, 'substitution', 'home', 'Alysson'),
      ],
    };
    const axis = section(view(centre({}, { timeline })), 'timeline');
    expect(axis).toContain('role="img"');
    expect(axis).toContain('goals: 1, cards: 1');
    expect(axis).toMatch(/data-kind="goal" data-side="home" class="[^"]*top-4\.5 bg-accent/);
    expect(axis).toMatch(/data-kind="yellow_card" data-side="away" class="[^"]*top-12\.75/);
    expect(axis).not.toMatch(/data-kind="substitution"/);
    // The goal at 6′ of 90.
    expect(axis).toContain('inset-inline-start:6.666');
  });

  it('writes each side’s scorers under its name, and none when an own goal is in the list', () => {
    const goals = [
      incident(6, 'goal', 'home', 'N. Jackson'),
      incident(60, 'goal', 'home', 'N. Jackson'),
      incident(52, 'penalty_goal', 'away', 'E. Haaland'),
    ];
    const html = view(
      centre({}, { timeline: { coverage: 'available', last_updated_at: null, data: goals } }),
    );
    expect(html).toContain('data-testid="scorers-home">N. Jackson 6′, 60′<');
    expect(html).toContain('data-testid="scorers-away">E. Haaland 52′<');
    const own = view(
      centre(
        {},
        {
          timeline: {
            coverage: 'available',
            last_updated_at: null,
            data: [...goals, incident(70, 'own_goal', 'away', 'R. Dias')],
          },
        },
      ),
    );
    expect(own).not.toContain('data-testid="scorers-');
  });
});

describe('the match centre review (T-1550)', () => {
  const kicks = [
    incident(30, 'goal', 'home', 'Mauricio'),
    { ...incident(91, 'penalty_goal', 'home', 'G. Gómez'), id: 'k1', sequence: 91 },
    { ...incident(92, 'penalty_goal', 'away', 'T. Silva'), id: 'k2', sequence: 92 },
    { ...incident(93, 'penalty_missed', 'away', 'Hércules'), id: 'k3', sequence: 93 },
  ];

  it('names the scorers of play only: a shoot-out’s kicks are not goals', () => {
    const html = view(
      centre(
        {
          status: 'finished',
          minute: null,
          scores: {
            ...centre().fixture.scores,
            current: { home: 1, away: 0 },
            full_time: { home: 1, away: 0 },
            penalties: { home: 1, away: 1 },
          },
        },
        { timeline: { coverage: 'available', last_updated_at: null, data: kicks } },
      ),
    );
    expect(html).toContain('data-testid="scorers-home">Mauricio 30′<');
    expect(html).not.toContain('G. Gómez 91′');
    expect(html).not.toContain('data-testid="scorers-away"');
  });

  it('before kick-off says a covered module starts then, never "not supplied" (rule 3)', () => {
    // One card for all of them since T-1745 (`match-centre-coming.spec.tsx`
    // holds its cases): what the season covers is coming, what it does not
    // is named apart, and no module draws an empty card of its own.
    const html = view(centre({ status: 'scheduled', minute: null }, { timeline: empty }));
    const all = html.slice(html.indexOf('data-coming="all"'));
    const card = all.slice(0, all.indexOf('</section>'));
    expect(card).toContain(EN['matchCentre.fromKickoffWhy']);
    expect(card).not.toContain(EN['matchCentre.moduleNotSupplied']);
    for (const id of ['timeline', 'statistics', 'lineups']) {
      expect(card).toContain(`data-coverage-chip="coming" data-module="${id}"`);
      expect(html).not.toContain(`data-testid="${id}"`);
    }
    // A module the season does not cover stays "not supplied", in its own group.
    expect(card).toContain('data-coverage-chip="not_supplied" data-module="player_statistics"');
    expect(card).toContain(EN['matchCentre.coming.notSupplied']);
    // The line-ups keep their own sentence: they come before kick-off, not
    // from it (T-1627).
    expect(card).toContain(EN['matchCentre.lineupsNotYet']);
    expect(html).not.toContain('data-not-yet');
  });

  it('a postponed match says it was not played, in Persian too', () => {
    const postponed = centre({ status: 'postponed', minute: null }, { timeline: empty });
    const card = section(view(postponed), 'timeline');
    expect(card).toContain('data-not-yet="unplayed"');
    expect(card).toContain(EN['matchCentre.notPlayedWhy']);
    expect(section(view(postponed, undefined, 'fa'), 'statistics')).toContain('برگزار نشد');
  });

  it('once played, a missing module is its coverage state again', () => {
    const done = section(view(centre({ status: 'finished', minute: null })), 'statistics');
    expect(done).not.toContain('data-not-yet');
    expect(done).toContain('data-coverage-badge="not_supplied"');
  });
});

// ---------------------------------------------------------------------------
// Ratings: on the pitch and the best rated
// ---------------------------------------------------------------------------

let next = 0;
const starter = (position: MatchLineupPlayer['position']): MatchLineupPlayer => {
  next += 1;
  return {
    id: `p${next}`,
    name: `Player ${next}`,
    role: 'starter',
    shirt_number: next,
    position,
    is_captain: false,
    grid: null,
  };
};
const eleven = () => [
  starter('goalkeeper'),
  ...Array.from({ length: 4 }, () => starter('defender')),
  ...Array.from({ length: 4 }, () => starter('midfielder')),
  ...Array.from({ length: 2 }, () => starter('forward')),
];

describe('ratings', () => {
  it('draws a rating on the Design System chip, in the reader’s digits (T-1523)', () => {
    const home = eleven();
    const html = (locale: 'en' | 'fa') =>
      renderToStaticMarkup(
        <MatchLineupsView
          home={team('h', 'Aston Villa')}
          away={team('a', 'Leeds')}
          lineups={{ home, away: eleven() }}
          ratings={new Map([[home[0]!.id, 7]])}
          locale={locale}
          words={matchWords(locale)}
        />,
      );
    expect(html('en')).toMatch(/data-rating-band="good" class="[^"]*">7\.0</);
    expect(html('fa')).toMatch(/data-rating-band="good" class="[^"]*">۷٫۰</);
  });

  it('puts the ratings on the pitch, the best rated in saffron, and turns it from 768px', () => {
    const home = eleven();
    const away = eleven();
    const ratings = new Map([
      [home[10]!.id, 8.9],
      [away[0]!.id, 5.7],
    ]);
    const html = renderToStaticMarkup(
      <MatchLineupsView
        home={team('h', 'Aston Villa')}
        away={team('a', 'Manchester City')}
        lineups={{ home, away }}
        ratings={ratings}
        locale="en"
        words={matchWords('en')}
      />,
    );
    // One pitch: stacked on a phone, horizontal from 768px, home from the start.
    expect(html).toMatch(/data-testid="lineup-pitch"[^>]*/);
    expect(html).toMatch(
      /class="relative flex flex-col[^"]*md:flex-row-reverse[^"]*" data-testid="lineup-pitch"/,
    );
    expect(html).toMatch(/data-rating-band="top" class="[^"]*">8\.9</);
    expect(html).toMatch(/data-rating-band="low" class="[^"]*">5\.7</);
    expect(html.match(/data-rating-band=/g)).toHaveLength(2);
    expect(html).toContain(`bg-accent text-on-accent">${home[10]!.shirt_number}<`);
  });

  it('names the best rated with the best six, from the feed’s ratings only', () => {
    const stats = [6.1, 8.9, 7.7, 7.6, 7.5, 7.1, 7.0, 0].map((rating, i) => ({
      id: `s${i}`,
      name: `Rated ${i}`,
      side: (i % 2 === 0 ? 'home' : 'away') as 'home' | 'away',
      stats: i === 7 ? { minutes: 0, rating: 6 } : { minutes: 90, rating, goals: i === 1 ? 2 : 0 },
    }));
    const c = centre(
      { status: 'finished', minute: null },
      { player_statistics: { coverage: 'available', last_updated_at: null, data: stats } },
    );
    // A substitute who never came on has no rating to show (rule 3).
    expect([...ratingsOf(c).keys()]).not.toContain('s7');
    const html = section(view(c), 'top-rated');
    expect(html).toContain('Top rated');
    expect(html).toMatch(/Rated 1<\/a>[^]*data-rating-band="top"/);
    const best = [...html.matchAll(/data-rating-band="\w+" class="[^"]*">([\d.]+)</g)].map(
      (m) => m[1],
    );
    expect(best).toEqual(['8.9', '8.9', '7.7', '7.6', '7.5', '7.1', '7.0']);
    // Nothing rated, no card.
    expect(view(centre())).not.toContain('data-testid="top-rated"');
  });
});
