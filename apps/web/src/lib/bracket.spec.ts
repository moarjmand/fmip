import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { KnockoutLeg, KnockoutRound, KnockoutTie } from '@fmip/contracts';
import { KNOCKOUT_ROUNDS } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { ROUND_LABEL, legLabel, legLine, roundNote, tieOutcome } from './bracket';

/**
 * The knockout bracket's words (T-630). Acceptance: a tie not yet drawn is
 * stated, never invented — and a tie not yet decided names no winner.
 */
const HERE = __dirname;
const VIEW = readFileSync(join(HERE, '..', 'components', 'knockout-bracket.tsx'), 'utf8');
const PAGE = readFileSync(
  join(HERE, '..', 'app', '[locale]', 'competition', '[id]', 'page.tsx'),
  'utf8',
);

const alpha = { id: 'a', name: 'Test Alpha', short_name: 'ALP' };
const beta = { id: 'b', name: 'Test Beta', short_name: null };

const leg = (over: Partial<KnockoutLeg> = {}): KnockoutLeg => ({
  fixture_id: 'f1',
  leg: 1,
  kickoff_at: '2027-03-10T20:00:00.000Z',
  status: 'finished',
  home: alpha,
  away: beta,
  score: { home: 2, away: 1 },
  after_extra_time: false,
  penalties: null,
  ...over,
});

const tie = (over: Partial<KnockoutTie> = {}): KnockoutTie => ({
  teams: [alpha, beta],
  legs: [leg()],
  aggregate: null,
  winner: null,
  decided_by: null,
  ...over,
});

const round = (over: Partial<KnockoutRound> = {}): KnockoutRound => ({
  key: 'round_of_16',
  state: 'drawn',
  legs: 2,
  expected_ties: 8,
  ties: [],
  ...over,
});

describe('round labels', () => {
  it('names every round the contract can send', () => {
    for (const key of KNOCKOUT_ROUNDS) expect(ROUND_LABEL[key]).toMatch(/\S/);
  });
});

describe('legLine', () => {
  it('reads a leg before and after kick-off, with extra time and the shoot-out', () => {
    expect(legLine(leg({ score: null, status: 'scheduled' }))).toBe('ALP v Test Beta');
    expect(legLine(leg())).toBe('ALP 2–1 Test Beta');
    expect(
      legLine(
        leg({
          score: { home: 1, away: 1 },
          after_extra_time: true,
          penalties: { home: 4, away: 3 },
        }),
      ),
    ).toBe('ALP 1–1 Test Beta (aet, 4–3 pens)');
  });

  it('calls a single-match round a match, not a leg', () => {
    expect(legLabel(leg({ leg: 2 }), 2)).toBe('Leg 2');
    expect(legLabel(leg(), 1)).toBe('Match');
  });
});

describe('tieOutcome', () => {
  it('names no winner while the tie is undecided', () => {
    expect(tieOutcome(tie(), 2)).toBe('Still to be decided');
    expect(tieOutcome(tie({ aggregate: [2, 2] }), 2)).toBe(
      'ALP 2–2 Test Beta on aggregate · not decided in our records',
    );
  });

  it('names the winner the API decided, and how', () => {
    expect(tieOutcome(tie({ aggregate: [3, 2], winner: alpha, decided_by: 'aggregate' }), 2)).toBe(
      'ALP 3–2 Test Beta on aggregate · Test Alpha go through on aggregate',
    );
    expect(tieOutcome(tie({ aggregate: [2, 2], winner: beta, decided_by: 'penalties' }), 2)).toBe(
      'ALP 2–2 Test Beta on aggregate · Test Beta go through on penalties',
    );
    expect(tieOutcome(tie({ winner: alpha, decided_by: 'score' }), 1)).toBe('Test Alpha win');
  });
});

describe('roundNote', () => {
  it('states an undrawn round and a round our records lack, in words', () => {
    expect(roundNote(round({ state: 'not_drawn' }))).toBe('Not drawn yet.');
    expect(roundNote(round({ state: 'not_supplied' }))).toMatch(/^Not supplied/);
  });

  it('counts the ties a drawn round still lacks, and says nothing when it has them all', () => {
    expect(roundNote(round({ ties: [tie()] }))).toBe('7 more ties not in our records yet.');
    expect(roundNote(round({ key: 'semi_final', expected_ties: 2, ties: [tie()] }))).toBe(
      '1 more tie not in our records yet.',
    );
    expect(roundNote(round({ key: 'final', legs: 1, expected_ties: 1, ties: [tie()] }))).toBeNull();
  });
});

describe('the bracket on the page', () => {
  it('renders only what the API sends: no placeholder team is written into the view', () => {
    expect(VIEW).not.toMatch(/TBD|TBC|Winner of|placeholder=/i);
    expect(VIEW).toContain('roundNote(round)');
    expect(VIEW).toContain('tieOutcome(tie, round.legs)');
  });

  it('uses logical properties only, so it reads right to left', () => {
    const classes = [...VIEW.matchAll(/className=(?:"([^"]*)"|\{([^}]*)\})/g)]
      .map((m) => m[1] ?? m[2])
      .join(' ');
    expect(classes).toMatch(/\bps-3\b/);
    expect(classes).not.toMatch(
      /\b(ml|mr|pl|pr|left|right|border-l|border-r)-|text-(left|right)\b/,
    );
  });

  it('is shown on the competition page only when the API sends a bracket', () => {
    expect(PAGE).toContain('page.bracket !== null');
    expect(PAGE).toContain('<KnockoutBracket');
  });
});
