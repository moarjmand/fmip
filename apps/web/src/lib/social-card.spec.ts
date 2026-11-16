import type {
  SocialCardTeam,
  SocialForecastPayload,
  SocialResultPayload,
  SocialVerdictPayload,
} from '@fmip/contracts';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({ apiRequest: vi.fn() }));

const {
  badgeLetters,
  goalMinute,
  isSocialPostId,
  kickOffText,
  shareTexts,
  socialCardText,
  socialNameSize,
} = await import('./social-card');

/**
 * T-1835 (D-427 point 11): a social card's words come from the post's frozen
 * payload alone. One product a card (rule 6): the forecast and the check
 * name the statistical model and its version, the result no prediction.
 * Lettered badges, never a crest: the code where the site has one.
 */

const ID = '6f1d3c1e-5b8a-4f0e-9a51-0c2b7d4e9a10';
const team = (name: string, code: string | null, short_name: string | null = null) =>
  ({ id: ID, name, short_name, code }) satisfies SocialCardTeam;
const MODEL = {
  name: 'The Stadiomind model' as const,
  version: 'dixon-coles-elo@0.7.0',
  forecast_id: ID,
  computed_at: '2026-11-14T17:32:00.000Z',
};

const FORECAST: SocialForecastPayload = {
  kind: 'forecast_pre_match',
  fixture_id: ID,
  competition: { id: ID, name: 'Premier League' },
  round: 'Matchday 11',
  kick_off: '2026-11-21T17:30:00.000Z',
  home: team('Newcastle', 'NEW'),
  away: team('Arsenal', 'ARS'),
  model: MODEL,
  percent: { home: 17.7, draw: 25.3, away: 57.0 },
};

const VERDICT: SocialVerdictPayload = {
  kind: 'model_verdict',
  fixture_id: ID,
  competition: { id: ID, name: 'Copa del Rey' },
  kick_off: '2026-10-29T18:00:00.000Z',
  home: team('Real Ávila', null),
  away: team('Unionistas de Salamanca', null, 'Unionistas'),
  model: { ...MODEL, version: 'dixon-coles-elo@0.6.0' },
  score: { home: 0, away: 0 },
  after_extra_time: true,
  called: 'away',
  called_percent: 44,
  percent: { home: 27.9, draw: 27.7, away: 44.4 },
  correct: false,
};

const RESULT: SocialResultPayload = {
  kind: 'result',
  fixture_id: ID,
  competition: { id: ID, name: 'UEFA Nations League A' },
  round: 'Matchday 5',
  kick_off: '2026-11-14T17:00:00.000Z',
  home: team('Norway', 'NOR'),
  away: team('Wales', 'WAL'),
  score: { home: 3, away: 1 },
  after_extra_time: false,
  penalties: null,
  half_time: { home: 0, away: 0 },
  goals: [
    { side: 'home', player: 'Nusa', minute: 59, added: null, kind: 'goal' },
    { side: 'home', player: 'Schjelderup', minute: 68, added: null, kind: 'goal' },
    { side: 'away', player: 'Brooks', minute: 79, added: null, kind: 'goal' },
    { side: 'home', player: 'Haaland', minute: 88, added: null, kind: 'penalty' },
  ],
};

describe('the badge', () => {
  it('is the three-letter code where the site has one, so two "N"s become NEW and NOR', () => {
    expect(badgeLetters(team('Newcastle', 'NEW'))).toBe('NEW');
    expect(badgeLetters(team('Norway', 'nor'))).toBe('NOR');
  });

  it('is two initials without a code, the first two letters of a one-word name', () => {
    expect(badgeLetters(team('Salamanca UDS', null))).toBe('SU');
    expect(badgeLetters(team('Real Ávila', null))).toBe('RÁ');
    expect(badgeLetters(team('Arsenal', null))).toBe('AR');
    // A code that is not three letters is not a code.
    expect(badgeLetters(team('Celta Vigo', 'CELTA'))).toBe('CV');
    expect(badgeLetters(team('Celta Vigo', ''))).toBe('CV');
  });
});

describe('the words', () => {
  it('takes the short name for a long one, sized to stay within two lines', () => {
    const text = socialCardText(VERDICT);
    expect(text.away.name).toBe('Unionistas');
    expect(text.home.name).toBe('Real Ávila');
    expect(socialNameSize('Arsenal')).toBe(56);
    expect(socialNameSize('Unionistas de Salamanca')).toBe(42);
    expect(socialNameSize('Wolverhampton')).toBe(42);
    expect(socialNameSize('Celta Vigo B')).toBe(48);
    expect(socialNameSize('Mönchengladbach Borussia')).toBe(36);
  });

  it('prints the shares as the payload holds them: one decimal when any has one, else whole', () => {
    expect(shareTexts({ home: 17.7, draw: 25.3, away: 57 })).toEqual({
      home: '17.7',
      draw: '25.3',
      away: '57.0',
    });
    expect(shareTexts({ home: 18, draw: 25, away: 57 })).toEqual({
      home: '18',
      draw: '25',
      away: '57',
    });
  });

  it('writes times in London ("UK time") and minutes as the match page does', () => {
    expect(kickOffText('2026-11-21T17:30:00.000Z')).toBe('Sat 21 Nov · 17:30 UK time');
    // British Summer Time.
    expect(kickOffText('2026-08-15T14:00:00.000Z')).toBe('Sat 15 Aug · 15:00 UK time');
    expect(
      goalMinute({ side: 'home', player: 'A', minute: 88, added: null, kind: 'penalty' }),
    ).toBe('88′ pen.');
    expect(goalMinute({ side: 'away', player: 'B', minute: 45, added: 2, kind: 'own_goal' })).toBe(
      '45+2′ o.g.',
    );
  });

  it('takes only a UUID as a post id', () => {
    expect(isSocialPostId(ID)).toBe(true);
    expect(isSocialPostId(ID.toUpperCase())).toBe(true);
    expect(isSocialPostId('../media/x')).toBe(false);
  });
});

