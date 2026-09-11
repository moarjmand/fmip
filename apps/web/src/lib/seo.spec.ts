import type { MatchHeader } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  breadcrumbJsonLd,
  canonicalUrl,
  matchJsonLd,
  pageMetadata,
  playerJsonLd,
  siteUrl,
  teamJsonLd,
  websiteJsonLd,
} from './seo';

const ORIGIN = 'https://fmip.example';

const header = (over: Partial<MatchHeader> = {}): MatchHeader => ({
  id: 'f1',
  kickoff_at: '2025-09-01T15:00:00.000Z',
  status: 'scheduled',
  minute: null,
  competition: { id: 'c1', name: 'Test League', short_name: 'TL', country_id: null },
  season: { id: 's1', label: '2025/26' },
  stage: null,
  round: null,
  group_name: null,
  leg: null,
  home: {
    id: 'a',
    name: 'Test Alpha',
    short_name: 'ALP',
    code: null,
    red_cards: 0,
    formation: null,
    coach: null,
  } as MatchHeader['home'],
  away: {
    id: 'b',
    name: 'Test Beta',
    short_name: null,
    code: null,
    red_cards: 0,
    formation: null,
    coach: null,
  } as MatchHeader['away'],
  scores: {
    current: null,
    half_time: null,
    full_time: null,
    extra_time: null,
    penalties: null,
    aggregate: null,
  },
  venue: { id: 'v', name: 'Test Ground', city: 'Testville' },
  is_neutral_venue: false,
  referee: null,
  attendance: null,
  periods: [],
  last_updated_at: '2025-09-01T15:00:00.000Z',
  ...over,
});

describe('urls', () => {
  it('reads the site origin from SITE_URL, trailing slash dropped, with a local default', () => {
    expect(siteUrl({})).toBe('http://localhost:3000');
    expect(siteUrl({ SITE_URL: 'https://fmip.example/' })).toBe('https://fmip.example');
    expect(siteUrl({ SITE_URL: '  ' })).toBe('http://localhost:3000');
  });

  it('builds the canonical under the locale', () => {
    expect(canonicalUrl('en', '/scores', ORIGIN)).toBe('https://fmip.example/en/scores');
    expect(canonicalUrl('en', '', ORIGIN)).toBe('https://fmip.example/en');
  });
});

describe('pageMetadata', () => {
  it('sets canonical, language alternates with x-default, indexing and Open Graph', () => {
    const meta = pageMetadata(
      { locale: 'en', path: '/scores', title: 'Scores · FMIP', description: 'Today.' },
      ORIGIN,
    );
    expect(meta.title).toBe('Scores · FMIP');
    expect(meta.alternates).toEqual({
      canonical: 'https://fmip.example/en/scores',
      languages: {
        en: 'https://fmip.example/en/scores',
        'x-default': 'https://fmip.example/en/scores',
      },
    });
    expect(meta.robots).toEqual({ index: true, follow: true });
    expect(meta.openGraph).toMatchObject({
      url: 'https://fmip.example/en/scores',
      siteName: 'FMIP',
      locale: 'en',
    });
  });

  it('never indexes the pseudo-locale or a page marked private', () => {
    expect(pageMetadata({ locale: 'x-rtl', path: '/scores', title: 'x' }, ORIGIN).robots).toEqual({
      index: false,
      follow: false,
    });
    expect(
      pageMetadata({ locale: 'en', path: '/settings', title: 'x', index: false }, ORIGIN).robots,
    ).toEqual({ index: false, follow: false });
    // The alternates never point at the pseudo-locale.
    const languages = pageMetadata({ locale: 'x-rtl', path: '', title: 'x' }, ORIGIN).alternates
      ?.languages as Record<string, string>;
    expect(Object.keys(languages)).toEqual(['en', 'x-default']);
  });
});

describe('structured data', () => {
  it('describes the site with a search action', () => {
    const site = websiteJsonLd('en', ORIGIN);
    expect(site).toMatchObject({ '@type': 'WebSite', url: 'https://fmip.example/en' });
    expect((site.potentialAction as { target: { urlTemplate: string } }).target.urlTemplate).toBe(
      'https://fmip.example/en/search?q={search_term_string}',
    );
  });

  it('describes a match as a SportsEvent with teams, venue, status and the score once played', () => {
    const scheduled = matchJsonLd('en', header(), ORIGIN);
    expect(scheduled).toMatchObject({
      '@type': 'SportsEvent',
      name: 'Test Alpha v Test Beta',
      url: 'https://fmip.example/en/match/f1',
      startDate: '2025-09-01T15:00:00.000Z',
      eventStatus: 'https://schema.org/EventScheduled',
      homeTeam: {
        '@type': 'SportsTeam',
        name: 'Test Alpha',
        url: 'https://fmip.example/en/team/a',
      },
      location: { '@type': 'Place', name: 'Test Ground', address: 'Testville' },
    });
    expect(scheduled.description).toBeUndefined();

    const finished = matchJsonLd(
      'en',
      header({
        status: 'finished',
        scores: {
          current: { home: 2, away: 1 },
          half_time: null,
          full_time: { home: 2, away: 1 },
          extra_time: null,
          penalties: null,
          aggregate: null,
        },
        venue: null,
      }),
      ORIGIN,
    );
    expect(finished.description).toBe('Full time Test Alpha 2–1 Test Beta');
    expect(finished.location).toBeUndefined();
    expect(matchJsonLd('en', header({ status: 'postponed' }), ORIGIN).eventStatus).toBe(
      'https://schema.org/EventPostponed',
    );
  });

  it('describes a team, a player and a breadcrumb trail', () => {
    expect(
      teamJsonLd(
        'en',
        {
          id: 'a',
          name: 'Test Alpha',
          short_name: 'ALP',
          code: null,
          kind: 'club',
          gender: 'men',
          age_group: 'senior',
          founded_year: 1901,
          country: { id: 'c', name: 'England', code: 'ENG' },
          venue: { id: 'v', name: 'Test Ground', city: null, capacity: null },
        },
        ORIGIN,
      ),
    ).toMatchObject({
      '@type': 'SportsTeam',
      alternateName: 'ALP',
      foundingDate: '1901',
      location: { name: 'England' },
      homeLocation: { name: 'Test Ground' },
    });
    expect(
      playerJsonLd(
        'en',
        {
          person: {
            id: 'p',
            full_name: 'Test Player',
            known_as: 'Player',
            date_of_birth: '2000-02-29',
            nationality: { id: 'c', name: 'England', code: 'ENG' },
            height_cm: 181,
            preferred_foot: 'left',
          },
          current_spell: {
            team: { id: 'a', name: 'Test Alpha', short_name: null },
            start_date: '2025-07-01',
            end_date: null,
            shirt_number: 8,
            position: 'midfielder',
            on_loan: false,
          },
        },
        ORIGIN,
      ),
    ).toMatchObject({
      '@type': 'Person',
      name: 'Player',
      alternateName: 'Test Player',
      birthDate: '2000-02-29',
      height: { value: 181, unitCode: 'CMT' },
      memberOf: { name: 'Test Alpha' },
    });
    expect(
      breadcrumbJsonLd([
        { name: 'FMIP', url: 'https://fmip.example/en' },
        { name: 'Scores', url: 'https://fmip.example/en/scores' },
      ]).itemListElement,
    ).toEqual([
      { '@type': 'ListItem', position: 1, name: 'FMIP', item: 'https://fmip.example/en' },
      { '@type': 'ListItem', position: 2, name: 'Scores', item: 'https://fmip.example/en/scores' },
    ]);
  });
});
