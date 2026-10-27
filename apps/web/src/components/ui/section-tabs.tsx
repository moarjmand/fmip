import { cx } from './cx';
import Link from './link';

/**
 * Section tabs inside a page (the Design System's `Tabs`, T-1510, D-263;
 * T-1386's band tabs): the competition's, the club's and the player's. Links,
 * so each tab is a URL that works without JavaScript and fetches only what it
 * shows (D-203). The open tab is ink and bold over a saffron rule, and says
 * so in `aria-current`; the rest are muted. The row never wraps: on a phone it
 * scrolls sideways, and opens scrolled to the open tab (T-1564,
 * `scroll-initial-target`), so a reader on the last tab sees where they are;
 * a browser without it shows the row's start, as before. Each tab is a 44px target. The saffron rule is the
 * accent, which keeps 3:1 on the Day ground, where the bright fill would not.
 * Server-component safe.
 */
export function SectionTabs({
  label,
  testId,
  tabs,
}: {
  /** The row's name for screen readers ("Sections"). */
  label: string;
  testId: string;
  tabs: { key: string; href: string; label: string; current: boolean }[];
}) {
  return (
    <nav aria-label={label} className="-mb-px flex gap-1 overflow-x-auto" data-testid={testId}>
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.current ? 'page' : undefined}
          data-testid={`${testId}-${tab.key}`}
          className={cx(
            'inline-flex min-h-touch shrink-0 items-center border-b-3 px-3.5 text-sm whitespace-nowrap',
            tab.current
              ? 'border-accent font-extrabold text-fg [scroll-initial-target:nearest]'
              : 'border-transparent font-semibold text-muted hover:text-fg',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
