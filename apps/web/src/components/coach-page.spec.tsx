import type { CoachCareerSpell, CoachPage } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  COACH_RECORD_STALE_DAYS,
  coachSpellPeriod,
  currentSpells,
  staleRecordDays,
} from '@/lib/coach';
import { CoachBand, CoachCareerPanel, CoachLineupsPanel, CoachRecordPanel } from './coach-page';

/**
 * The coach page (T-1439, D-230): an open
 * spell is "present" only when it is current, a missing date or birth is
 * said as such, and spells at teams we do not cover are counted, never
 * named. The team page's head coach is in `club-page.spec.tsx`.
 */

const PHYSICAL = /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/;
const NO_MEDIA = { coverage: 'not_supplied', url: null } as const;

function spell(over: Partial<CoachCareerSpell> = {}): CoachCareerSpell {
  return {
    team: {
      id: 't-city',
      name: 'Manchester City',
      short_name: null,
      kind: 'club',
      crest: NO_MEDIA,
    },
    start_date: '2026-08-01',
    end_date: null,
    current: true,
    ...over,
  };
}

function page(over: Partial<CoachPage> = {}): CoachPage {
  return {
    coach: {
      id: 'p-maresca',
      name: 'Enzo Maresca',
      photo: NO_MEDIA,
      date_of_birth: '1980-02-10',
      nationality: { id: 'c-ita', name: 'Italy' },
    },
    career: {
      coverage: 'limited',
      last_updated_at: '2026-10-21T10:00:00.000Z',
      data: [
        spell(),
        spell({
          team: {
            id: 't-chelsea',
            name: 'Chelsea',
            short_name: null,
            kind: 'club',
            crest: NO_MEDIA,
          },
          start_date: '2024-06-01',
          current: false,
        }),
        spell({
          team: {
            id: 't-leicester',
            name: 'Leicester City',
            short_name: null,
            kind: 'club',
            crest: NO_MEDIA,
          },
          start_date: '2023-07-01',
          end_date: '2024-06-01',
          current: false,
        }),
      ],
    },
    spells_not_carried: 3,
    lineups: {
      count: 12,
      latest: {
        fixture_id: 'f-1',
        kickoff_at: '2026-10-18T14:00:00.000Z',
        team: { id: 't-city', name: 'Manchester City' },
      },
    },
    last_updated_at: '2026-10-21T10:00:00.000Z',
    ...over,
  };
}

describe("a spell's period", () => {
  it('runs to "present" only when current; an open spell that is not says its end was not given', () => {
    expect(coachSpellPeriod('en', spell())).toBe('Aug 2026 – present');
    expect(coachSpellPeriod('en', spell({ current: false }))).toBe('Aug 2026 – end not given');
    expect(
      coachSpellPeriod('en', spell({ start_date: null, end_date: '2021-11-01', current: false })),
    ).toBe('start not given – Nov 2021');
  });

  it('reads the current spells from the career only', () => {
    expect(currentSpells(page()).map((s) => s.team.id)).toEqual(['t-city']);
    expect(
      currentSpells(
        page({ career: { coverage: 'not_supplied', last_updated_at: null, data: null } }),
      ),
    ).toEqual([]);
  });
});

describe('the coach page', () => {
  it('shows the current team, nationality and age in the band', () => {
    const html = renderToStaticMarkup(<CoachBand page={page()} locale="en" />);
    expect(html).toContain('Enzo Maresca');
    expect(html).toContain('href="/en/team/t-city"');
    expect(html).toContain('Italy');
    expect(html).toContain('born');
  });

  it('says a birth date and a current team it does not hold', () => {
    const html = renderToStaticMarkup(
      <CoachBand
        page={page({
          coach: { ...page().coach, date_of_birth: null, nationality: null },
          career: {
            coverage: 'available',
            last_updated_at: null,
            data: [spell({ current: false })],
          },
        })}
        locale="en"
      />,
    );
    expect(html).toContain('No current team in the coaching record');
    expect(html).toContain('data-coverage-badge="not_supplied"');
  });

  it('lists the career with its coverage, the current spell marked, and counts what we do not cover', () => {
    const html = renderToStaticMarkup(
      <CoachCareerPanel page={page()} locale="en" timeZone="UTC" />,
    );
    expect(html.match(/data-testid="coach-spell"/g)).toHaveLength(3);
    expect(html.match(/data-current="true"/g)).toHaveLength(1);
    expect(html).toContain('end not given');
    expect(html).toContain('3 more spells');
    expect(html).toContain('data-coverage-badge="limited"');
    expect(html).not.toMatch(PHYSICAL);
  });

  it('says the provider has not described a coach it was never asked about', () => {
    const html = renderToStaticMarkup(
      <CoachCareerPanel
        page={page({
          career: { coverage: 'not_supplied', last_updated_at: null, data: null },
          spells_not_carried: 0,
        })}
        locale="en"
        timeZone="UTC"
      />,
    );
    expect(html).toContain('Our data source has not described this coach yet.');
    expect(html).not.toContain('coach-not-carried');
  });

  it('links the latest line-up that names him, or says none does', () => {
    expect(
      renderToStaticMarkup(<CoachLineupsPanel page={page()} locale="en" timeZone="UTC" />),
    ).toContain('href="/en/match/f-1"');
    expect(
      renderToStaticMarkup(
        <CoachLineupsPanel
          page={page({ lineups: { count: 0, latest: null } })}
          locale="en"
          timeZone="UTC"
        />,
      ),
    ).toContain('No line-up we hold names this coach.');
  });

  it('is written in Persian on /fa', () => {
    const html = renderToStaticMarkup(
      <CoachCareerPanel page={page()} locale="fa" timeZone="UTC" />,
    );
    expect(html).toContain('کارنامه');
    expect(html).toContain('فعلی');
  });
});

