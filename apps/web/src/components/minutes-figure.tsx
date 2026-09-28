import type { PlayerSeasonMinutes } from '@fmip/contracts';
import { Translated } from '@/components/translated';
import { formatNumber } from '@/i18n/format';

/**
 * A season's minutes (T-824) under T-823's rule, worded through the
 * catalogues: the total when every match played carries the feed's minutes;
 * "at least" the supplied sum and how many matches it covers when only some
 * do -- never the partial sum on its own; "minutes not supplied" when none
 * do; and "no minutes recorded" when no line-up of ours names the player at
 * all, which is a different thing from a season of zero.
 */
export function MinutesFigure({
  locale,
  minutes,
  className,
}: {
  locale: string;
  minutes: PlayerSeasonMinutes;
  className?: string;
}) {
  const body = (() => {
    if (minutes.coverage === 'available' && minutes.total !== null) {
      return (
        <span className="tabular-nums">
          <Translated locale={locale} message="minutes.total" count={minutes.total} />
        </span>
      );
    }
    if (minutes.coverage === 'limited') {
      return (
        <>
          <span className="tabular-nums">
            <Translated
              locale={locale}
              message="minutes.atLeast"
              count={minutes.supplied_minutes}
            />
          </span>{' '}
          <span className="text-xs text-muted">
            (
            <Translated
              locale={locale}
              message="minutes.covers"
              count={minutes.matches}
              params={{ with: formatNumber(locale, minutes.matches_with_minutes) }}
            />
            )
          </span>
        </>
      );
    }
    return (
      <span className="text-xs italic text-muted">
        <Translated
          locale={locale}
          message={minutes.matches === 0 ? 'minutes.noneRecorded' : 'minutes.notSupplied'}
        />
      </span>
    );
  })();
  return (
    <span className={className} data-coverage={minutes.coverage} data-testid="minutes">
      {body}
    </span>
  );
}
