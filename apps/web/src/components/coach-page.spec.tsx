import type { CoachCareerSpell, CoachPage } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { coachSpellPeriod, currentSpells } from '@/lib/coach';
import { CoachBand, CoachCareerPanel, CoachLineupsPanel } from './coach-page';

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
    expect(html).toContain('No current team in the provider&#x27;s list');
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
    expect(html).toContain('The provider has not described this coach yet.');
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
