import type { CommunityAnalysesResponse, CommunityAnalysis } from '@fmip/contracts';

/**
 * Published community analysis on the match page (blueprint 10.3, T-263).
 *
 * **A fourth signed opinion, and the page has to say so.** This sits below the
 * founder's analysis, the model's forecast and the community consensus, and the
 * one thing it must never do is look like any of them. Rule 6 is about the data
 * not merging; this is the same rule where a reader actually meets it.
 *
 * So the heading names who is speaking, every analysis carries its author's
 * name and rating, and nothing on this panel borrows a component from the other
 * three. A shared "analysis card" that took either would be the blending rule
 * broken at the last possible moment — after the schema, the contract and the
 * API all kept them apart.
 *
 * A server component: it renders a public document and has nothing to react to.
 */

const OUTCOME_LABEL: Record<CommunityAnalysis['versions'][number]['predicted_outcome'], string> = {
  home: 'Home win',
  draw: 'Draw',
  away: 'Away win',
};

function Analysis({ analysis }: { analysis: CommunityAnalysis }) {
  // The newest version is what is current; the earlier ones stay in the record
  // and are not shown here, because a reader wants what the analyst says now.
  const current = analysis.versions[0];
  if (current === undefined) return null;

  return (
    <li
      className="flex flex-col gap-2 rounded border border-current/20 p-4"
      data-testid="community-analysis"
    >
      <span className="flex flex-wrap items-baseline gap-2 text-sm">
        <span className="font-medium">{analysis.author.display_name}</span>
        <span className="text-xs opacity-70">@{analysis.author.username}</span>
        {analysis.author.rating === null ? (
          // Said, not left blank: "not rated yet" and "rated badly" are
          // different facts and a missing number reads as neither (rule 3).
          <span className="text-xs opacity-70" data-testid="community-analysis-unrated">
            Not rated yet
          </span>
        ) : (
          <span className="text-xs opacity-70" data-testid="community-analysis-rating">
            Rating {analysis.author.rating}
          </span>
        )}
        <span
          className="rounded border border-current/30 px-1 text-xs"
          data-testid={
            analysis.author.approved ? 'community-analysis-approved' : 'community-analysis-former'
          }
        >
          {/* An analyst whose approval has since ended keeps what they published
              and is shown as former. Taking it down would rewrite the record;
              still calling them approved would be false. */}
          {analysis.author.approved ? 'Approved contributor' : 'Formerly approved'}
        </span>
      </span>

      <p className="text-sm">
        <span className="font-medium">{OUTCOME_LABEL[current.predicted_outcome]}</span>
        {current.predicted_home !== null && current.predicted_away !== null && (
          <span className="ms-2">
            {current.predicted_home}–{current.predicted_away}
          </span>
        )}
        <span className="ms-2 opacity-70">confidence {current.confidence}/5</span>
      </p>

      <p className="whitespace-pre-wrap text-sm">{current.reasoning}</p>

      {(
        [
          ['lineup_impact', 'Lineup impact'],
          ['key_players', 'Key players'],
          ['form_and_context', 'Form and context'],
        ] as const
      ).map(([field, label]) =>
        current[field] === null ? null : (
          <p key={field} className="text-sm">
            <span className="font-medium">{label}:</span>{' '}
            <span className="whitespace-pre-wrap opacity-80">{current[field]}</span>
          </p>
        ),
      )}

      <span className="flex flex-wrap gap-2 text-xs opacity-60">
        <time dateTime={current.published_at}>{current.published_at}</time>
        {current.version_number > 1 && (
          // A correction is a new version that says what changed. Getting
          // something wrong and correcting it costs an analyst nothing here;
          // quietly editing it would (contributor rules, 13-policy.md §5).
          <span data-testid="community-analysis-revised">
            revised · version {current.version_number}
          </span>
        )}
      </span>
    </li>
  );
}

export function CommunityAnalysisPanel({
  analyses,
  reachable,
}: {
  analyses: CommunityAnalysesResponse | null;
  /** False when the analyses could not be fetched at all. */
  reachable: boolean;
}) {
  return (
    <section className="flex flex-col gap-3" data-testid="community-analysis-panel">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Analysis from approved contributors</h2>
        {/* The heading names who is speaking, and this line says what it is not.
            Four signed opinions on one page, each legible as itself (rule 6). */}
        <p className="text-xs opacity-60">
          Written by members the platform approved. Not the founder&rsquo;s analysis, not the
          statistical model, and not the community consensus.
        </p>
      </div>

      {!reachable || analyses === null ? (
        // Stated, not vanished: "could not be fetched" and "nobody has written
        // one" are different facts.
        <p role="alert" data-testid="community-analysis-unreachable">
          Contributor analysis cannot be shown right now.
        </p>
      ) : analyses.analyses.length === 0 ? (
        <p className="text-sm opacity-70" data-testid="community-analysis-empty">
          No contributor has published an analysis of this match.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {analyses.analyses.map((analysis) => (
            <Analysis key={analysis.id} analysis={analysis} />
          ))}
        </ul>
      )}
    </section>
  );
}
