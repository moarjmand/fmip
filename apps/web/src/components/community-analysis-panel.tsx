import type { CommunityAnalysesResponse, CommunityAnalysis } from '@fmip/contracts';
import { MemberHandle, MemberName } from '@/components/member-name';
import { LtrNumeric } from '@/components/score';
import { Translated } from '@/components/translated';
import { Notice } from '@/components/ui';
import type { Locale } from '@/i18n/locales';
import { interpolate, t } from '@/i18n/messages';
import {
  OUTCOME_KEY,
  asLocale,
  confidenceText,
  plainNumber,
  rawStamp,
  scoreText,
} from '@/lib/prediction-text';

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
 * API all kept them apart. The words are this panel's own keys
 * (`analysis.community.*`) in every language (T-1307).
 *
 * A server component: it renders a public document and has nothing to react to.
 */

const FIELDS = [
  ['lineup_impact', 'analysis.community.lineup'],
  ['key_players', 'analysis.community.keyPlayers'],
  ['form_and_context', 'analysis.community.form'],
] as const;

function Analysis({ locale, analysis }: { locale: Locale; analysis: CommunityAnalysis }) {
  // The newest version is what is current; the earlier ones stay in the record
  // and are not shown here, because a reader wants what the analyst says now.
  const current = analysis.versions[0];
  if (current === undefined) return null;

  return (
    <li
      className="flex flex-col gap-2 rounded border border-default p-4"
      data-testid="community-analysis"
    >
      <span className="flex flex-wrap items-baseline gap-2 text-sm">
        <MemberName locale={locale} member={analysis.author} className="font-medium" />
        <MemberHandle username={analysis.author.username} className="text-xs text-muted" />
        {analysis.author.rating === null ? (
          // Said, not left blank: "not rated yet" and "rated badly" are
          // different facts and a missing number reads as neither (rule 3).
          <span className="text-xs text-muted" data-testid="community-analysis-unrated">
            <Translated locale={locale} message="analysis.community.unrated" />
          </span>
        ) : (
          <span className="text-xs text-muted" data-testid="community-analysis-rating">
            {interpolate(t(locale, 'analysis.community.rating'), {
              rating: plainNumber(locale, analysis.author.rating),
            })}
          </span>
        )}
        <span
          className="rounded border border-default px-1 text-xs"
          data-testid={
            analysis.author.approved ? 'community-analysis-approved' : 'community-analysis-former'
          }
        >
          {/* An analyst whose approval has since ended keeps what they published
              and is shown as former. Taking it down would rewrite the record;
              still calling them approved would be false. */}
          <Translated
            locale={locale}
            message={
              analysis.author.approved ? 'analysis.community.approved' : 'analysis.community.former'
            }
          />
        </span>
      </span>

      <p className="text-sm">
        <span className="font-medium">
          <Translated locale={locale} message={OUTCOME_KEY[current.predicted_outcome]} />
        </span>
        {current.predicted_home !== null && current.predicted_away !== null && (
          <LtrNumeric className="ms-2">
            {scoreText(locale, current.predicted_home, current.predicted_away)}
          </LtrNumeric>
        )}
        <span className="ms-2 text-muted">{confidenceText(locale, current.confidence)}</span>
      </p>

      <p className="whitespace-pre-wrap text-sm">{current.reasoning}</p>

      {FIELDS.map(([field, label]) =>
        current[field] === null ? null : (
          <p key={field} className="text-sm">
            <span className="font-medium">
              <Translated locale={locale} message={label} />
            </span>{' '}
            <span className="whitespace-pre-wrap text-muted">{current[field]}</span>
          </p>
        ),
      )}

      <span className="flex flex-wrap gap-2 text-xs text-muted">
        <time dateTime={current.published_at}>{rawStamp(locale, current.published_at)}</time>
        {current.version_number > 1 && (
          // A correction is a new version that says what changed. Getting
          // something wrong and correcting it costs an analyst nothing here;
          // quietly editing it would (contributor rules, 13-policy.md §5).
          <span data-testid="community-analysis-revised">
            {interpolate(t(locale, 'analysis.community.revised'), {
              version: plainNumber(locale, current.version_number),
            })}
          </span>
        )}
      </span>
    </li>
  );
}

export function CommunityAnalysisPanel({
  locale,
  analyses,
  reachable,
}: {
  locale: string;
  analyses: CommunityAnalysesResponse | null;
  /** False when the analyses could not be fetched at all. */
  reachable: boolean;
}) {
  const l = asLocale(locale);
  return (
    <section className="flex flex-col gap-3" data-testid="community-analysis-panel">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">
          <Translated locale={l} message="analysis.community.title" />
        </h2>
        {/* The heading names who is speaking, and this line says what it is not.
            Four signed opinions on one page, each legible as itself (rule 6). */}
        <p className="text-xs text-muted">
          <Translated locale={l} message="analysis.community.notOthers" />
        </p>
      </div>

      {!reachable || analyses === null ? (
        // Stated, not vanished: "could not be fetched" and "nobody has written
        // one" are different facts.
        <Notice tone="danger" data-testid="community-analysis-unreachable">
          <Translated locale={l} message="analysis.community.unreachable" />
        </Notice>
      ) : analyses.analyses.length === 0 ? (
        <p className="text-sm text-muted" data-testid="community-analysis-empty">
          <Translated locale={l} message="analysis.community.empty" />
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {analyses.analyses.map((analysis) => (
            <Analysis key={analysis.id} locale={l} analysis={analysis} />
          ))}
        </ul>
      )}
    </section>
  );
}
