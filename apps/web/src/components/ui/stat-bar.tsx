import type { ReactNode } from 'react';
import { cx } from './cx';

/**
 * Which side of a row is ahead (T-1800, D-398): the side with the larger
 * figure, or `null` on a tie, with a side missing, or when the row asks for
 * no emphasis.
 */
export function statLead(
  home: number | null,
  away: number | null,
  emphasis: 'larger' | 'none' = 'larger',
): 'home' | 'away' | null {
  if (emphasis === 'none' || home === null || away === null || home === away) return null;
  return home > away ? 'home' : 'away';
}

/**
 * One statistic compared between the two sides (the Design System's
 * `StatBar`, T-1510, D-263; T-1800, D-398): the two figures at the ends, the
 * statistic's name between them, and a split bar under it, the home side's
 * share from the inline start. The larger figure of the row is the heavier
 * one, in ink, and its share of the bar is ink; the other figure is lighter
 * and grey, its share grey. That says "more", nothing else, so a row where
 * more is not better (fouls, cards) passes `emphasis="none"`: both figures
 * plain, both shares grey, as on a tie. Never a club colour or a product
 * colour. Home is always on the inline-start side, so on `/fa` it is on the
 * right. A side the feed left out is the caller's "–", and with either side
 * missing, or nothing on both, there is no bar: a split of nothing would look
 * like an even match (rule 3). The bar is decoration; the figures say it.
 * Server-component safe.
 */
export function StatBar({
  label,
  home,
  away,
  homeText,
  awayText,
  emphasis = 'larger',
  className,
}: {
  label: ReactNode;
  /** The figures the bar is drawn from; null when the feed left a side out. */
  home: number | null;
  away: number | null;
  /** The figures as the reader reads them ("54%", "1.42", "–"). */
  homeText: ReactNode;
  awayText: ReactNode;
  /** `none` where a larger figure is not better (fouls, cards). */
  emphasis?: 'larger' | 'none';
  className?: string;
}) {
  const total = (home ?? 0) + (away ?? 0);
  const share = home !== null && away !== null && total > 0 ? (home / total) * 100 : null;
  const lead = statLead(home, away, emphasis);
  const figure = (side: 'home' | 'away') =>
    cx(
      'text-xl leading-none tabular-nums font-stretch-condensed',
      lead === null
        ? 'font-bold text-fg'
        : lead === side
          ? 'font-black text-fg'
          : 'font-semibold text-muted',
    );
  const fill = (side: 'home' | 'away') => (lead === side ? 'bg-fg' : 'bg-caption');
  return (
    <div
      className={cx('flex flex-col gap-1.5', className)}
      data-stat-bar=""
      data-lead={lead ?? 'none'}
    >
      <div className="grid grid-cols-[minmax(3rem,auto)_minmax(0,1fr)_minmax(3rem,auto)] items-center gap-2">
        <b className={figure('home')}>
          <span dir="ltr">{homeText}</span>
        </b>
        <span className="text-center text-xs text-muted">{label}</span>
        <b className={cx(figure('away'), 'text-end')}>
          <span dir="ltr">{awayText}</span>
        </b>
      </div>
      {share !== null && (
        <div aria-hidden="true" className="flex h-1.5 gap-0.75">
          {share > 0 && (
            <span
              className={cx('rounded-xs', fill('home'))}
              style={{ inlineSize: `${share}%` }}
              data-side="home"
            />
          )}
          {share < 100 && (
            <span
              className={cx('rounded-xs', fill('away'))}
              style={{ inlineSize: `${100 - share}%` }}
              data-side="away"
            />
          )}
        </div>
      )}
    </div>
  );
}
