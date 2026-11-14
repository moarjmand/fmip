import type { Metadata } from 'next';
import Link from '@/components/ui/link';
import { LinkedSentence } from '@/components/linked-sentence';
import { MessageText } from '@/components/message-text';
import { Translated } from '@/components/translated';
import { intlLocale } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { type MessageKey, interpolate, message, plural, t } from '@/i18n/messages';
import { fetchCompetitions, fetchLeaderboard } from '@/lib/api';
import { pageMetadata } from '@/lib/seo';
import { FindYourWay } from './find-your-way';
import { HowItWorks } from './how-it-works';
import './about.css';

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
    title: `${t(lang, 'about.meta.title')} · Stadiomind`,
    description: t(lang, 'about.meta.description'),
  });
}

/**
 * "Where the data comes from" (T-1790, D-410): each kind by the name and the
 * sentence "How Stadiomind works" and "Find your way" already give it.
 */
const DATA_SOURCES: readonly (readonly [MessageKey, MessageKey])[] = [
  ['about.how.source.name', 'about.how.source.body'],
  ['about.map.news.name', 'about.map.news.body'],
  ['about.map.highlights.name', 'about.map.highlights.body'],
];

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
 *
 * Since T-1615 (D-286) the page opens on two pictures: "How Stadiomind
 * works", the path of one match from the licensed data to the records the
 * three forecasts build, and "Find your way", the main sections as tiles.
 * Both are server-rendered markup with inline SVG and CSS: no client script.
 * The words below them are the detail.
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
    <main className="page-frame flex flex-col gap-12 py-8">
      <header className="flex max-w-3xl flex-col gap-3">
        <h1
          className="border-s-4 border-s-accent ps-4 text-3xl leading-tight font-extrabold font-stretch-semi-expanded"
          data-testid="title"
        >
          <Translated locale={lang} message="about.meta.title" />
        </h1>
        {/* The brand line is the lead (T-1827, D-421); the old lead says how, under it. */}
        <p className="text-2xl leading-snug font-semibold" data-testid="about-lead">
          <Translated locale={lang} message="brand.line" />
        </p>
        <p className="text-lg text-muted">
          <Translated locale={lang} message="about.meta.description" />
        </p>
      </header>

      <HowItWorks locale={lang} />
      <FindYourWay locale={lang} />

      <div className="flex max-w-3xl flex-col gap-6">
        <section className="flex flex-col gap-2">
          <h2 className="text-[1.375rem] leading-tight font-extrabold font-stretch-semi-expanded">
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

        {/* Where the data comes from (T-1790, D-410), the footer's "Data
            sources": what each kind of data is and where it opens, in the
            words the page already uses above. No provider is named and no
            attribution line is written: those are the maintainer's (D-014). */}
        <section
          id="data"
          aria-labelledby="data-heading"
          className="flex scroll-mt-4 flex-col gap-2"
          data-testid="about-data"
        >
          <h2
            id="data-heading"
            className="text-[1.375rem] leading-tight font-extrabold font-stretch-semi-expanded"
          >
            <Translated locale={lang} message="about.data.title" />
          </h2>
          <ul className="flex list-disc flex-col gap-2 ps-6">
            {DATA_SOURCES.map(([name, body]) => (
              <li key={name}>
                <strong>
                  <Translated locale={lang} message={name} />
                </strong>{' '}
                <Translated locale={lang} message={body} />
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-[1.375rem] leading-tight font-extrabold font-stretch-semi-expanded">
            <Translated locale={lang} message="about.three.title" />
          </h2>
          <ul className="flex list-disc flex-col gap-2 ps-6">
            {/* The homepage's "How the model works" lands here (T-1382). */}
            <li id="model" className="scroll-mt-4">
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
          <h2 className="text-[1.375rem] leading-tight font-extrabold font-stretch-semi-expanded">
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
      </div>
    </main>
  );
}
