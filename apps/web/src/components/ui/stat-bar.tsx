import type { ReactNode } from 'react';
import { cx } from './cx';

/**
 * One statistic compared between the two sides (the Design System's
 * `StatBar`, T-1510, D-263): the two figures at the ends, the statistic's
 * name between them, and a split bar under it -- the home side's share in
 * ink from the inline start, the away side's in the caption grey; never a
 * club colour. Home is always on the inline-start side, so on `/fa` it is on
 * the right. A side the feed left out is the caller's "–", and with either
 * side missing, or nothing on both, there is no bar: a split of nothing would
 * look like an even match (rule 3). The bar is decoration; the figures say
 * it. Server-component safe.
 */
export function StatBar({
  label,
  home,
  away,
  homeText,
  awayText,
  className,
}: {
  label: ReactNode;
  /** The figures the bar is drawn from; null when the feed left a side out. */
  home: number | null;
  away: number | null;
  /** The figures as the reader reads them ("54%", "1.42", "–"). */
  homeText: ReactNode;
  awayText: ReactNode;
  className?: string;
}) {
  const total = (home ?? 0) + (away ?? 0);
  const share = home !== null && away !== null && total > 0 ? (home / total) * 100 : null;
  const figure = 'text-2xl leading-none font-black tabular-nums font-stretch-condensed';
  return (
    <div className={cx('flex flex-col gap-2', className)} data-stat-bar="">
      <div className="grid grid-cols-[minmax(3rem,auto)_minmax(0,1fr)_minmax(3rem,auto)] items-center gap-2">
        <b className={figure}>
          <span dir="ltr">{homeText}</span>
        </b>
        <span className="text-center text-xs text-muted">{label}</span>
        <b className={cx(figure, 'text-end')}>
          <span dir="ltr">{awayText}</span>
        </b>
      </div>
      {share !== null && (
        <div aria-hidden="true" className="flex h-2 gap-0.75">
          {share > 0 && (
            <span
              className="rounded-xs bg-fg"
              style={{ inlineSize: `${share}%` }}
              data-side="home"
            />
          )}
          {share < 100 && (
            <span
              className="rounded-xs bg-caption"
              style={{ inlineSize: `${100 - share}%` }}
              data-side="away"
            />
          )}
        </div>
      )}
    </div>
  );
}
