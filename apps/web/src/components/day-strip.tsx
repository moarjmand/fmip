import Link from '@/components/ui/link';
import type { DayLink } from '@/lib/scores';

/**
 * The day strip (T-1496; shared since T-1792, D-394): yesterday, today and
 * the next days as 44px chips, the day's name over its date on a phone and
 * on one line from 640px, the chosen day filled. One row that scrolls inside
 * itself on a phone, never the page (T-605). Each chip is a plain link, so
 * the strip needs no script; the page says where each day leads (`href`).
 * The matches page and the Watch page draw this one strip.
 */
export function DayStrip({
  days,
  href,
  label,
}: {
  days: DayLink[];
  href: (date: string) => string;
  /** The strip's accessible name, marked English where the locale has none (`attribute`). */
  label: { text: string; lang?: string };
}) {
  return (
    <nav
      aria-label={label.text}
      lang={label.lang}
      className="flex max-w-full gap-1 self-start overflow-x-auto rounded-lg border border-default bg-surface p-1 text-sm"
      data-testid="day-strip"
    >
      {days.map((d) => (
        <Link
          key={d.date}
          href={href(d.date)}
          aria-current={d.isSelected ? 'date' : undefined}
          className={`flex min-h-11 min-w-14 shrink-0 flex-col items-center justify-center rounded-md px-3 whitespace-nowrap sm:flex-row sm:gap-1 ${
            d.isSelected
              ? 'bg-brand font-extrabold text-on-brand'
              : 'font-semibold text-muted hover:bg-surface-raised'
          }`}
        >
          <span className="max-sm:text-xs">{d.weekday}</span>
          <span className="max-sm:text-base max-sm:font-bold">{d.day}</span>
        </Link>
      ))}
    </nav>
  );
}