describe('the record’s age and the record card (T-1807, D-406)', () => {
  // The fixture's career was updated on 21 Oct, 10:00 UTC.
  const FRESH = new Date('2026-10-28T09:00:00.000Z');
  const OLD = new Date('2026-11-09T12:00:00.000Z');

  it('calls a record stale only past the named seven days, and says how many days', () => {
    expect(COACH_RECORD_STALE_DAYS).toBe(7);
    expect(staleRecordDays('2026-10-21T10:00:00.000Z', FRESH)).toBeNull();
    expect(
      staleRecordDays('2026-10-21T10:00:00.000Z', new Date('2026-10-28T10:00:00.000Z')),
    ).toBeNull();
    expect(staleRecordDays('2026-10-21T10:00:00.000Z', new Date('2026-10-29T10:00:00.000Z'))).toBe(
      8,
    );
    expect(staleRecordDays('2026-10-21T10:00:00.000Z', OLD)).toBe(19);
    expect(staleRecordDays(null, OLD)).toBeNull();
    expect(staleRecordDays('not a date', OLD)).toBeNull();
  });

  it('marks "Coaching now" and the career with the age in words once stale, and not before', () => {
    const fresh = renderToStaticMarkup(
      <>
        <CoachBand page={page()} locale="en" now={FRESH} />
        <CoachCareerPanel page={page()} locale="en" timeZone="UTC" now={FRESH} />
      </>,
    );
    expect(fresh).not.toContain('data-testid="coach-stale"');
    expect(fresh).not.toContain('data-testid="coach-career-stale"');

    const old = renderToStaticMarkup(
      <>
        <CoachBand page={page()} locale="en" now={OLD} />
        <CoachCareerPanel page={page()} locale="en" timeZone="UTC" now={OLD} />
      </>,
    );
    expect(old).toMatch(/data-testid="coach-stale"[^>]*>.*record updated 19 days ago/);
    expect(old).toMatch(
      /data-testid="coach-career-stale"[^>]*>.*last updated 19 days ago, so “Current” is as of then\./,
    );
    // An icon and words, never colour alone.
    expect(old).toMatch(/data-testid="coach-stale"[^>]*><svg/);
    expect(old).not.toMatch(PHYSICAL);
    const fa = renderToStaticMarkup(<CoachBand page={page()} locale="fa" now={OLD} />);
    expect(fa).toContain('۱۹ روز پیش');
  });

  it('puts no age beside a band that names no current team', () => {
    const none = page({
      career: {
        coverage: 'available',
        last_updated_at: '2026-10-21T10:00:00.000Z',
        data: [spell({ current: false, end_date: '2025-01-01' })],
      },
    });
    expect(renderToStaticMarkup(<CoachBand page={none} locale="en" now={OLD} />)).not.toContain(
      'data-testid="coach-stale"',
    );
  });

  it('draws the record as a labelled gap with its coverage, never numbers', () => {
    const html = renderToStaticMarkup(<CoachRecordPanel page={page()} locale="en" />);
    expect(html).toContain('Record with Manchester City');
    expect(html).toMatch(/[Nn]ot supplied/);
    expect(html).toContain('data-testid="coach-record-gap"');
    expect(html.replace(/<[^>]+>/g, '')).not.toMatch(/\d/);
    const none = page({ career: { coverage: 'not_supplied', last_updated_at: null, data: null } });
    expect(renderToStaticMarkup(<CoachRecordPanel page={none} locale="en" />)).toMatch(/>Record</);
  });
});
