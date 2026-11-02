import type { ScoreDispute } from '@fmip/contracts';
import { formatNumber } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { message } from '@/i18n/messages';
import { FilledMessage } from '@/components/filled-message';
import { Score } from '@/components/score';
import { Translated } from '@/components/translated';
import { CoverageBadge } from '@/components/ui/coverage-badge';

/**
 * What the match header says of a finished match whose recorded goals do not
 * add up to its result (T-1717, D-347): a "limited" marker beside the score
 * and one line under the band naming both numbers, neither as final. The API
 * derives the dispute (`score_dispute`); this server component only words it,
 * so the catalogue and the sentence stay off the page's JavaScript (as
 * D-343's notice). Null when there is no dispute or the match is not finished.
 */
export function scoreDisputeHero(
  locale: string,
  fixture: { status: string; score_dispute?: ScoreDispute | null },
): { marker: React.ReactNode; note: React.ReactNode } | undefined {
  const dispute = fixture.score_dispute;
  if (fixture.status !== 'finished' || dispute == null) return undefined;
  const resolved = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return {
    marker: (
      <span data-testid="score-unclear">
        <CoverageBadge
          state="limited"
          label={<Translated locale={locale} message="matchCentre.scoreUnclear" />}
        />
      </span>
    ),
    note: (
      <p
        dir="auto"
        className="text-center text-sm text-caption"
        role="note"
        data-testid="score-unclear-note"
      >
        <FilledMessage
          message={message(resolved, 'matchCentre.scoreUnclearNote')}
          params={{
            goals: formatNumber(locale, dispute.recorded_goals),
            score: (
              <Score home={dispute.reported.home} away={dispute.reported.away} locale={locale} />
            ),
          }}
        />
      </p>
    ),
  };
}
