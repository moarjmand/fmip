import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { KnockoutBracket as Bracket, KnockoutLeg, KnockoutTie } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { chipLabel, chipName, legGoals, openingStage, readStageParam } from '@/lib/bracket';
import { KnockoutBracket } from './knockout-bracket';

/**
 * The knockout rounds (T-1763, D-378's D10): on a phone, round chips (links)
 * and one round at a time, opening at the latest round with a tie drawn; from
 * 768px a column per round. The winner ticked and bold, the loser muted, the
 * aggregate and the winner the API's own, a round nobody has drawn a
 * sentence and a dashed chip, never placeholder teams (T-630).
 */

const VIEW = readFileSync(join(__dirname, 'knockout-bracket.tsx'), 'utf8');
const alpha = { id: 'a', name: 'Test Alpha', short_name: 'ALP' };
const beta = { id: 'b', name: 'Test Beta', short_name: null };
const gamma = { id: 'g', name: 'Test Gamma', short_name: null };
const delta = { id: 'd', name: 'Test Delta', short_name: null };

const leg = (over: Partial<KnockoutLeg>): KnockoutLeg => ({
  fixture_id: 'f1',
  leg: 1,
  kickoff_at: '2026-02-17T20:00:00.000Z',
  status: 'finished',
  home: alpha,
  away: beta,
  score: { home: 2, away: 1 },
  after_extra_time: false,
  penalties: null,
  ...over,
});

/** Decided by the API: ALP 3–2 on aggregate. */
const decided: KnockoutTie = {
  teams: [alpha, beta],
  legs: [
    leg({}),
    leg({
      fixture_id: 'f2',
      leg: 2,
      kickoff_at: '2026-02-25T20:00:00.000Z',
      home: beta,
      away: alpha,
      score: { home: 1, away: 1 },
      after_extra_time: true,
    }),
  ],
  aggregate: [3, 2],
  winner: alpha,
  decided_by: 'aggregate',
};

/** Both legs played, but the API judged nothing: no aggregate, no winner. */
const undecided: KnockoutTie = {
  teams: [gamma, delta],
  legs: [
    leg({ fixture_id: 'f3', home: gamma, away: delta, score: { home: 1, away: 0 } }),
    leg({
      fixture_id: 'f4',
      leg: 2,
      kickoff_at: '2026-03-18T20:00:00.000Z',
      home: delta,
      away: gamma,
      score: { home: 1, away: 0 },
    }),
  ],
  aggregate: null,
  winner: null,
  decided_by: null,
};

const final: KnockoutTie = {
  teams: [alpha, gamma],
  legs: [
    leg({
      fixture_id: 'f9',
      kickoff_at: '2026-05-30T16:00:00.000Z',
      home: alpha,
      away: gamma,
      score: { home: 1, away: 1 },
      penalties: { home: 4, away: 3 },
    }),
  ],
  aggregate: null,
  winner: alpha,
  decided_by: 'penalties',
};

const running: Bracket = {
  rounds: [
    { key: 'knockout_playoff', state: 'drawn', legs: 2, expected_ties: 8, ties: [decided] },
    { key: 'round_of_16', state: 'drawn', legs: 2, expected_ties: 8, ties: [undecided] },
    { key: 'quarter_final', state: 'not_drawn', legs: 2, expected_ties: 4, ties: [] },
    { key: 'semi_final', state: 'not_drawn', legs: 2, expected_ties: 2, ties: [] },
    { key: 'final', state: 'not_drawn', legs: 1, expected_ties: 1, ties: [] },
  ],
};

const nothing: Bracket = {
  rounds: running.rounds.map((r) => ({ ...r, state: 'not_drawn' as const, ties: [] })),
};

const href = (key: string) => `/en/competition/c?tab=table&stage=${key}#bracket`;

const render = (
  bracket: Bracket,
  over: { stage?: Bracket['rounds'][number]['key']; locale?: string } = {},
) =>
  renderToStaticMarkup(
    <KnockoutBracket
      bracket={bracket}
      locale={over.locale ?? 'en'}
      timeZone="UTC"
      stage={over.stage ?? null}
      href={href}
      competition="Test Cup"
      season="2026/27"
    />,
  );

/** The phone's part and the desktop's part of the markup. */
const parts = (html: string) => {
  const phone = html.slice(
    html.indexOf('data-testid="bracket-phone"'),
    html.indexOf('data-testid="bracket-columns"'),
  );
  const desk = html.slice(html.indexOf('data-testid="bracket-columns"'));
  return { phone, desk };
};
const text = (html: string) => html.replace(/<[^>]+>/g, '');
const chips = (html: string) =>
  [...html.matchAll(/<a [^>]*data-testid="bracket-chip"[^>]*>/g)].map((m) => m[0]);

