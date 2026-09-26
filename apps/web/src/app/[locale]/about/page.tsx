import type { Metadata } from 'next';
import Link from 'next/link';
import { fetchCompetitions, fetchLeaderboard } from '@/lib/api';
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
    path: '/about',
    title: 'What FMIP is · FMIP',
    description:
      'Live scores and match centres, a statistical forecast, the founder’s analysis and members’ predictions, kept apart, and a rating earned by predicting.',
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
 */
export default async function AboutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const [competitions, leaderboard] = await Promise.all([
    fetchCompetitions(),
    fetchLeaderboard(''),
  ]);
  const names = (competitions ?? []).map((c) => c.name);
  const floor = leaderboard.ok ? leaderboard.data.floor : null;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <h1 className="border-s-4 border-s-current ps-4 text-2xl font-semibold" data-testid="title">
        What FMIP is
      </h1>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Football, match by match</h2>
        <p>
          Live scores and a page for every match: the timeline, line-ups, statistics, who will miss
          it and each side&rsquo;s form, with every competition&rsquo;s table beside them. When
          something is missing for a match, its page says so rather than showing an empty box, and
          every live number says when it last changed.
        </p>
        {names.length > 0 ? (
          <p data-testid="about-competitions">Covered now: {names.join(', ')}.</p>
        ) : (
          <p className="text-sm opacity-70">The list of competitions could not be read just now.</p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Three kinds of prediction, never mixed</h2>
        <ul className="flex list-disc flex-col gap-2 ps-6">
          <li>
            <strong>The statistical model.</strong> A forecast computed before kick-off from the
            teams&rsquo; results, with the probabilities of a home win, a draw and an away win. Each
            version is kept as it was made, and after the match it is scored against what happened.
          </li>
          <li>
            <strong>The founder&rsquo;s analysis.</strong> Written and signed by a person, for
            selected matches.
          </li>
          <li>
            <strong>The community.</strong> Members&rsquo; own predictions. Their combined view
            appears once at least five members have predicted a match, beside a second one weighted
            only by members whose ratings are established.
          </li>
        </ul>
        <p className="text-sm opacity-80">
          The three are shown side by side and never blended into one number.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">A rating you earn by predicting</h2>
        <p>
          Predict the outcome before kick-off, with how confident you are and, if you like, the
          exact score; at kick-off the prediction is locked, and every version you submitted is
          kept. Your rating grows most from being right when it was hard to be right &mdash; how
          hard is the model&rsquo;s own probability, fixed before kick-off &mdash; and also from
          exact scores, consistency, and confidence that matched the outcome.
        </p>
        {floor !== null && (
          <p data-testid="about-provisional">
            A rating is provisional until {floor} predictions have been settled.
          </p>
        )}
        <p>
          A rating can always be recomputed from the stored predictions and results alone. The{' '}
          <Link href={`/${locale}/leaderboard`} className="underline">
            leaderboard
          </Link>{' '}
          names the formula version in force.
        </p>
      </section>

      <p className="flex flex-wrap gap-4">
        <Link href={`/${locale}/scores`} className="underline">
          Today&rsquo;s scores
        </Link>
        <Link href={`/${locale}/register`} className="underline">
          Create an account
        </Link>
      </p>
      <p className="text-sm opacity-70">
        Predicting needs an account with a verified e-mail address.
      </p>
    </main>
  );
}
