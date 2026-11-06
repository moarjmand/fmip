import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MatchCentre } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EN } from '@/i18n/messages';
import { matchWords } from '@/lib/words-server';
import { type MatchHero, MatchCentreView } from './match-centre-view';
import { FreshnessLine } from './match-freshness-line';

/**
 * The phone's short top block (T-1743, D-364; board P2-4): the freshness
 * line and its details -- fresh, stale and in play -- the line for the day
 * and the ground, and that nothing the band said is lost or said as current
 * when it may be old (rule 4). Real times from the Everton v Coventry page
 * of 6 November 2026.
 */

const KICKOFF = '2026-11-06T20:00:00.000Z';
const CHANGED = '2026-11-05T15:07:03.111Z';
const CHECKED = '2026-11-06T07:07:03.240Z';
/** 6 November, 08:00 in London: the check is today, the change yesterday. */
const NOW = Date.parse('2026-11-06T08:00:00.000Z');
const PHYSICAL = /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/;

const empty = { coverage: 'not_supplied' as const, last_updated_at: null, data: null };
const team = (id: string, name: string) => ({ id, name, short_name: null, code: null });
const centre = (over: Partial<MatchCentre['fixture']> = {}): MatchCentre =>
  ({
    fixture: {
      id: 'f1',
      kickoff_at: KICKOFF,
      status: 'scheduled',
      minute: null,
      competition: { id: 'c', name: 'Premier League', short_name: null, country_id: null },
      season: { id: 's', label: '2026/27' },
      stage: null,
      round: null,
      group_name: null,
      leg: null,
      home: team('h', 'Everton'),
      away: team('a', 'Coventry'),
      scores: {
        current: null,
        half_time: null,
        full_time: null,
        extra_time: null,
        penalties: null,
        aggregate: null,
      },
      venue: { id: 'v', name: 'Hill Dickinson Stadium', city: 'Liverpool' },
      is_neutral_venue: false,
      referee: { name: 'Stuart Attwell' },
      attendance: null,
      periods: [],
      last_updated_at: CHANGED,
      last_checked_at: CHECKED,
      freshness: null,
      ...over,
    },
    timeline: empty,
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
  }) as MatchCentre;
const live = (over: Partial<MatchCentre['fixture']> = {}) =>
  centre({
    status: 'live',
    minute: 14,
    scores: { ...centre().fixture.scores, current: { home: 2, away: 0 } },
    last_updated_at: '2026-11-06T20:14:30.000Z',
    last_checked_at: null,
    ...over,
  });