describe('the forecast card', () => {
  it('names the model and its version, and the largest share is the one in its colour', () => {
    const text = socialCardText(FORECAST);
    if (text.kind !== 'forecast_pre_match') throw new Error(text.kind);
    expect(text.chip).toBe('Model forecast');
    expect(text.eyebrow).toBe('PREMIER LEAGUE · MATCHDAY 11');
    expect(text.kickOff).toBe('Sat 21 Nov · 17:30 UK time');
    expect(text.model).toEqual({
      name: 'The Stadiomind model',
      version: 'dixon-coles-elo@0.7.0',
      computed: 'Computed 14 Nov · 17:32 UK time',
    });
    expect(text.shares.map((s) => [s.label, s.value, s.rank])).toEqual([
      ['Newcastle', '17.7', 3],
      ['Draw', '25.3', 2],
      ['Arsenal', '57.0', 1],
    ]);
    expect(text.home.letters).toBe('NEW');
  });

  it('gives equal shares the same rank', () => {
    const text = socialCardText({ ...FORECAST, percent: { home: 33, draw: 34, away: 33 } });
    if (text.kind !== 'forecast_pre_match') throw new Error(text.kind);
    expect(text.shares.map((s) => s.rank)).toEqual([2, 1, 2]);
  });

  it('says nothing of when it was computed when the payload does not', () => {
    const { computed_at: _, ...model } = MODEL;
    const text = socialCardText({ ...FORECAST, model });
    if (text.kind !== 'forecast_pre_match') throw new Error(text.kind);
    expect(text.model.computed).toBeNull();
    expect(socialCardText({ ...FORECAST, round: null }).eyebrow).toBe('PREMIER LEAGUE');
  });
});

describe('the model check', () => {
  it('reads the stored verdict and says "after 90 minutes" when the match went further', () => {
    const text = socialCardText(VERDICT);
    if (text.kind !== 'model_verdict') throw new Error(text.kind);
    expect(text.correct).toBe(false);
    expect(text.verdict).toBe('The model missed this one.');
    expect(text.score).toBe('0–0');
    expect(text.scoreNote).toBe('After 90 minutes');
    expect(text.happened).toBe('draw');
    expect(text.called).toBe('away');
    expect(text.pickLine).toBe('Its pick: Unionistas win, 44.4%');
    expect(text.outcomeLine).toBe('After 90 minutes: Draw');
    expect(text.model.version).toBe('dixon-coles-elo@0.6.0');
  });

  it('never recomputes the verdict: the stored `correct` is what it says', () => {
    const right = socialCardText({
      ...VERDICT,
      after_extra_time: false,
      score: { home: 0, away: 5 },
      correct: true,
    });
    if (right.kind !== 'model_verdict') throw new Error(right.kind);
    expect(right.verdict).toBe('The model got it right.');
    expect(right.scoreNote).toBeNull();
    expect(right.outcomeLine).toBe('Result: Unionistas win');
  });

  it("draws the pick alone, with the payload's whole share, when there is no bar", () => {
    const text = socialCardText({ ...VERDICT, percent: null });
    if (text.kind !== 'model_verdict') throw new Error(text.kind);
    expect(text.shares).toBeNull();
    expect(text.pick).toEqual({ label: 'Unionistas win', value: '44' });
  });
});

describe('the result card', () => {
  it('carries no prediction at all (rule 6)', () => {
    const text = socialCardText(RESULT);
    expect(Object.keys(text).sort()).toEqual(
      ['away', 'chip', 'date', 'eyebrow', 'home', 'kind', 'score', 'scorers', 'status'].sort(),
    );
    expect(JSON.stringify(text)).not.toMatch(/model|forecast|pick|%/i);
  });

  it('lists the scorers by side, with the half-time score', () => {
    const text = socialCardText(RESULT);
    if (text.kind !== 'result') throw new Error(text.kind);
    expect(text.chip).toBe('Full time');
    expect(text.score).toBe('3–1');
    expect(text.status).toBe('FT · HT 0–0');
    expect(text.date).toBe('Sat 14 Nov 2026');
    expect(text.scorers).toEqual({
      home: [
        { player: 'Nusa', minute: '59′' },
        { player: 'Schjelderup', minute: '68′' },
        { player: 'Haaland', minute: '88′ pen.' },
      ],
      away: [{ player: 'Brooks', minute: '79′' }],
    });
  });

  it('lists no scorer rather than some of them (rule 3)', () => {
    const partial = socialCardText({ ...RESULT, goals: RESULT.goals!.slice(1) });
    const absent = socialCardText({ ...RESULT, goals: null, half_time: null });
    for (const text of [partial, absent]) {
      if (text.kind !== 'result') throw new Error(text.kind);
      expect(text.scorers).toBeNull();
    }
    if (absent.kind === 'result') expect(absent.status).toBe('FT');
  });

  it('says extra time and the shoot-out', () => {
    const text = socialCardText({
      ...RESULT,
      score: { home: 2, away: 2 },
      after_extra_time: true,
      penalties: { home: 4, away: 3 },
      goals: null,
    });
    if (text.kind !== 'result') throw new Error(text.kind);
    expect(text.status).toBe('AET · Pens 4–3');
  });
});
