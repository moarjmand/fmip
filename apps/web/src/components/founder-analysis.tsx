import Link from 'next/link';
import type { ReactNode } from 'react';
import type {
  FounderAnalysisResponse,
  FounderAnalysisSummary,
  FounderOutcome,
} from '@fmip/contracts';
import { formatKickoff } from '@/lib/scores';
import { ScorePair } from '@/components/score';
import { Translated } from '@/components/translated';
import { interpolate, message, t } from '@/i18n/messages';
import {
  asLocale,
  confidenceText,
  isoDay,
  matchTitle,
  outcomeText,
  plainNumber,
  richMessage,
  scoreText,
} from '@/lib/prediction-text';

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
 * reading something the product did not say (rule 6). Its words are its own
 * keys (`analysis.founder.*`), in every language (T-1307).
 */

function outcomeLabel(locale: string, outcome: FounderOutcome, home: string, away: string): string {
  if (outcome === 'draw') return outcomeText(locale, 'draw');
  return interpolate(t(asLocale(locale), 'predictions.outcome.teamWin'), {
    team: outcome === 'home' ? home : away,
  });
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
  const l = asLocale(locale);
  const key = version > 1 ? 'analysis.founder.signedUpdated' : 'analysis.founder.signed';
  return (
    <p className="text-xs text-muted" data-testid="founder-signature">
      {richMessage(
        {
          ...message(l, key),
          text: interpolate(t(l, key), { author, version: plainNumber(l, version) }),
        },
        {
          time: (
            <time dateTime={publishedAt}>
              {isoDay(l, publishedAt)} {formatKickoff(locale, publishedAt, timeZone)}
            </time>
          ),
        },
      )}
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
  const l = asLocale(locale);
  const current = analysis?.analysis?.versions[0] ?? null;
  if (analysis === null || analysis.analysis === null || current === null) {
    // Most matches have none — the blueprint scopes this to important fixtures —
    // so its absence is stated once and quietly, not as a gap.
    return (
      <section className="flex flex-col gap-2" data-testid="founder-analysis" data-state="none">
        <h2 className="text-lg font-semibold">
          <Translated locale={l} message="analysis.founder.title" />
        </h2>
        <p className="text-sm text-muted">
          <Translated locale={l} message="analysis.founder.none" />
        </p>
      </section>
    );
  }

  const sections: [string, ReactNode, string | null][] = [
    [
      'lineup',
      <Translated key="lineup" locale={l} message="analysis.founder.lineup" />,
      current.lineup_impact,
    ],
    [
      'players',
      <Translated key="players" locale={l} message="analysis.founder.keyPlayers" />,
      current.key_players,
    ],
    [
      'form',
      <Translated key="form" locale={l} message="analysis.founder.form" />,
      current.form_and_context,
    ],
  ];

  return (
    <section className="flex flex-col gap-3" data-testid="founder-analysis" data-state="available">
      <h2 className="text-lg font-semibold">
        <Translated locale={l} message="analysis.founder.title" />
      </h2>
      <p className="text-xs text-muted">
        <Translated locale={l} message="analysis.founder.notOthers" />
      </p>

      <p className="text-sm">
        <strong>{outcomeLabel(l, current.predicted_outcome, home, away)}</strong>
        {current.predicted_score !== null ? (
          <>
            {' — '}
            <ScorePair locale={l} testId="founder-score">
              {scoreText(l, current.predicted_score.home, current.predicted_score.away)}
            </ScorePair>
          </>
        ) : null}{' '}
        <span className="text-muted">· {confidenceText(l, current.confidence)}</span>
      </p>

      <p className="text-sm whitespace-pre-line">{current.reasoning}</p>

      {sections.map(([id, label, text]) =>
        text === null ? null : (
          <div key={id} className="flex flex-col gap-0.5">
            <h3 className="text-sm font-medium">{label}</h3>
            <p className="text-sm whitespace-pre-line text-muted">{text}</p>
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
        <details className="text-xs text-muted">
          <summary className="cursor-pointer">
            <Translated
              locale={l}
              message="analysis.founder.versions"
              count={analysis.analysis.versions.length}
            />
          </summary>
          <ol className="mt-2 flex flex-col gap-2">
            {analysis.analysis.versions.slice(1).map((version) => (
              <li key={version.id}>
                <time dateTime={version.published_at}>
                  {interpolate(t(l, 'predictions.versionShort'), {
                    version: plainNumber(l, version.version_number),
                  })}{' '}
                  · {isoDay(l, version.published_at)}
                </time>{' '}
                · {outcomeLabel(l, version.predicted_outcome, home, away)} ·{' '}
                {confidenceText(l, version.confidence)}
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
  heading,
}: {
  analyses: FounderAnalysisSummary[];
  locale: string;
  timeZone: string;
  /** The section's heading; a server page may pass a `<Translated>` message. */
  heading?: ReactNode;
}) {
  if (analyses.length === 0) return null;
  const l = asLocale(locale);

  return (
    <section className="flex flex-col gap-2" data-testid="founder-feed">
      <h2 className="text-lg font-semibold">
        {heading ?? <Translated locale={l} message="feed.kind.founderAnalysis" />}
      </h2>
      <ul className="flex flex-col gap-3">
        {analyses.map((entry) => (
          <li key={entry.fixture.id} className="flex flex-col gap-1">
            <Link href={`/${locale}/match/${entry.fixture.id}`} className="text-sm underline">
              {matchTitle(l, entry.fixture.home.name, entry.fixture.away.name)}
            </Link>
            <p className="text-xs text-muted">
              {entry.fixture.competition.name} ·{' '}
              <time dateTime={entry.fixture.kickoff_at}>
                {isoDay(l, entry.fixture.kickoff_at)}{' '}
                {formatKickoff(locale, entry.fixture.kickoff_at, timeZone)}
              </time>
            </p>
            <p className="text-sm">
              <strong>
                {outcomeLabel(
                  l,
                  entry.predicted_outcome,
                  entry.fixture.home.name,
                  entry.fixture.away.name,
                )}
              </strong>
              {entry.predicted_score !== null ? (
                <>
                  {' — '}
                  <ScorePair locale={l}>
                    {scoreText(l, entry.predicted_score.home, entry.predicted_score.away)}
                  </ScorePair>
                </>
              ) : null}{' '}
              <span className="text-muted">· {confidenceText(l, entry.confidence)}</span>
            </p>
            <p className="text-sm text-muted">{entry.excerpt}</p>
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
