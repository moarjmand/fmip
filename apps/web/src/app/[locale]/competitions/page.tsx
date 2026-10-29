import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { CompetitionsDirectory, type ShownGroup } from '@/components/competitions-directory';
import { loadCompetitionsMenu, menuFrameWords } from '@/components/competitions-menu';
import { CompetitionsMenuBody } from '@/components/competitions-menu-panel';
import { CountryFlag, RegionMark } from '@/components/country-flag';
import { EntityImage } from '@/components/entity-image';
import { MessageText } from '@/components/message-text';
import { shellReader } from '@/components/site-header';
import { Translated } from '@/components/translated';
import { Notice } from '@/components/ui';
import { localDigits } from '@/i18n/format';
import { attribute, message, plural, type Message } from '@/i18n/messages';
import { KIND_KEY, pageLocale, say } from '@/lib/competition';
import { chosenGroup, directoryGroups } from '@/lib/competitions-directory';
import { readerTimeZone } from '@/lib/reader-time-zone';
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
 *
 * On a phone (below 768px) the page is the competitions menu's list instead
 * (T-1643, D-301), where the phone's Leagues tab lands: every competition by
 * region, one group under another, each with what it is doing today in the
 * reader's zone, the filter and the All / Today / Live toggles on top. From
 * 768px the tiles and cards above stay as they are (D-283).
 */
export default async function CompetitionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query, { session, guest }] = await Promise.all([
    params,
    searchParams,
    shellReader(),
  ]);
  const lang = pageLocale(locale);
  // The menu's answers (shared for a few seconds, as the header's are): the
  // directory both lists read, and today's scores in the reader's zone.
  const timeZone = readerTimeZone(locale, session?.user ?? null, guest);
  const { directory, view: menu } = await loadCompetitionsMenu(locale, timeZone);
  const frame = menuFrameWords(locale);
  const groups: ShownGroup[] = directory
    ? directoryGroups(directory, lang).map((group) => ({
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

      {directory === null ? (
        <Notice tone="danger" data-testid="competitions-unreachable">
          <Translated locale={locale} message="competitions.unreachable" />
        </Notice>
      ) : groups.length === 0 ? (
        <p className="text-muted" data-testid="competitions-empty">
          <Translated locale={locale} message="competitions.empty" />
        </p>
      ) : (
        <>
          {menu === null ? null : (
            <section className="md:hidden" data-testid="competitions-phone">
              <CompetitionsMenuBody
                view={menu}
                layout="stack"
                filter={frame.filter}
                show={frame.show}
                headingLevel={2}
                head={
                  <p className="w-full text-xs text-muted" data-testid="competitions-menu-counts">
                    <MessageText message={menu.counts} />
                  </p>
                }
              />
              <p className="mt-6 text-xs text-muted" data-testid="competitions-menu-note">
                <MessageText message={menu.note} />
              </p>
            </section>
          )}
          <div className="max-md:hidden">
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
          </div>
        </>
      )}
    </main>
  );
}
