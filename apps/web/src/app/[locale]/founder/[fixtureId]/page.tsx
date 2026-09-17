import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm, type Field } from '@/components/action-form';
import { fetchFounderAnalysis, fetchMatchCentre, fetchMe } from '@/lib/api';
import { publishAnalysisAction } from '@/lib/founder-actions';
import { formatKickoff } from '@/lib/scores';
import { sessionCookieHeader } from '@/lib/session';

export const dynamic = 'force-dynamic';

// The founder's own desk: never indexed.
export const metadata: Metadata = {
  title: "Founder's analysis · FMIP",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Writing the founder's analysis (blueprint 6.5, T-131).
 *
 * The form is the blueprint's list of sections, and it is deliberately plain:
 * a server action, no client state, works without JavaScript. Every rule it
 * appears to enforce is actually the API's — the page only shows what it was
 * told, which is why the kick-off wall reaches the reader as the API's own
 * sentence rather than a second implementation that could disagree with it.
 *
 * The API decides who may publish. This page renders the form for anyone who
 * asks; a member who submits it gets the API's refusal, which is the honest
 * outcome and one fewer place for the role list to live.
 */
export default async function FounderAnalysisPage({
  params,
}: {
  params: Promise<{ locale: string; fixtureId: string }>;
}) {
  const { locale, fixtureId } = await params;
  if (!UUID.test(fixtureId)) notFound();

  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  const [match, existing] = await Promise.all([
    fetchMatchCentre(fixtureId),
    fetchFounderAnalysis(fixtureId),
  ]);
  if (!match.ok && match.status === 404) notFound();

  const fixture = match.ok ? match.data.fixture : null;
  const analysis = existing.ok ? existing.data.analysis : null;
  const latest = analysis?.versions[0] ?? null;
  const kickedOff = fixture !== null && fixture.status !== 'scheduled';

  const fields: Field[] = [
    {
      name: 'predicted_outcome',
      label: 'Predicted result',
      type: 'select',
      required: true,
      defaultValue: latest?.predicted_outcome ?? 'home',
      options: [
        { value: 'home', label: fixture === null ? 'Home win' : `${fixture.home.name} win` },
        { value: 'draw', label: 'Draw' },
        { value: 'away', label: fixture === null ? 'Away win' : `${fixture.away.name} win` },
      ],
    },
    {
      name: 'predicted_home',
      label: 'Predicted score — home (optional)',
      defaultValue:
        latest?.predicted_score === null ? '' : String(latest?.predicted_score.home ?? ''),
      hint: 'Leave both blank to call the result without a score.',
    },
    {
      name: 'predicted_away',
      label: 'Predicted score — away (optional)',
      defaultValue:
        latest?.predicted_score === null ? '' : String(latest?.predicted_score.away ?? ''),
    },
    {
      name: 'confidence',
      label: 'Confidence',
      type: 'select',
      required: true,
      defaultValue: String(latest?.confidence ?? 3),
      options: [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} of 5` })),
    },
    {
      name: 'reasoning',
      label: 'Main reasoning and tactical view',
      type: 'textarea',
      required: true,
      defaultValue: latest?.reasoning ?? '',
      hint: 'The analysis is the reasoning. Without it this is a prediction, and the site already has those.',
      maxLength: 4000,
    },
    {
      name: 'lineup_impact',
      label: 'Expected line-up impact (optional)',
      type: 'textarea',
      defaultValue: latest?.lineup_impact ?? '',
      maxLength: 4000,
    },
    {
      name: 'key_players',
      label: 'Key players and individual battles (optional)',
      type: 'textarea',
      defaultValue: latest?.key_players ?? '',
      maxLength: 4000,
    },
    {
      name: 'form_and_context',
      label: 'Recent form and competition context (optional)',
      type: 'textarea',
      defaultValue: latest?.form_and_context ?? '',
      maxLength: 4000,
    },
  ];

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <p className="text-sm">
        <Link href={`/${locale}/match/${fixtureId}`} className="underline">
          ← Match centre
        </Link>
      </p>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold" data-testid="founder-title">
          {fixture === null ? "Founder's analysis" : `${fixture.home.name} v ${fixture.away.name}`}
        </h1>
        {fixture !== null && (
          <p className="text-sm opacity-70">
            {fixture.competition.name} · kick-off{' '}
            <time dateTime={fixture.kickoff_at}>
              {fixture.kickoff_at.slice(0, 10)} {formatKickoff(locale, fixture.kickoff_at, 'UTC')}{' '}
              UTC
            </time>
          </p>
        )}
        {me === null && (
          <p role="alert" className="text-sm" data-testid="founder-signed-out">
            You are not signed in, so publishing will be refused.
          </p>
        )}
      </div>

      {kickedOff ? (
        // The database refuses it anyway; saying so here saves the founder
        // writing something that cannot be published.
        <p role="alert" className="text-sm" data-testid="founder-locked">
          This match has started. An analysis cannot be published or updated after kick-off — the
          record of what was said, and when, is the point of it.
        </p>
      ) : (
        <ActionForm
          action={publishAnalysisAction.bind(null, locale, fixtureId)}
          fields={fields}
          submitLabel={latest === null ? 'Publish' : 'Publish an update'}
          testId="founder-form"
        />
      )}

      {analysis !== null && (
        <section className="flex flex-col gap-2" data-testid="founder-versions">
          <h2 className="text-lg font-semibold">Published versions</h2>
          <p className="text-xs opacity-70">
            An update is a new version. Earlier ones stay readable, because the record of what was
            said when is what makes this worth anything.
          </p>
          <ol className="flex flex-col gap-2 text-sm">
            {analysis.versions.map((version) => (
              <li key={version.id} className="rounded border border-current/15 p-2">
                <p className="text-xs opacity-70">
                  v{version.version_number} ·{' '}
                  <time dateTime={version.published_at}>
                    {version.published_at.slice(0, 10)}{' '}
                    {formatKickoff(locale, version.published_at, 'UTC')} UTC
                  </time>{' '}
                  · confidence {version.confidence}/5
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
