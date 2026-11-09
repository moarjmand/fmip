import type { Metadata } from 'next';
import Link from '@/components/ui/link';
import { notFound } from 'next/navigation';
import { ActionForm, type Field } from '@/components/action-form';
import { Translated } from '@/components/translated';
import { type Locale } from '@/i18n/locales';
import { interpolate, message, t } from '@/i18n/messages';
import { fetchFounderAnalysis, fetchFounderDesk, fetchMatchCentre } from '@/lib/api';
import { publishAnalysisAction } from '@/lib/founder-actions';
import { isLocked } from '@/lib/prediction-form';
import {
  asLocale,
  confidenceText,
  isoDay,
  matchTitle,
  plainNumber,
  richMessage,
} from '@/lib/prediction-text';
import { formatKickoff } from '@/lib/scores';
import { sessionCookieHeader } from '@/lib/session';
import { ButtonLink, Notice } from '@/components/ui';

export const dynamic = 'force-dynamic';

// The founder's own desk, and the short page anyone else gets there: never
// indexed, never in the sitemap (T-1791, D-393).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: t(asLocale(locale), 'analysis.desk.title'),
    robots: { index: false, follow: false },
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "2025-01-05 16:28 UTC" in English; the locale's own date and digits elsewhere. */
function utcMoment(locale: Locale, iso: string): string {
  return interpolate(t(locale, 'predictions.utc'), {
    time: `${isoDay(locale, iso)} ${formatKickoff(locale, iso, 'UTC')}`,
  });
}

/**
 * Writing the founder's analysis (blueprint 6.5, T-131).
 *
 * The form is the blueprint's list of sections, and it is deliberately plain:
 * a server action, no client state, works without JavaScript. Every rule it
 * appears to enforce is actually the API's — the page only shows what it was
 * told, which is why the kick-off wall reaches the reader as the API's own
 * sentence rather than a second implementation that could disagree with it.
 *
 * The API decides who may publish, and since T-1791 (D-393) the page asks it
 * before drawing anything: `fetchFounderDesk` is the publish's own gate (the
 * `founder` role, not `admin`), so the form is drawn for exactly whom the API
 * would let publish and the role list still lives in one place. Everyone
 * else -- a guest, a member, an administrator -- gets `DeskGate`, a short
 * page with a 200 and `noindex`: what the founder's analysis is and where
 * the published ones are read. No sign-in prompt, because signing in would
 * not let them write, and no redirect, so a signed-out founder sees why.
 */
