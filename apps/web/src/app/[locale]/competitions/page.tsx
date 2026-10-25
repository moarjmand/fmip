import type { Metadata } from 'next';
import { CompetitionsDirectory, type ShownGroup } from '@/components/competitions-directory';
import { EntityImage } from '@/components/entity-image';
import { Translated } from '@/components/translated';
import { Notice } from '@/components/ui';
import { attribute, message } from '@/i18n/messages';
import { fetchCompetitionDirectory } from '@/lib/api';
import { pageLocale, say } from '@/lib/competition';
import { directoryGroups } from '@/lib/competitions-directory';
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

/**
 * All competitions (T-1433): every league and cup we follow, from our own
 * API (`GET /competitions/directory`), grouped -- international, then
 * continental, then each country -- with a filter by name or country. Each
 * competition opens its page. The header's competitions bar leads here.
 * An unreachable API is said out loud, never shown as an empty list, and an
 * empty catalogue says that nothing is followed yet (rule 3).
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
      }))
    : [];

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
          icons={Object.fromEntries(
            groups
              .flatMap((g) => g.competitions)
              .map((c) => [
                c.id,
                <EntityImage key={c.id} media={c.logo} kind="logo" name={c.name} size={22} />,
              ]),
          )}
          initialFilter={readFilter(query)}
          words={{
            filter: attribute(lang, 'competitions.filter'),
            jump: attribute(lang, 'competitions.jump'),
            noMatch: message(lang, 'competitions.noMatch'),
          }}
        />
      )}
    </main>
  );
}
