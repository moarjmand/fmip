import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { CompetitionsDirectory, type ShownGroup } from '@/components/competitions-directory';
import { CountryFlag, RegionMark } from '@/components/country-flag';
import { EntityImage } from '@/components/entity-image';
import { Translated } from '@/components/translated';
import { Notice } from '@/components/ui';
import { localDigits } from '@/i18n/format';
import { attribute, message, plural, type Message } from '@/i18n/messages';
import { fetchCompetitionDirectory } from '@/lib/api';
import { KIND_KEY, pageLocale, say } from '@/lib/competition';
import { chosenGroup, directoryGroups } from '@/lib/competitions-directory';
import { pageMetadata } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    path: '/competitions',
    title: `${say(locale, 'competitions.title')} · Stadiomind`,
    description: say(locale, 'competitions.metaDescription'),
  });
}

/** `?q=`, the filter a reader without a script sent (or a shared address carries). */
function readFilter(query: Record<string, string | string[] | undefined>): string {
  const raw = Array.isArray(query.q) ? query.q[0] : query.q;
  return (raw ?? '').slice(0, 80);
}

/** `?country=`, the country or region a tile chose (T-1612): its slug, as sent. */
function readCountry(query: Record<string, string | string[] | undefined>): string {
  const raw = Array.isArray(query.country) ? query.country[0] : query.country;
  return (raw ?? '').slice(0, 40);
}

/**
 * All competitions (T-1433, T-1612): every league and cup we follow, from
 * our own API (`GET /competitions/directory`), grouped -- international,
 * then continental, then each country. A chooser of tiles (flag, name, how
 * many competitions, their logos) narrows the list to one group
 * (`?country=`), a filter by name or country narrows it further (`?q=`), and
 * each competition is a card that opens its page. The header's competitions
 * bar leads here. An unreachable API is said out loud, never shown as an
 * empty list, and an empty catalogue says that nothing is followed yet
 * (rule 3).
 */
export default async function CompetitionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const lang = pageLocale(locale);
  const answer = await fetchCompetitionDirectory();
  const groups: ShownGroup[] = answer.ok
    ? directoryGroups(answer.data.competitions, lang).map((group) => ({
        ...group,
        heading:
          group.kind === 'international'
            ? say(locale, 'competitions.group.international')
            : group.kind === 'continental'
              ? say(locale, 'competitions.group.continental')
              : (group.name ?? ''),
        count: plural(lang, 'competitions.count', group.competitions.length),
        // The season in the reader's digits: «۲۰۲۵/۲۶» on /fa.
        competitions: group.competitions.map((c) => ({
          ...c,
          season: c.season === null ? null : localDigits(lang, c.season),
        })),
      }))
    : [];
  const competitions = groups.flatMap((g) => g.competitions);
  const marks: Record<string, ReactNode> = {
    all: <RegionMark key="all" region="all" />,
    ...Object.fromEntries(
      groups.map((g) => [
        g.key,
        g.kind === 'country' ? (
          <CountryFlag key={g.key} flag={g.flag} code={g.code} />
        ) : (
          <RegionMark key={g.key} region={g.kind} />
        ),
      ]),
    ),
  };
  const kinds: Partial<Record<string, Message>> = Object.fromEntries(
    [...new Set(competitions.map((c) => c.kind))].flatMap((kind) =>
      KIND_KEY[kind] === undefined ? [] : [[kind, message(lang, KIND_KEY[kind])]],
    ),
  );

  return (
    <main className="page-frame flex flex-col gap-6 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="border-s-4 border-s-accent ps-4 text-2xl font-semibold" data-testid="title">
          <Translated locale={locale} message="competitions.title" />
        </h1>
        <p className="text-muted">
          <Translated locale={locale} message="competitions.lead" />
        </p>
      </header>

      {!answer.ok ? (
        <Notice tone="danger" data-testid="competitions-unreachable">
          <Translated locale={locale} message="competitions.unreachable" />
        </Notice>
      ) : groups.length === 0 ? (
        <p className="text-muted" data-testid="competitions-empty">
          <Translated locale={locale} message="competitions.empty" />
        </p>
      ) : (
        <CompetitionsDirectory
          locale={locale}
          groups={groups}
          marks={marks}
          minis={Object.fromEntries(
            competitions.map((c) => [
              c.id,
              <EntityImage key={c.id} media={c.logo} kind="logo" name={c.name} size={20} />,
            ]),
          )}
          logos={Object.fromEntries(
            competitions.map((c) => [
              c.id,
              <EntityImage key={c.id} media={c.logo} kind="logo" name={c.name} size={48} />,
            ]),
          )}
          kinds={kinds}
          initialFilter={readFilter(query)}
          initialGroup={chosenGroup(groups, readCountry(query))}
          words={{
            filter: attribute(lang, 'competitions.filter'),
            jump: attribute(lang, 'competitions.jump'),
            noMatch: message(lang, 'competitions.noMatch'),
            all: message(lang, 'competitions.region.all'),
            allCount: plural(lang, 'competitions.count', competitions.length),
          }}
        />
      )}
    </main>
  );
}