export default async function FounderAnalysisPage({
  params,
}: {
  params: Promise<{ locale: string; fixtureId: string }>;
}) {
  const { locale, fixtureId } = await params;
  if (!UUID.test(fixtureId)) notFound();
  const l = asLocale(locale);

  const cookie = await sessionCookieHeader();
  const [match, writer] = await Promise.all([
    fetchMatchCentre(fixtureId),
    fetchFounderDesk(fixtureId, cookie),
  ]);
  if (!match.ok && match.status === 404) notFound();

  const fixture = match.ok ? match.data.fixture : null;
  if (!writer) return <DeskGate locale={l} fixtureId={fixtureId} fixture={fixture} />;
  const existing = await fetchFounderAnalysis(fixtureId);
  const analysis = existing.ok ? existing.data.analysis : null;
  const latest = analysis?.versions[0] ?? null;
  // By the clock as well as the status (T-1713): the database locks at
  // kick-off by its own clock, and a match the feed never moved on stays
  // `scheduled` long after it.
  const kickedOff =
    fixture !== null && (fixture.status !== 'scheduled' || isLocked(fixture.kickoff_at));
  const teamWin = (team: string): string =>
    interpolate(t(l, 'predictions.outcome.teamWin'), { team });

  const fields: Field[] = [
    {
      name: 'predicted_outcome',
      label: t(l, 'analysis.desk.predictedResult'),
      type: 'select',
      required: true,
      defaultValue: latest?.predicted_outcome ?? 'home',
      options: [
        {
          value: 'home',
          label: fixture === null ? t(l, 'predictions.outcome.home') : teamWin(fixture.home.name),
        },
        { value: 'draw', label: t(l, 'predictions.outcome.draw') },
        {
          value: 'away',
          label: fixture === null ? t(l, 'predictions.outcome.away') : teamWin(fixture.away.name),
        },
      ],
    },
    {
      name: 'predicted_home',
      label: t(l, 'analysis.desk.scoreHome'),
      defaultValue:
        latest?.predicted_score === null ? '' : String(latest?.predicted_score.home ?? ''),
      hint: t(l, 'analysis.desk.scoreHint'),
    },
    {
      name: 'predicted_away',
      label: t(l, 'analysis.desk.scoreAway'),
      defaultValue:
        latest?.predicted_score === null ? '' : String(latest?.predicted_score.away ?? ''),
    },
    {
      name: 'confidence',
      label: t(l, 'predictions.form.confidence'),
      type: 'select',
      required: true,
      defaultValue: String(latest?.confidence ?? 3),
      options: [1, 2, 3, 4, 5].map((n) => ({
        value: String(n),
        label: interpolate(t(l, 'analysis.desk.confidenceOption'), {
          value: plainNumber(l, n),
          max: plainNumber(l, 5),
        }),
      })),
    },
    {
      name: 'reasoning',
      label: t(l, 'analysis.desk.reasoning'),
      type: 'textarea',
      required: true,
      defaultValue: latest?.reasoning ?? '',
      hint: t(l, 'analysis.desk.reasoningHint'),
      maxLength: 4000,
    },
    {
      name: 'lineup_impact',
      label: t(l, 'analysis.desk.lineup'),
      type: 'textarea',
      defaultValue: latest?.lineup_impact ?? '',
      maxLength: 4000,
    },
    {
      name: 'key_players',
      label: t(l, 'analysis.desk.keyPlayers'),
      type: 'textarea',
      defaultValue: latest?.key_players ?? '',
      maxLength: 4000,
    },
    {
      name: 'form_and_context',
      label: t(l, 'analysis.desk.form'),
      type: 'textarea',
      defaultValue: latest?.form_and_context ?? '',
      maxLength: 4000,
    },
  ];

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <p className="text-sm">
        <Link href={`/${locale}/match/${fixtureId}`} className="underline">
          <Translated locale={l} message="analysis.desk.back" />
        </Link>
      </p>

      <DeskHeading locale={l} fixture={fixture} />

      {kickedOff ? (
        // The database refuses it anyway; saying so here saves the founder
        // writing something that cannot be published.
        <Notice tone="warning" data-testid="founder-locked">
          <Translated locale={l} message="analysis.desk.locked" />
        </Notice>
      ) : (
        <ActionForm
          action={publishAnalysisAction.bind(null, locale, fixtureId)}
          fields={fields}
          submitLabel={t(
            l,
            latest === null ? 'analysis.desk.publish' : 'analysis.desk.publishUpdate',
          )}
          testId="founder-form"
        />
      )}

      {analysis !== null && (
        <section className="flex flex-col gap-2" data-testid="founder-versions">
          <h2 className="text-lg font-semibold">
            <Translated locale={l} message="analysis.desk.versions" />
          </h2>
          <p className="text-xs text-muted">
            <Translated locale={l} message="analysis.desk.versionsNote" />
          </p>
          <ol className="flex flex-col gap-2 text-sm">
            {analysis.versions.map((version) => (
              <li key={version.id} className="rounded border border-default p-2">
                <p className="text-xs text-muted">
                  {interpolate(t(l, 'predictions.versionShort'), {
                    version: plainNumber(l, version.version_number),
                  })}{' '}
                  ·{' '}
                  <time dateTime={version.published_at}>{utcMoment(l, version.published_at)}</time>{' '}
                  · {confidenceText(l, version.confidence)}
                </p>
                <p className="mt-1">{version.reasoning}</p>
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}

type DeskFixture = {
  home: { name: string };
  away: { name: string };
  competition: { name: string };
  kickoff_at: string;
} | null;

/** The match and its kick-off, the same on the desk and on its short page. */
function DeskHeading({ locale: l, fixture }: { locale: Locale; fixture: DeskFixture }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold" data-testid="founder-title">
        {fixture === null ? (
          <Translated locale={l} message="analysis.founder.title" />
        ) : (
          matchTitle(l, fixture.home.name, fixture.away.name)
        )}
      </h1>
      {fixture !== null && (
        <p className="text-sm text-muted">
          {richMessage(
            {
              ...message(l, 'analysis.desk.kickoff'),
              text: interpolate(t(l, 'analysis.desk.kickoff'), {
                competition: fixture.competition.name,
              }),
            },
            {
              time: <time dateTime={fixture.kickoff_at}>{utcMoment(l, fixture.kickoff_at)}</time>,
            },
          )}
        </p>
      )}
    </div>
  );
}

/**
 * The desk's address to anyone without the founder role (T-1791, D-393;
 * board P8-6): the match, one paragraph on what the founder's analysis is --
 * one of the three products, apart from the model and the members (rule 6)
 * -- and two ways on: back to the match, and to where the published
 * analyses are read today (the matches page's `#analysis`). No form, no
 * sign-in prompt.
 */
function DeskGate({
  locale: l,
  fixtureId,
  fixture,
}: {
  locale: Locale;
  fixtureId: string;
  fixture: DeskFixture;
}) {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-4 sm:p-8" data-testid="founder-gate">
      <DeskHeading locale={l} fixture={fixture} />
      <div className="flex flex-col gap-2 border-s-4 border-s-founder ps-4">
        <p className="font-semibold">
          <Translated locale={l} message="analysis.desk.gate" />
        </p>
        <p className="text-sm text-muted">
          <Translated locale={l} message="analysis.desk.gateWhat" />
        </p>
      </div>
      <p className="flex flex-wrap gap-2">
        <ButtonLink href={`/${l}/match/${fixtureId}`} size="md" data-testid="founder-gate-match">
          <Translated locale={l} message="analysis.desk.toMatch" />
        </ButtonLink>
        <ButtonLink href={`/${l}/scores#analysis`} size="md" data-testid="founder-gate-analyses">
          <Translated locale={l} message="analysis.desk.toAnalyses" />
        </ButtonLink>
      </p>
    </main>
  );
}
