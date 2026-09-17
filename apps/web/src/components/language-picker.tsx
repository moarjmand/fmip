'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { pickerEntries } from '@/lib/language-picker';

/**
 * The language picker (T-306): the languages the product actually speaks.
 *
 * A client component because it links to the *same page* in another
 * language, and a server component cannot read the pathname -- Next documents
 * that as intentional. The proxy only redirects, never rewrites, so the
 * pathname rendered on the server is the one the browser has.
 *
 * Renders nothing while only one language is finished. That is the state
 * today, and it is the honest one: a menu with one entry is furniture. The
 * day a second catalogue crosses the threshold, this appears -- without a
 * deployment decision, because the threshold is the decision (T-151).
 */
export function LanguagePicker() {
  const pathname = usePathname();
  const entries = pickerEntries(pathname);
  if (entries.length === 0) return null;

  return (
    <nav aria-label="Language" data-testid="language-picker" className="ms-auto">
      <ul className="flex flex-wrap gap-3">
        {entries.map((entry) => (
          <li key={entry.locale}>
            <Link
              href={entry.href}
              lang={entry.locale}
              hrefLang={entry.locale}
              aria-current={entry.current ? 'page' : undefined}
              className={entry.current ? 'font-semibold' : 'underline'}
              data-testid={`language-${entry.locale}`}
            >
              {entry.autonym}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