const WATCH = <a href="#watch">WATCH</a>;
function view(c: MatchCentre, now = NOW, locale = 'en', hero: MatchHero = {}): string {
  return renderToStaticMarkup(
    <MatchCentreView
      words={matchWords(locale)}
      centre={c}
      timeZone="Europe/London"
      locale={locale}
      now={now}
      hero={{ zone: locale === 'fa' ? 'به وقت London' : 'UK time', watch: WATCH, ...hero }}
    />,
  );
}
const between = (html: string, from: string, to: string) => {
  const start = html.indexOf(from);
  return html.slice(start, html.indexOf(to, start));
};
/** The phone's block: the day and ground line, then the freshness line. */
const phone = (html: string) => between(html, 'data-testid="match-facts-phone"', '</details>');
const summary = (html: string) => between(phone(html), '<summary', '</summary>');
const details = (html: string) => between(phone(html), 'data-testid="freshness-facts"', '</ul>');
const text = (html: string) =>
  html
    // A time sits inside its sentence; every other tag is a break.
    .replace(/<\/?time[^>]*>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

describe('the freshness line, fresh (T-1743)', () => {
  const html = view(centre());

  it('says when the data was last checked, as a clock reading, in the caption colour', () => {
    const line = summary(html);
    expect(line).toContain('data-freshness="current"');
    expect(text(`<${line}`)).toBe('● Data checked 07:07 Details ▾');
    expect(line).toMatch(/<time dateTime="2026-11-06T07:07:03\.240Z">07:07<\/time>/);
    expect(line).toContain('text-caption');
    expect(line).not.toContain('text-warning');
    // A reading, never an age that would need a timer.
    expect(text(`<${line}`)).not.toMatch(/ago|sec|min/);
  });

  it('keeps the rest behind a native disclosure: checked and unchanged since, the full kick-off and zone, the referee, where to watch', () => {
    expect(phone(html)).toMatch(/<details class="group" data-testid="freshness-details">/);
    const facts = details(html);
    const items = facts
      .split('<li')
      .slice(1)
      .map((li) => text(`<li${li}`));
    expect(items).toEqual([
      'Data last checked 07:07; unchanged since yesterday (5 Nov 2026, 15:07)',
      'Kick-off 6 Nov 2026, 20:00 UK time',
      'Referee: Stuart Attwell',
      'WATCH',
    ]);
    expect(facts).toContain('<a href="#watch">WATCH</a>');
  });

  it('puts the day and the ground on one line, and the day no longer under the time on a phone', () => {
    const block = phone(html);
    expect(text(`<${between(block, 'p class=', '</p>')}`)).toBe(
      'Fri 6 Nov · Hill Dickinson Stadium, Liverpool',
    );
    expect(block).toContain('<bdi>Hill Dickinson Stadium, Liverpool</bdi>');
    expect(html).toMatch(
      /<span class="[^"]*max-md:hidden[^"]*"><time dateTime="2026-11-06T20:00:00\.000Z">Fri 6 Nov<\/time><\/span>/,
    );
  });

  it('is the phone’s alone: from 768px the facts row and the watch line stand as they did', () => {
    expect(html).toMatch(/<div class="flex flex-col md:hidden" data-testid="match-facts-phone">/);
    const row = between(html, '<ul class="flex flex-wrap justify-center', '</ul>');
    expect(row).toContain('max-md:hidden');
    expect(text(`<${row}`)).toBe(
      'Kick-off 6 Nov 2026, 20:00 Hill Dickinson Stadium, Liverpool Referee: Stuart Attwell ● Data last checked 07:07; unchanged since yesterday (5 Nov 2026, 15:07)',
    );
    expect(row).toContain('data-testid="last-update"');
    expect(html).toContain('<div class="max-md:hidden"><a href="#watch">WATCH</a></div>');
  });

  it('says the change alone when no later check is known, and its day when that is not today', () => {
    const html2 = view(centre({ last_checked_at: null }));
    expect(text(`<${summary(html2)}`)).toBe(
      '● Data checked yesterday (5 Nov 2026, 15:07) Details ▾',
    );
    expect(details(html2)).toContain('Last data update');
    // No clock (a pure render): the full date and time, never mistaken for today.
    const pure = renderToStaticMarkup(
      <FreshnessLine
        checkedAt={CHECKED}
        changedAt={CHANGED}
        stale={false}
        locale="en"
        timeZone="Europe/London"
        now={undefined}
        words={matchWords('en')}
      >
        <li>FACT</li>
      </FreshnessLine>,
    );
    expect(pure).toContain('6 Nov 2026, 07:07');
  });

  it('keeps a score a reader should not have to open anything for: the aggregate is on the line', () => {
    const second = view(
      centre({ leg: 2, scores: { ...centre().fixture.scores, aggregate: { home: 3, away: 2 } } }),
    );
    expect(text(`<${between(phone(second), 'p class=', '</p>')}`)).toContain('· Agg 3–2');
    expect(details(second)).not.toContain('Agg');
  });

  it('Persian: the reader’s words and digits', () => {
    const fa = view(centre(), NOW, 'fa');
    expect(text(`<${summary(fa)}`)).toBe('● آخرین بررسی داده‌ها ۰۷:۰۷ جزئیات ▾');
    expect(details(fa)).toContain('به وقت London');
    expect(details(fa)).toContain('داور: Stuart Attwell');
    expect(phone(fa)).not.toMatch(PHYSICAL);
    expect(phone(view(centre(), NOW, 'x-rtl'))).not.toMatch(PHYSICAL);
  });
});

describe('the freshness line, stale (T-1743, rule 4)', () => {
  it('a match in play whose data is behind: the warning is the line itself, outside the disclosure', () => {
    const html = view(live(), Date.parse('2026-11-06T20:30:00.000Z'));
    const line = summary(html);
    expect(line).toContain('data-freshness="behind"');
    expect(line).toContain('text-warning');
    // Not colour alone: a triangle and the words.
    expect(text(`<${line}`)).toBe('▲ Data may be out of date, last checked 20:14 Details ▾');
    expect(details(html)).not.toContain(EN['matchCentre.freshness.stale'].split(',')[0]);
    // The band's own sentence stays as well, for every width.
    expect(html).toContain('data-testid="feed-behind"');
    expect(between(html, 'data-testid="feed-behind"', '</p>')).not.toContain('md:hidden');
  });

  it('a kick-off long past with no word: stale, and never "checked" as if all were well', () => {
    const late = view(
      centre({ freshness: 'awaiting_update' }),
      Date.parse('2026-11-07T08:00:00.000Z'),
      'en',
      { awaiting: <p data-testid="awaiting-update">NOTICE</p> },
    );
    expect(summary(late)).toContain('data-freshness="behind"');
    expect(text(`<${summary(late)}`)).toMatch(/^▲ Data may be out of date, last checked yesterday/);
    expect(late).toContain('data-testid="awaiting-update"');
    // Persian.
    const fa = view(centre({ freshness: 'awaiting_update' }), NOW, 'fa');
    expect(text(`<${summary(fa)}`)).toMatch(/^▲ داده‌ها شاید به‌روز نباشند؛ آخرین بررسی ۰۷:۰۷/);
  });

  it('a broken stream before kick-off is said under the band, at every width', () => {
    const warning = (
      <p data-testid="live-state" data-state="unavailable" role="status">
        STREAM
      </p>
    );
    const html = view(centre(), NOW, 'en', { live: warning });
    const at = html.indexOf('data-testid="live-state"');
    expect(at).toBeGreaterThan(0);
    // Outside the details, and not in a block hidden on a phone.
    expect(at).toBeLessThan(html.indexOf('data-testid="match-facts-phone"'));
    expect(
      between(html, '<div class="flex flex-col items-center gap-2 text-center', 'STREAM'),
    ).not.toContain('max-md:hidden');
  });
});

describe('the freshness line, in play (T-1743)', () => {
  const STAMP = <span data-testid="live-state">Last checked 4 sec ago</span>;
  const html = view(live(), Date.parse('2026-11-06T20:15:00.000Z'), 'en', { live: STAMP });

  it('is current while the data is, and the stream’s own stamp stays with the minute', () => {
    expect(summary(html)).toContain('data-freshness="current"');
    expect(text(`<${summary(html)}`)).toBe('● Data checked 20:14 Details ▾');
    const progress = between(
      html,
      'data-testid="live-progress"',
      'data-testid="match-facts-phone"',
    );
    expect(progress).toContain('Last checked 4 sec ago');
    expect(html.split('data-testid="live-state"').length - 1).toBe(1);
  });

  it('after full time: the result’s last check, no stream line, a shoot-out in the details', () => {
    const done = view(
      centre({
        status: 'finished',
        scores: {
          current: { home: 1, away: 1 },
          half_time: { home: 0, away: 1 },
          full_time: { home: 1, away: 1 },
          extra_time: { home: 0, away: 0 },
          penalties: { home: 6, away: 5 },
          aggregate: null,
        },
        attendance: 39000,
      }),
    );
    expect(summary(done)).toContain('data-freshness="current"');
    expect(details(done)).toContain('Attendance 39,000');
    expect(text(`<${details(done)}`)).toContain('Pens 6–5');
    expect(done).not.toContain('data-testid="live-state"');
  });
});

describe('the freshness line is markup alone (T-1743)', () => {
  it('has no timer, state or effect: nothing ticks for a match that is not in play', () => {
    const source = readFileSync(join(__dirname, 'match-freshness-line.tsx'), 'utf8');
    expect(source).not.toMatch(/^'use client'/m);
    expect(source).not.toMatch(/use(State|Effect|Ref)\b|setInterval|setTimeout|formatAgo/);
    expect(source).toContain('<details');
  });
});
