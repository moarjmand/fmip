import Link from 'next/link';
import type {
  FounderAnalysisResponse,
  FounderAnalysisSummary,
  FounderOutcome,
} from '@fmip/contracts';
import { formatKickoff } from '@/lib/scores';
import { Score } from '@/components/score';

/**
 * The founder's analysis on the pages a reader meets it (blueprint 6.5, T-132).
 *
 * **Always attributed and signed.** Every rendering here carries the author's
 * name and the publication time, because the blueprint asks that each entry be
 * written and signed personally — and because the whole value of it is knowing
 * *who* said *what*, and *when*.
 *
 * **Never blended.** This component takes only a founder analysis. It cannot
 * render a model forecast or a community consensus, and the panel says out loud
 * which of the three it is, because a reader who cannot tell them apart is
 * reading something the product did not say (rule 6).
 */

function outcomeLabel(outcome: FounderOutcome, home: string, away: string): string {
  return outcome === 'home' ? `${home} win` : outcome === 'away' ? `${away} win` : 'Draw';
}

function Signature({
  author,
  publishedAt,
  version,
  timeZone,
  locale,
}: {
  author: string;
  publishedAt: string;
  version: number;
  timeZone: string;
  locale: string;
}) {
  return (
    <p className="text-xs opacity-60" data-testid="founder-signature">
      Written by {author} · published{' '}
      <time dateTime={publishedAt}>
        {publishedAt.slice(0, 10)} {formatKickoff(locale, publishedAt, timeZone)}
      </time>
      {version > 1 ? ` · updated, version ${version}` : ''}
    </p>
  );
}

/** The full analysis, for the match centre. */
export function FounderAnalysisPanel({
  analysis,
  home,
  away,
  timeZone,
  locale,
}: {
  analysis: FounderAnalysisResponse | null;
  home: string;
  away: string;
  timeZone: string;
  locale: string;
}) {
  const current = analysis?.analysis?.versions[0] ?? null;
  if (analysis === null || analysis.analysis === null || current === null) {
    // Most matches have none — the blueprint scopes this to important fixtures —
    // so its absence is stated once and quietly, not as a gap.
    return (
      <section className="flex flex-col gap-2" data-testid="founder-analysis" data-state="none">
        <h2 className="text-lg font-semibold">Founder&rsquo;s analysis</h2>
        <p className="text-sm opacity-70">The founder has not written an analysis of this match.</p>
      </section>
    );
  }

  const sections: [string, string | null][] = [
    ['Expected line-up impact', current.lineup_impact],
    ['Key players and battles', current.key_players],
    ['Recent form and context', current.form_and_context],
  ];

  return (
    <section className="flex flex-col gap-3" data-testid="founder-analysis" data-state="available">
      <h2 className="text-lg font-semibold">Founder&rsquo;s analysis</h2>
      <p className="text-xs opacity-60">
        One person&rsquo;s view, signed. Not the statistical model, and not the community.
      </p>

      <p className="text-sm">
        <strong>{outcomeLabel(current.predicted_outcome, home, away)}</strong>
        {current.predicted_score !== null ? (
          <>
            {' — '}
            <Score home={current.predicted_score.home} away={current.predicted_score.away} />
          </>
        ) : null}{' '}
        <span className="opacity-70">· confidence {current.confidence}/5</span>
      </p>

      <p className="text-sm whitespace-pre-line">{current.reasoning}</p>

      {sections.map(([label, text]) =>
        text === null ? null : (
          <div key={label} className="flex flex-col gap-0.5">
            <h3 className="text-sm font-medium">{label}</h3>
            <p className="text-sm whitespace-pre-line opacity-90">{text}</p>
          </div>
        ),
      )}

      <Signature
        author={analysis.analysis.author.display_name}
        publishedAt={current.published_at}
        version={current.version_number}
        timeZone={timeZone}
        locale={locale}
      />

      {analysis.analysis.versions.length > 1 && (
        <details className="text-xs opacity-70">
          <summary className="cursor-pointer">
            {analysis.analysis.versions.length} versions — what was said before
          </summary>
          <ol className="mt-2 flex flex-col gap-2">
            {analysis.analysis.versions.slice(1).map((version) => (
              <li key={version.id}>
                <time dateTime={version.published_at}>
                  v{version.version_number} · {version.published_at.slice(0, 10)}
                </time>{' '}
                · {outcomeLabel(version.predicted_outcome, home, away)} · confidence{' '}
                {version.confidence}/5
                <p className="mt-1 whitespace-pre-line">{version.reasoning}</p>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}

/**
 * The feed entry, for the homepage and the team and competition pages.
 *
 * Deliberately an excerpt with a link: a feed that reprinted the whole analysis
 * would make the match centre pointless and would put a signed opinion in front
 * of readers who did not choose to read it.
 */
export function FounderAnalysisFeed({
  analyses,
  locale,
  timeZone,
  heading = "Founder's analysis",
}: {
  analyses: FounderAnalysisSummary[];
  locale: string;
  timeZone: string;
  heading?: string;
}) {
  if (analyses.length === 0) return null;

  return (
    <section className="flex flex-col gap-2" data-testid="founder-feed">
      <h2 className="text-lg font-semibold">{heading}</h2>
      <ul className="flex flex-col gap-3">
        {analyses.map((entry) => (
          <li key={entry.fixture.id} className="flex flex-col gap-1">
            <Link href={`/${locale}/match/${entry.fixture.id}`} className="text-sm underline">
              {entry.fixture.home.name} v {entry.fixture.away.name}
            </Link>
            <p className="text-xs opacity-70">
              {entry.fixture.competition.name} ·{' '}
              <time dateTime={entry.fixture.kickoff_at}>
                {entry.fixture.kickoff_at.slice(0, 10)}{' '}
                {formatKickoff(locale, entry.fixture.kickoff_at, timeZone)}
              </time>
            </p>
            <p className="text-sm">
              <strong>
                {outcomeLabel(
                  entry.predicted_outcome,
                  entry.fixture.home.name,
                  entry.fixture.away.name,
                )}
              </strong>
              {entry.predicted_score !== null ? (
                <>
                  {' — '}
                  <Score home={entry.predicted_score.home} away={entry.predicted_score.away} />
                </>
              ) : null}{' '}
              <span className="opacity-70">· confidence {entry.confidence}/5</span>
            </p>
            <p className="text-sm opacity-90">{entry.excerpt}</p>
            <Signature
              author={entry.author.display_name}
              publishedAt={entry.published_at}
              version={entry.version_number}
              timeZone={timeZone}
              locale={locale}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
