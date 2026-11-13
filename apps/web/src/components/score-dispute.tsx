import type { ScoreConflict, ScoreDispute } from '@fmip/contracts';
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
 *
 * Stored scores that contradict each other (T-1819, D-414, `score_conflict`)
 * take the same marker and their own line, which names no number: the API has
 * withheld the lines in conflict, so the band draws "–" and nothing is picked.
 */
export function scoreDisputeHero(
  locale: string,
  fixture: {
    status: string;
    score_dispute?: ScoreDispute | null;
    score_conflict?: ScoreConflict | null;
  },
): { marker: React.ReactNode; note: React.ReactNode } | undefined {
  if (fixture.status !== 'finished') return undefined;
  const dispute = fixture.score_dispute;
  const conflict = fixture.score_conflict;
  if (dispute == null && conflict == null) return undefined;
  const resolved = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const marker = (
    <span data-testid="score-unclear">
      <CoverageBadge
        state="limited"
        label={<Translated locale={locale} message="matchCentre.scoreUnclear" />}
      />
    </span>
  );
  if (conflict != null || dispute == null) {
    return {
      marker,
      note: (
        <p
          dir="auto"
          className="text-center text-sm text-caption"
          role="note"
          data-testid="score-conflict-note"
        >
          <Translated locale={locale} message="matchCentre.scoreConflictNote" />
        </p>
      ),
    };
  }
  return {
    marker,
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
