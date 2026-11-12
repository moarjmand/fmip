import { ConsoleLink as Link } from '@/app/console/console-link';

/** The calendar's two pages (T-1788, D-391): the calendar, and the subscriptions it reminds of. */
export function CalendarTabs({ current }: { current: 'calendar' | 'subscriptions' }) {
  const tabs = [
    ['calendar', '/calendar', 'تقویم'],
    ['subscriptions', '/calendar/subscriptions', 'خریدها و اشتراک‌ها'],
  ] as const;
  return (
    <nav aria-label="بخش‌های تقویم" className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none]">
      <ul className="flex gap-1.5">
        {tabs.map(([key, href, words]) => (
          <li key={key}>
            <Link
              href={href}
              aria-current={current === key ? 'page' : undefined}
              className={`inline-flex min-h-touch items-center whitespace-nowrap rounded-pill border px-4 text-sm font-bold ${
                current === key
                  ? 'border-fg bg-fg text-canvas'
                  : 'border-default text-muted hover:border-strong hover:text-fg'
              }`}
            >
              {words}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
