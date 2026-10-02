import type { ConversationSummary, KnockoutLeg, KnockoutTie } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { KnockoutBracket } from './knockout-bracket';
import { CardViewingLine } from './score-card';
import { legLine, tieOutcome } from '@/lib/bracket';
import { conversationTitle, threadStanding } from '@/lib/conversation-title';
import { demonstrationTitle } from '@/lib/demonstration';
import { statValue } from '@/lib/match';
import { statusLabel } from '@/lib/scores';
import { territoryName } from '@/lib/territory';
import { scoresWords } from '@/lib/words-server';

/**
 * The shared helpers in Persian (T-1309, D-175): what is left on a `/fa` page
 * once the areas moved their own words is these helpers' -- the bracket, the
 * status cell, the viewing line, a conversation's name, a page title. Each is
 * rendered for `fa` and checked for Latin letters, once the proper names the
 * test data supplies are taken out: a Latin letter left over is a word nobody
 * moved.
 */

const NAMES = ['Test Alpha', 'Test Beta', 'ALP', 'The Open Terrace', 'Liverpool', 'Esteghlal'];

/** The visible text of `html`, the test data's proper names taken out. */
function words(html: string): string {
  let text = html.replace(/<[^>]*>/g, ' ');
  for (const name of NAMES) text = text.split(name).join(' ');
  return text;
}

const LATIN = /[A-Za-z]/;

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

const decided: KnockoutTie = {
  teams: [alpha, beta],
  legs: [
    leg(),
    leg({
      fixture_id: 'f2',
      leg: 2,
      home: beta,
      away: alpha,
      score: { home: 1, away: 1 },
      after_extra_time: true,
      penalties: { home: 3, away: 4 },
    }),
  ],
  aggregate: [3, 2],
  winner: alpha,
  decided_by: 'aggregate',
};

describe('the knockout bracket in Persian', () => {
  it('names rounds, legs, the outcome and what is missing in Persian, with Persian digits', () => {
    const html = renderToStaticMarkup(
      <KnockoutBracket
        locale="fa"
        timeZone="UTC"
        bracket={{
          rounds: [
            { key: 'round_of_16', state: 'drawn', legs: 2, expected_ties: 8, ties: [decided] },
            { key: 'quarter_final', state: 'not_drawn', legs: 2, expected_ties: 4, ties: [] },
            { key: 'final', state: 'not_supplied', legs: 1, expected_ties: 1, ties: [] },
          ],
        }}
      />,
    );
    expect(html).toContain('>یک‌هشتم نهایی<');
    expect(html).not.toContain('مرحله‌ی یک‌هشتم');
    expect(html).toContain('فینال');
    expect(html).toContain('۷ تقابل دیگر');
    expect(html).not.toContain('data-translation="untranslated"');
    expect(words(html)).not.toMatch(LATIN);
  });

  it('reads the same in English as it did', () => {
    expect(legLine(decided.legs[1]!)).toBe('Test Beta 1–1 ALP (aet, 3–4 pens)');
    expect(tieOutcome(decided, 2)).toBe(
      'ALP 3–2 Test Beta on aggregate · Test Alpha go through on aggregate',
    );
    expect(legLine(decided.legs[1]!, 'fa')).toBe(
      'Test Beta ۱–۱ ALP (پس از وقت‌های اضافه، پنالتی ۳–۴)',
    );
  });
});

describe('the scores helpers the homepage uses, in Persian', () => {
  const fa = scoresWords('fa');

  it('says the status cell in Persian when handed the words', () => {
    const card = {
      status: 'finished' as const,
      minute: null,
      scores: {
        current: { home: 2, away: 1 },
        half_time: null,
        full_time: { home: 2, away: 1 },
        extra_time: null,
        penalties: null,
        aggregate: null,
      },
      kickoff_at: '2026-10-01T18:00:00.000Z',
      last_updated_at: '2026-10-01T20:00:00.000Z',
    };
    const said = statusLabel(card, 'fa', 'UTC', undefined, fa.m);
    expect(said).not.toMatch(LATIN);
    expect(statusLabel({ ...card, status: 'live', minute: 67 }, 'fa', 'UTC', undefined, fa.m)).toBe(
      '۶۷′',
    );
  });

  it('writes the viewing line and the territory in Persian', () => {
    const territory = territoryName('fa', { code: 'IR', name: 'Iran' });
    expect(territory).not.toMatch(LATIN);
    const html = renderToStaticMarkup(
      <CardViewingLine locale="fa" words={fa} viewing={{ state: 'listed', territory, count: 3 }} />,
    );
    expect(html).toContain('۳');
    expect(words(html)).not.toMatch(LATIN);
  });

  it('writes a statistic in Persian digits', () => {
    expect(statValue('possession_pct', 58, 'fa')).not.toMatch(/[0-9]/);
  });
});

describe('names and titles in Persian', () => {
  const base: ConversationSummary = {
    id: 'c1',
    kind: 'group_thread',
    group: { slug: 'terrace', name: 'The Open Terrace', language: null, closed: false },
    fixture: {
      id: 'f1',
      home: 'Liverpool',
      away: 'Esteghlal',
      score: { home: 2, away: 0 },
      status: 'finished',
      kickoff_at: '2099-03-01T15:00:00.000Z',
      last_updated_at: '2099-03-01T17:00:00.000Z',
    },
    members: [],
    last_message: null,
    unread: 0,
    muted: false,
    left: false,
    their_read_seq: null,
  } as ConversationSummary;

  it('names a thread and its standing in Persian', () => {
    expect(words(conversationTitle(base, 'me', 'fa'))).not.toMatch(LATIN);
    expect(words(conversationTitle({ ...base, fixture: null }, 'me', 'fa'))).not.toMatch(LATIN);
    expect(threadStanding(base, 'fa')).not.toMatch(/[A-Za-z0-9]/);
    expect(threadStanding(base)).toBe('2–0 · finished');
    expect(conversationTitle({ ...base, kind: 'direct', group: null }, 'me', 'fa')).toBe(
      'یک گفت‌وگو',
    );
  });

  it('marks a demonstration page title in Persian', () => {
    expect(words(demonstrationTitle('', 'fa'))).not.toMatch(LATIN);
  });
});
