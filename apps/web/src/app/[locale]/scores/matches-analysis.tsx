import type { FounderAnalysisSummary } from '@fmip/contracts';
import Link from '@/components/ui/link';
import { FounderAnalysisFeed } from '@/components/founder-analysis';
import { Translated } from '@/components/translated';
import { Icon } from '@/components/ui';
import { FounderVoice } from '@/components/voices';

/**
 * The founder's analysis on the matches page (T-1519, D-269), where the
 * header's Analysis leads (`#analysis`): the latest analyses in the founder's
 * own voice, never folded into a row's percentages or the community's split
 * (rule 6). An empty or unanswered feed is said, not left out (rule 3), so a
 * reader can tell "nothing written yet" from "not asked". Below it, the two
 * pages the old Predictions page linked: the prediction league and the
 * model's record.
 */
export function MatchesAnalysis({
  locale,
  timeZone,
  analyses,
}: {
  locale: string;
  timeZone: string;
  /** The feed's newest analyses; `null` when the API did not answer. */
  analyses: FounderAnalysisSummary[] | null;
}) {
  const heading = <Translated locale={locale} message="analysis.founder.title" />;
  return (
    <div id="analysis" className="flex scroll-mt-4 flex-col gap-3" data-testid="matches-analysis">
      <FounderVoice
        locale={locale}
        empty={
          analyses === null ? (
            <Translated locale={locale} message="predictions.page.founderUnreachable" />
          ) : analyses.length === 0 ? (
            <Translated locale={locale} message="predictions.page.founderNone" />
          ) : undefined
        }
      >
        {analyses !== null && (
          <FounderAnalysisFeed
            analyses={analyses}
            locale={locale}
            timeZone={timeZone}
            heading={heading}
          />
        )}
      </FounderVoice>
      <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm font-semibold">
        <Link
          href={`/${locale}/leaderboard`}
          className="inline-flex min-h-touch items-center gap-1.5 underline"
          data-testid="matches-leaderboard-link"
        >
          <Translated locale={locale} message="predictions.page.fullLeaderboard" />
          <Icon name="forward" size={16} />
        </Link>
        <Link
          href={`/${locale}/model-accuracy`}
          className="inline-flex min-h-touch items-center gap-1.5 underline"
          data-testid="matches-accuracy-link"
        >
          <Translated locale={locale} message="forecast.accuracyLink" />
          <Icon name="forward" size={16} />
        </Link>
      </p>
    </div>
  );
}
