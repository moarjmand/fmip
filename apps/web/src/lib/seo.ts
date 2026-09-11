import type { Metadata } from 'next';
import type { CompetitionPage, MatchHeader, PlayerPage, TeamPage } from '@fmip/contracts';
import { DEFAULT_LOCALE, LOCALES, isPseudoLocale } from '../i18n/locales';

/**
 * The SEO surface (T-039, D-040): one canonical URL per page under its
 * locale, language alternates for the shipped locales with `x-default` on
 * the default one, no indexing of the pseudo-locale or of pages that are a
 * member's own, and schema.org structured data for the entities. Pure, so
 * every URL and every JSON-LD shape is unit-tested.
 */

const DEFAULT_SITE_URL = 'http://localhost:3000';

/** The public origin, from `SITE_URL`, without a trailing slash. */
export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = env['SITE_URL']?.trim();
  return (raw === undefined || raw === '' ? DEFAULT_SITE_URL : raw).replace(/\/+$/, '');
}

/** The shipped locales that are languages, not QA surfaces. */
export const INDEXABLE_LOCALES: readonly string[] = LOCALES.filter((l) => !isPseudoLocale(l));

/** `https://site/en/scores`; `path` starts with `/` or is empty for the locale root. */
export function canonicalUrl(locale: string, path: string, origin = siteUrl()): string {
  return `${origin}/${locale}${path}`;
}

export interface PageMeta {
  locale: string;
  /** Path below the locale segment, e.g. `/scores`, `/match/<id>`; `` for the locale root. */
  path: string;
  title: string;
  description?: string;
  /** False for pages that are one member's own or a search result. Pseudo-locales are never indexed. */
  index?: boolean;
}

/** Title, description, canonical, alternates, robots and Open Graph for one page. */
export function pageMetadata(meta: PageMeta, origin = siteUrl()): Metadata {
  const canonical = canonicalUrl(meta.locale, meta.path, origin);
  const languages: Record<string, string> = {};
  for (const locale of INDEXABLE_LOCALES)
    languages[locale] = canonicalUrl(locale, meta.path, origin);
  languages['x-default'] = canonicalUrl(DEFAULT_LOCALE, meta.path, origin);
  const index = meta.index !== false && !isPseudoLocale(meta.locale);
  return {
    title: meta.title,
    ...(meta.description !== undefined ? { description: meta.description } : {}),
    alternates: { canonical, languages },
    robots: index ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: {
      title: meta.title,
      ...(meta.description !== undefined ? { description: meta.description } : {}),
      url: canonical,
      siteName: 'FMIP',
      type: 'website',
      locale: meta.locale,
    },
  };
}

// ---------------------------------------------------------------------------
// Structured data (schema.org). Each builder returns a plain object; the
// page serialises it into one `<script type="application/ld+json">`.
// ---------------------------------------------------------------------------

export type JsonLd = Record<string, unknown>;

const CONTEXT = 'https://schema.org';

