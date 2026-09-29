'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type OfferedLanguage, pickerEntriesFor } from '@/lib/language-switch';

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
 *
 * Which languages are offered, and their names, arrive as a prop from the
 * header, a server component (T-1040): deciding needs every catalogue's
 * completeness, and the catalogues stay on the server. Only the links, which
 * need the pathname, are made here.
 */
export function LanguagePicker({ languages }: { languages: readonly OfferedLanguage[] }) {
  const pathname = usePathname();
  const entries = pickerEntriesFor(pathname, languages);
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