describe('the bracket on a phone: chips and one round', () => {
  it('has a 44px link chip per round, the not-drawn ones dashed', () => {
    const tags = chips(render(running));
    expect(tags).toHaveLength(5);
    for (const tag of tags) expect(tag).toMatch(/min-h-touch min-w-touch/);
    expect(tags[0]).toContain(
      'href="/en/competition/c?tab=table&amp;stage=knockout_playoff#bracket"',
    );
    expect(tags[2]).toContain('border-dashed');
    expect(tags[2]).toContain('data-state="not_drawn"');
    // The name holds the shown words first (WCAG 2.5.3), then the round in full.
    expect(tags[2]).toContain('aria-label="QF, Quarter-finals"');
    expect(tags[0]).not.toContain('border-dashed');
  });

  it('names each chip with the words it shows, and the landmarks apart (code review, 2026-11-07)', () => {
    expect(chipName('quarter_final')).toBe('QF, Quarter-finals');
    expect(chipName('round_of_16')).toBe('R16, Round of 16');
    // A chip showing the round's whole name is named by it once.
    expect(chipName('final')).toBe('Final');
    // Persian: its own comma, the shown «۱/۴» first.
    expect(chipName('quarter_final', 'fa')).toMatch(/^۱\/۴، /);
    const html = render(running);
    const names = [
      /<section id="bracket" aria-labelledby="bracket-heading"/.test(html) ? 'Knockout rounds' : '',
      /<nav aria-label="([^"]+)"/.exec(html)?.[1],
      /role="region" aria-label="([^"]+)"/.exec(html)?.[1],
    ];
    expect(names).toEqual(['Knockout rounds', 'Rounds', 'Every knockout round, side by side']);
    expect(new Set(names).size).toBe(3);
    expect(html).not.toMatch(/role="region" aria-labelledby="bracket-heading"/);
  });

  it('opens at the latest round with a tie drawn, showing that round alone', () => {
    expect(openingStage(running)).toBe('round_of_16');
    const html = render(running);
    const current = chips(html).filter((t) => t.includes('aria-current="true"'));
    expect(current).toHaveLength(1);
    expect(current[0]).toContain('stage=round_of_16');
    const { phone } = parts(html);
    expect(html).toMatch(/md:hidden" data-testid="bracket-phone"/);
    expect(phone).toMatch(/data-testid="bracket-stage" data-stage="round_of_16"/);
    expect(phone.match(/data-testid="bracket-tie"/g)).toHaveLength(1);
    expect(text(phone)).toContain('Test Gamma');
    expect(text(phone)).not.toContain('Test Beta');
  });

  it('shows the round chosen by `?stage=`, a not-drawn one as a sentence, never placeholder teams', () => {
    const { phone } = parts(render(running, { stage: 'quarter_final' }));
    expect(phone).toMatch(
      /data-testid="bracket-stage" data-stage="quarter_final" data-state="not_drawn"/,
    );
    expect(phone).not.toContain('bracket-tie');
    expect(phone).toMatch(/border-dashed[^"]*"[^>]*data-testid="bracket-note">Not drawn yet\.</);
    expect(phone).not.toMatch(/TBD|TBC|Winner of/i);
  });

  it('with nothing drawn, says so once and names the rounds to come', () => {
    expect(openingStage(nothing)).toBeNull();
    const html = render(nothing);
    const { phone } = parts(html);
    expect(phone).toContain('data-testid="bracket-none-drawn"');
    expect(text(phone)).toContain('Nothing is drawn yet for Test Cup 2026/27.');
    expect(text(phone)).toContain(
      'Rounds to come: Knockout Round Play-offs, Round of 16, Quarter-finals, Semi-finals and Final.',
    );
    expect(chips(html).some((t) => t.includes('aria-current'))).toBe(false);
    expect(chips(html).every((t) => t.includes('border-dashed'))).toBe(true);
  });

  it('reads `?stage=` only for a round the bracket has', () => {
    expect(readStageParam({ stage: 'final' }, running)).toBe('final');
    expect(readStageParam({ stage: 'round_of_32' }, running)).toBeNull();
    expect(readStageParam({ stage: 'nonsense' }, running)).toBeNull();
    expect(readStageParam({}, null)).toBeNull();
  });
});

