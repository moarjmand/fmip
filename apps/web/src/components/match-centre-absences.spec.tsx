import type { MatchAbsence, MatchCentre } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EN } from '@/i18n/messages';
import { matchWords } from '@/lib/words-server';
import { MatchCentreView, absenceOrder, absenceReasonKey } from './match-centre-view';

/**
 * Who will miss the match, before kick-off (T-1626): each side's injured,
 * suspended and doubtful players with the reason in the reader's words
 * (T-1601: never the feed's English on /fa) and when the feed was asked
 * (rule 4).
 */

const KICKOFF = '2026-10-31T15:00:00.000Z';
const ASKED = '2026-10-29T09:05:00.000Z';
const NOW = Date.parse('2026-10-29T10:00:00.000Z');

const absence = (
  over: Partial<MatchAbsence> & Pick<MatchAbsence, 'id' | 'name'>,
): MatchAbsence => ({
  side: 'home',
  status: 'out',
  kind: 'injury',
  reason: 'Thigh Injury',
  reason_code: 'thigh',
  reported_at: ASKED,
  ...over,
});

const LIST: MatchAbsence[] = [
  absence({
    id: 'p1',
    name: 'Zanoli',
    status: 'doubtful',
    reason: 'Muscle Injury',
    reason_code: 'muscle',
  }),
  absence({ id: 'p2', name: 'Alaba', reason: 'Calf Injury', reason_code: 'calf' }),
  absence({
    id: 'p3',
    name: 'Bayo',
    kind: 'suspension',
    reason: 'Red Card',
    reason_code: 'red_card',
  }),
  absence({
    id: 'p4',
    name: 'Valenti',
    side: 'away',
    kind: 'other',
    reason: "Coach's decision",
    reason_code: 'coach_decision',
  }),
  absence({
    id: 'p5',
    name: 'Elphege',
    side: 'away',
    kind: null,
    reason: 'Something new',
    reason_code: null,
  }),
];

const empty = { coverage: 'not_supplied' as const, last_updated_at: null, data: null };
const team = (id: string, name: string) => ({
  id,
  name,
  short_name: null,
  code: null,
  formation: null,
  coach: null,
});
const centre = (availability: MatchCentre['availability']) =>
  ({
    fixture: {
      id: 'f1',
      kickoff_at: KICKOFF,
      status: 'scheduled',
      minute: null,
      competition: { id: 'c', name: 'Serie A', short_name: null, country_id: null },
      season: { id: 's', label: '2026/27' },
      stage: null,
      round: null,
      group_name: null,
      leg: null,
      home: team('h', 'Udinese'),
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
      last_updated_at: ASKED,
      freshness: null,
    },
    timeline: empty,
    statistics: empty,
    lineups: empty,
    availability,
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
  }) as MatchCentre;

const listed = (data: MatchAbsence[] = LIST, asked: string | null = ASKED) =>
  centre({ coverage: 'available', last_updated_at: asked, data, gap: null });

const card = (c: MatchCentre, locale = 'en', now: number | undefined = NOW) => {
  const html = renderToStaticMarkup(
    <MatchCentreView
      words={matchWords(locale)}
      centre={c}
      timeZone="Europe/London"
      locale={locale}
      now={now}
    />,
  );
  const start = html.indexOf('data-testid="availability"');
  return html.slice(start, html.indexOf('</section>', start));
};

describe('who will miss the match, before kick-off', () => {
  it('lists each side, out before doubtful, the suspended first', () => {
    const html = card(listed());
    const at = (name: string) => html.indexOf(name);
    expect(at('Bayo')).toBeLessThan(at('Alaba'));
    expect(at('Alaba')).toBeLessThan(at('Zanoli'));
    expect(at('Udinese')).toBeLessThan(at('Bayo'));
    expect(at('Zanoli')).toBeLessThan(at('Parma'));
    expect(html).toContain('data-status="doubtful" data-kind="injury"');
    expect(html).toContain('data-kind="suspension"');
  });

  it('says each reason in our words, and the feed’s only where we have none', () => {
    const html = card(listed());
    expect(html).toContain(EN['matchCentre.absenceReason.red_card']);
    expect(html).toContain(EN['matchCentre.absenceReason.calf']);
    expect(html).not.toContain('Calf Injury');
    // A reason we cannot name, with no kind: the feed's words on /en only.
    expect(html).toContain('Something new');
  });

  it('says it in Persian on /fa, never the feed’s English', () => {
    const html = card(listed(), 'fa');
    expect(html).toContain('محروم: کارت قرمز');
    expect(html).toContain('مصدومیت عضله‌ی ساق');
    expect(html).toContain('تصمیم سرمربی');
    for (const english of ['Calf Injury', 'Red Card', 'Coach', 'Something new', 'Muscle Injury'])
      expect(html).not.toContain(english);
  });

  it('says when the feed was asked under the list, and when that is old (rule 4)', () => {
    const html = card(listed());
    expect(html).toContain('data-testid="absences-asked"');
    expect(html).toContain('As reported when last checked, 09:05.');
    expect(html).not.toContain(EN['player.availability.stale']);
    const later = card(listed(), 'en', Date.parse('2026-10-29T16:00:00.000Z'));
    expect(later).toContain(EN['player.availability.stale']);
    expect(card(listed(), 'fa')).toContain('طبق آخرین بررسی، ۰۹:۰۵.');
  });

  it('with nobody listed still says so with the time, and before the window says not yet', () => {
    expect(card(listed([]))).toContain('data-testid="no-absences"');
    expect(card(listed([]))).not.toContain('data-testid="absences-asked"');
    const notYet = card(
      centre({ coverage: 'not_supplied', last_updated_at: null, data: null, gap: 'not_yet' }),
    );
    expect(notYet).toContain(EN['matchCentre.absencesNotYet']);
  });
});

describe('the absence rules', () => {
  it('orders out before doubtful, then suspension, injury, illness, other, none, then name', () => {
    const order = absenceOrder([
      absence({ id: 'a', name: 'A', kind: null }),
      absence({ id: 'b', name: 'B', kind: 'other' }),
      absence({ id: 'c', name: 'C', kind: 'illness' }),
      absence({ id: 'd', name: 'D', status: 'doubtful', kind: 'suspension' }),
      absence({ id: 'e', name: 'E', kind: 'injury' }),
      absence({ id: 'f', name: 'F', kind: 'suspension' }),
      absence({ id: 'g', name: 'Ea', kind: 'injury' }),
    ]).map((a) => a.id);
    expect(order).toEqual(['f', 'e', 'g', 'c', 'b', 'a', 'd']);
  });

  it('names the reason by its code, else its kind, else nothing', () => {
    expect(absenceReasonKey(absence({ id: 'x', name: 'X', reason_code: 'yellow_cards' }))).toBe(
      'matchCentre.absenceReason.yellow_cards',
    );
    expect(
      absenceReasonKey(absence({ id: 'x', name: 'X', reason_code: null, kind: 'suspension' })),
    ).toBe('player.availability.kind.suspension');
    expect(
      absenceReasonKey(absence({ id: 'x', name: 'X', reason_code: undefined, kind: null })),
    ).toBeNull();
  });
});
