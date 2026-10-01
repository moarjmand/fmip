import type { Metadata } from 'next';
import Link from 'next/link';
import { LinkedSentence } from '@/components/linked-sentence';
import { MessageText } from '@/components/message-text';
import { Translated } from '@/components/translated';
import { intlLocale } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { interpolate, message, plural, t } from '@/i18n/messages';
import { fetchCompetitions, fetchLeaderboard } from '@/lib/api';
import { pageMetadata } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const lang = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return pageMetadata({
    locale,
    path: '/about',
    title: `${t(lang, 'about.meta.title')} · FMIP`,
    description: t(lang, 'about.meta.description'),
  });
}

/**
 * The page for a first visit (T-523): what the product is, the three
 * prediction products, and how a rating is earned. Every claim on it has to
 * be true of the product as deployed, so what can change is read rather than
 * written: the competitions from the catalogue, the provisional threshold
 * from the leaderboard's own rules. The rating's weights live in a formula
 * configuration an administrator can version (D-035), so they are described,
 * not quoted, and the leaderboard names the version in force.
 *
 * Every language says the same here (T-1302): no sentence for one language's
 * readers only.
 */
export default async function AboutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const lang = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const [competitions, leaderboard] = await Promise.all([
    fetchCompetitions(),
    fetchLeaderboard(''),
  ]);
  const names = (competitions ?? []).map((c) => c.name);
  const floor = leaderboard.ok ? leaderboard.data.floor : null;
  const covered = message(lang, 'about.competitions');

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <h1 className="border-s-4 border-s-accent ps-4 text-2xl font-semibold" data-testid="title">
        <Translated locale={lang} message="about.meta.title" />
      </h1>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">
          <Translated locale={lang} message="about.football.title" />
        </h2>
        <p>
          <Translated locale={lang} message="about.football.body" />
        </p>
        {names.length > 0 ? (
          <p data-testid="about-competitions">
            <MessageText
              message={{
                ...covered,
                // The list in the language's own punctuation: "A, B, C" in
                // English, with the Persian comma on `/fa`.
                text: interpolate(covered.text, {
                  names: new Intl.ListFormat(intlLocale(lang), {
                    type: 'unit',
                    style: 'long',
                  }).format(names),
                }),
              }}
            />
          </p>
        ) : (
          <p className="text-sm text-muted">
            <Translated locale={lang} message="about.competitions.unreachable" />
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">
          <Translated locale={lang} message="about.three.title" />
        </h2>
        <ul className="flex list-disc flex-col gap-2 ps-6">
          <li>
            <strong>
              <Translated locale={lang} message="about.three.model.name" />
            </strong>{' '}
            <Translated locale={lang} message="about.three.model.body" />
          </li>
          <li>
            <strong>
              <Translated locale={lang} message="about.three.founder.name" />
            </strong>{' '}
            <Translated locale={lang} message="about.three.founder.body" />
          </li>
          <li>
            <strong>
              <Translated locale={lang} message="about.three.community.name" />
            </strong>{' '}
            <Translated locale={lang} message="about.three.community.body" />
          </li>
        </ul>
        <p className="text-sm text-muted">
          <Translated locale={lang} message="about.three.apart" />
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">
          <Translated locale={lang} message="about.rating.title" />
        </h2>
        <p>
          <Translated locale={lang} message="about.rating.body" />
        </p>
        {floor !== null && (
          <p data-testid="about-provisional">
            <MessageText message={plural(lang, 'about.rating.provisional', floor)} />
          </p>
        )}
        <p>
          <LinkedSentence
            sentence={message(lang, 'about.rating.recompute')}
            link={message(lang, 'about.rating.leaderboard')}
            href={`/${locale}/leaderboard`}
          />
        </p>
      </section>

      <p className="flex flex-wrap gap-4">
        <Link href={`/${locale}/scores`} className="underline">
          <Translated locale={lang} message="about.todayScores" />
        </Link>
        <Link href={`/${locale}/register`} className="underline">
          <Translated locale={lang} message="home.guestInvite.link" />
        </Link>
      </p>
      <p className="text-sm text-muted">
        <Translated locale={lang} message="about.account" />
      </p>
    </main>
  );
}