/** The site itself, with the search action that lets engines offer a search box. */
export function websiteJsonLd(locale: string, origin = siteUrl()): JsonLd {
  return {
    '@context': CONTEXT,
    '@type': 'WebSite',
    name: 'FMIP',
    url: canonicalUrl(locale, '', origin),
    inLanguage: locale,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${canonicalUrl(locale, '/search', origin)}?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

const EVENT_STATUS: Record<string, string> = {
  scheduled: 'https://schema.org/EventScheduled',
  live: 'https://schema.org/EventScheduled',
  finished: 'https://schema.org/EventScheduled',
  postponed: 'https://schema.org/EventPostponed',
  suspended: 'https://schema.org/EventPostponed',
  cancelled: 'https://schema.org/EventCancelled',
  abandoned: 'https://schema.org/EventCancelled',
  awarded: 'https://schema.org/EventScheduled',
};

function team(locale: string, t: { id: string; name: string }, origin: string): JsonLd {
  return {
    '@type': 'SportsTeam',
    name: t.name,
    url: canonicalUrl(locale, `/team/${t.id}`, origin),
  };
}

/** A match as a schema.org SportsEvent: teams, kick-off, venue, status, the full-time score once there is one. */
export function matchJsonLd(locale: string, f: MatchHeader, origin = siteUrl()): JsonLd {
  const home = team(locale, f.home, origin);
  const away = team(locale, f.away, origin);
  const fullTime = f.status === 'finished' ? (f.scores.full_time ?? f.scores.current) : null;
  return {
    '@context': CONTEXT,
    '@type': 'SportsEvent',
    name: `${f.home.name} v ${f.away.name}`,
    url: canonicalUrl(locale, `/match/${f.id}`, origin),
    startDate: f.kickoff_at,
    eventStatus: EVENT_STATUS[f.status] ?? EVENT_STATUS.scheduled,
    sport: 'Football',
    homeTeam: home,
    awayTeam: away,
    competitor: [home, away],
    organizer: {
      '@type': 'SportsOrganization',
      name: f.competition.name,
      url: canonicalUrl(locale, `/competition/${f.competition.id}?season=${f.season.id}`, origin),
    },
    ...(f.venue !== null
      ? {
          location: {
            '@type': 'Place',
            name: f.venue.name,
            ...(f.venue.city !== null ? { address: f.venue.city } : {}),
          },
        }
      : {}),
    ...(fullTime !== null
      ? { description: `Full time ${f.home.name} ${fullTime.home}–${fullTime.away} ${f.away.name}` }
      : {}),
  };
}

export function teamJsonLd(locale: string, t: TeamPage['team'], origin = siteUrl()): JsonLd {
  return {
    '@context': CONTEXT,
    '@type': 'SportsTeam',
    name: t.name,
    ...(t.short_name !== null ? { alternateName: t.short_name } : {}),
    url: canonicalUrl(locale, `/team/${t.id}`, origin),
    sport: 'Football',
    ...(t.founded_year !== null ? { foundingDate: String(t.founded_year) } : {}),
    ...(t.country !== null ? { location: { '@type': 'Country', name: t.country.name } } : {}),
    ...(t.venue !== null
      ? {
          homeLocation: {
            '@type': 'StadiumOrArena',
            name: t.venue.name,
            ...(t.venue.city !== null ? { address: t.venue.city } : {}),
          },
        }
      : {}),
  };
}

export function competitionJsonLd(
  locale: string,
  page: Pick<CompetitionPage, 'competition' | 'season'>,
  origin = siteUrl(),
): JsonLd {
  const c = page.competition;
  return {
    '@context': CONTEXT,
    '@type': 'SportsOrganization',
    name: c.name,
    ...(c.short_name !== null ? { alternateName: c.short_name } : {}),
    url: canonicalUrl(locale, `/competition/${c.id}?season=${page.season.id}`, origin),
    sport: 'Football',
    ...(c.country !== null ? { areaServed: { '@type': 'Country', name: c.country.name } } : {}),
    subjectOf: { '@type': 'Season', name: page.season.label },
  };
}

export function playerJsonLd(
  locale: string,
  page: Pick<PlayerPage, 'person' | 'current_spell'>,
  origin = siteUrl(),
): JsonLd {
  const p = page.person;
  return {
    '@context': CONTEXT,
    '@type': 'Person',
    name: p.known_as ?? p.full_name,
    ...(p.known_as !== null ? { alternateName: p.full_name } : {}),
    url: canonicalUrl(locale, `/player/${p.id}`, origin),
    ...(p.date_of_birth !== null ? { birthDate: p.date_of_birth } : {}),
    ...(p.nationality !== null
      ? { nationality: { '@type': 'Country', name: p.nationality.name } }
      : {}),
    ...(p.height_cm !== null
      ? { height: { '@type': 'QuantitativeValue', value: p.height_cm, unitCode: 'CMT' } }
      : {}),
    ...(page.current_spell !== null
      ? { memberOf: team(locale, page.current_spell.team, origin) }
      : {}),
  };
}

export function breadcrumbJsonLd(items: readonly { name: string; url: string }[]): JsonLd {
  return {
    '@context': CONTEXT,
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}
