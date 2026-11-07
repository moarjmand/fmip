import type { MatchAbsence, MatchCentre } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EN } from '@/i18n/messages';
import { matchWords } from '@/lib/words-server';
import {
  ABSENCES_SHOWN,
  MatchCentreView,
  absenceGroups,
  absenceOrder,
  absenceReasonKey,
} from './match-centre-view';

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

describe('the absences grouped by status and reason (T-1746, D-367)', () => {
  // Sparta Prague v Bournemouth on the board: seven injured, three injured,
  // five not in the squad.
  const injured = (id: string, name: string, code: MatchAbsence['reason_code'], side = 'home') =>
    absence({ id, name, side: side as MatchAbsence['side'], reason_code: code, reason: 'x' });
  const squad = (id: string, name: string) =>
    absence({
      id,
      name,
      side: 'away',
      kind: 'other',
      reason: 'Not in the squad',
      reason_code: 'off_roster',
    });
  const BOARD: MatchAbsence[] = [
    injured('s1', 'Karabec', 'ankle'),
    injured('s2', 'Sevinsky', 'injury'),
    injured('s3', 'Mercado', 'calf'),
    injured('s4', 'Andersen', 'knee'),
    injured('s5', 'Rynes', 'ankle'),
    injured('s6', 'Penxa', 'knee'),
    injured('s7', 'Aririerisim', 'groin'),
    injured('b1', 'Scott', 'thigh', 'away'),
    injured('b2', 'Toth', 'muscle', 'away'),
    injured('b3', 'Araujo', 'thigh', 'away'),
    squad('b4', 'Jebbison'),
    squad('b5', 'Sousa'),
    squad('b6', 'Forster'),
    squad('b7', 'Sanchez'),
    squad('b8', 'Milosavljevic'),
  ];
  const html = card(listed(BOARD));
  const group = (side: 'home' | 'away', index: number) => {
    const from = html.indexOf(`data-absence-side="${side}"`);
    const to = side === 'home' ? html.indexOf('data-absence-side="away"') : html.length;
    return html.slice(from, to).split('data-absence-group=')[index + 1] ?? '';
  };

  it('groups a side by status and by why, with a count', () => {
    expect(
      absenceGroups(BOARD.filter((a) => a.side === 'away')).map((g) => [
        g.status,
        g.reason,
        g.absences.length,
        g.folded,
      ]),
    ).toEqual([
      ['out', 'player.availability.kind.injury', 3, false],
      ['out', 'matchCentre.absenceReason.off_roster', 5, true],
    ]);
    expect(group('home', 0)).toContain('Out · Injury (7)');
    expect(group('away', 0)).toContain('Out · Injury (3)');
    expect(group('away', 1)).toContain('Out · Not in the squad (5)');
    expect(html.match(/data-absence-group=/g)).toHaveLength(3);
  });

  it('says the status with an icon and a word: struck for out, half for doubtful', () => {
    expect(group('home', 0)).toMatch(/<h4[^>]*><svg[^>]*data-icon="not_supplied"[^]*?Out · Injury/);
    const mixed = card(listed());
    expect(mixed).toMatch(/<h4[^>]*><svg[^>]*data-icon="limited"[^]*?Doubtful · Injury \(1\)/);
    expect(mixed).toMatch(/<h4[^>]*><svg[^>]*data-icon="not_supplied"[^]*?Out · Suspension \(1\)/);
  });

  it('shows the first four of a long group and folds the rest behind a native disclosure', () => {
    const seven = group('home', 0);
    const [open, folded] = seven.split('<details');
    expect(open?.match(/<li /g)).toHaveLength(ABSENCES_SHOWN);
    expect(folded).toMatch(/<summary[^>]*>.*Show 3 more/);
    expect(folded?.match(/<li /g)).toHaveLength(3);
    // In name order across the fold: the four first, the other three behind it.
    expect(open).toContain('Andersen');
    expect(folded).toContain('Rynes');
    // No script: a `<details>` and nothing that listens.
    expect(seven).not.toMatch(/<button|onclick/i);
  });

  it('a group of four or fewer has no disclosure', () => {
    expect(group('away', 0)).not.toContain('<details');
    expect(group('away', 0).match(/<li /g)).toHaveLength(3);
  });

  it('closes the squad-selection group whole: its names behind "Show 5 names"', () => {
    const five = group('away', 1);
    const [open, folded] = five.split('<details');
    expect(open).not.toContain('<li ');
    expect(folded).toMatch(/<summary[^>]*>.*Show 5 names/);
    expect(folded?.match(/<li /g)).toHaveLength(5);
  });

  it('a row says only what its group does not: the specific injury, never "Injury" twice', () => {
    const seven = group('home', 0);
    expect(seven).toContain(EN['matchCentre.absenceReason.ankle']);
    expect(seven).toContain(EN['matchCentre.absenceReason.knee']);
    // Sevinsky's reason is the group's own word: his row is his name alone.
    expect(seven).toMatch(/Sevinsky<\/a><\/li>/);
    // Not in the squad is the group's reason, said once.
    expect(group('away', 1).split('Not in the squad').length - 1).toBe(1);
  });

  it('keeps when the feed was asked under the grouped list (rule 4)', () => {
    expect(html).toContain('data-testid="absences-asked"');
    expect(html).toContain('As reported when last checked, 09:05.');
  });

  it('groups a reason it cannot name under the status alone', () => {
    const mixed = card(listed());
    expect(mixed).toContain('Out (1)');
    // The feed's own words beside the name, on an English page only.
    expect(mixed).toMatch(/Elphege<\/a><span class="text-muted">Something new<\/span>/);
    expect(card(listed(), 'fa')).not.toContain('Something new');
  });

  it('says it in Persian with Persian digits, logical properties only', () => {
    const fa = card(listed(BOARD), 'fa');
    expect(fa).toContain('غایب · مصدومیت (۷)');
    expect(fa).toContain('نمایش ۳ نفر دیگر');
    expect(fa).toContain('نمایش ۵ نام');
    expect(fa).not.toContain('data-translation="untranslated"');
    expect(fa).not.toMatch(
      /class="[^"]*(?<![\w-])(left|right|ml|mr|pl|pr|text-left|text-right)-[^"]*"/,
    );
  });
});