describe('the bracket from 768px: a column per round', () => {
  it('sets the rounds side by side, top-aligned, scrolling in their own box', () => {
    const { desk } = parts(render(running));
    expect(desk).toMatch(/^data-testid="bracket-columns"/);
    expect(render(running)).toMatch(
      /class="hidden overflow-x-auto[^"]*md:block" role="region" aria-label="Every knockout round, side by side" tabindex="0"/,
    );
    expect(desk).toContain('grid-flow-col items-start');
    expect(desk.match(/data-testid="bracket-round"/g)).toHaveLength(5);
    expect(desk.match(/data-testid="bracket-tie"/g)).toHaveLength(2);
    expect(desk.match(/data-testid="bracket-note">Not drawn yet\.</g)).toHaveLength(3);
  });

  it('ticks and bolds the winner and mutes the loser, never by colour alone', () => {
    const { desk } = parts(render(running));
    const won = desk.match(
      /<tr class="font-extrabold" data-testid="bracket-team" data-result="won">.*?<\/tr>/,
    )?.[0];
    expect(won).toContain('data-icon="check"');
    expect(won).toContain('ALP');
    expect(text(won ?? '')).toContain('(winner)');
    expect(desk).toMatch(
      /<tr class="font-medium text-muted" data-testid="bracket-team" data-result="lost">.*?Test Beta/,
    );
    expect(text(desk)).toContain(
      'ALP 3–2 Test Beta on aggregate · Test Alpha go through on aggregate',
    );
  });

  it('writes each team’s goals per leg and the API’s aggregate, and never adds them up itself', () => {
    const { desk } = parts(render(running));
    // ALP: 2 at home, 1 away, aggregate 3 (the API's); Test Beta: 1, 1, 2.
    expect(desk).toMatch(
      /ALP<\/bdi>.*?bracket-goals">2<.*?bracket-goals">1<.*?bracket-aggregate">3</,
    );
    // Both legs played, nothing decided by the API: no aggregate, no tick.
    const tie = desk.slice(desk.indexOf('Test Gamma'));
    expect(tie).toMatch(/bracket-aggregate"><\/td>/);
    expect(tie.slice(0, tie.indexOf('</table>'))).not.toContain('data-icon="check"');
    expect(text(desk)).toContain('Still to be decided');
    expect(VIEW).not.toMatch(/reduce\(|\+ ?legGoals|aggregate\[0\] ?\+/);
    expect(legGoals(decided.legs[1]!, 'a')).toBe(1);
    expect(legGoals(leg({ score: null }), 'a')).toBeNull();
  });

  it('says a leg that went to extra time, and links each leg to its match', () => {
    const { desk } = parts(render(running));
    expect(desk).toContain('data-testid="bracket-extra">Test Beta 1–1 ALP (aet)<');
    const legs = [...desk.matchAll(/<a [^>]*data-testid="bracket-leg"[^>]*>/g)].map((m) => m[0]);
    expect(legs).toHaveLength(4);
    expect(legs[0]).toContain('href="/en/match/f1"');
    expect(legs[0]).toContain('min-h-touch');
    expect(legs[0]).toContain('aria-label="Leg 1: ALP 2–1 Test Beta"');
  });

  it('gives a one-match final its shoot-out in brackets', () => {
    const done: Bracket = {
      rounds: [{ key: 'final', state: 'drawn', legs: 1, expected_ties: 1, ties: [final] }],
    };
    const html = render(done);
    expect(html).toMatch(/ALP<\/bdi>.*?bracket-goals">1<span class="ms-1 text-xs">\(4\)<\/span>/);
    expect(html).not.toContain('bracket-aggregate');
    expect(text(html)).toContain('Test Alpha win on penalties');
  });
});

describe('the bracket in Persian', () => {
  it('has the proposed chips, Persian digits, and reads right to left by logical properties', () => {
    const html = render(running, { locale: 'fa' });
    expect(chips(html).map((t) => t)).toHaveLength(5);
    expect(chipLabel('round_of_16', 'fa')).toBe('۱/۸');
    expect(chipLabel('knockout_playoff', 'fa')).toBe('پلی‌آف');
    expect(html).toContain('>۱/۴<');
    expect(html).toContain('>نیمه<');
    expect(html).toContain('bracket-aggregate">۳<');
    expect(html).not.toContain('data-translation="untranslated"');
    expect(html).not.toMatch(
      /\b(?:ml|mr|pl|pr|left|right|border-l|border-r)-|text-(?:left|right)\b/,
    );
  });
});
