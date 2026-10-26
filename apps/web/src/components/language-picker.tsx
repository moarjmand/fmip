'use client';

import Link from '@/components/ui/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
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
 *
 * The links keep the page's query (T-1572): `/en/leaderboard?period=month`
 * offers `/fa/leaderboard?period=month`, not the page's first state. The
 * query is read under a Suspense boundary (Next 16 requires one for
 * `useSearchParams` on a prerendered route); until it is read, the links
 * are drawn without it.
 */
export function LanguagePicker(props: PickerProps) {
  return (
    <Suspense fallback={<Picker {...props} search="" />}>
      <PickerWithQuery {...props} />
    </Suspense>
  );
}

function PickerWithQuery(props: PickerProps) {
  const search = useSearchParams().toString();
  return <Picker {...props} search={search} />;
}

type PickerProps = {
  languages: readonly OfferedLanguage[];
  /** The navigation's name, resolved by the header (`attribute`), with its marking. */
  label: { text: string; lang?: string };
  /**
   * The Hybrid header (T-1381, D-199) offers only the other languages, each
   * in its own name: "فارسی" on an English page, "English" on a Persian one.
   * The page's own language is the page itself.
   */
  others?: boolean;
};

function Picker({ languages, label, others = false, search }: PickerProps & { search: string }) {
  const pathname = usePathname();
  const entries = pickerEntriesFor(pathname, languages, search);
  if (entries.length === 0) return null;
  const shown = others ? entries.filter((entry) => !entry.current) : entries;

  return (
    <nav aria-label={label.text} lang={label.lang} data-testid="language-picker">
      <ul className="flex flex-wrap gap-x-3">
        {shown.map((entry) => (
          <li key={entry.locale}>
            <Link
              href={entry.href}
              lang={entry.locale}
              hrefLang={entry.locale}
              aria-current={entry.current ? 'page' : undefined}
              className={`flex min-h-touch items-center px-3 font-semibold md:px-2.5 ${
                entry.current ? '' : 'text-muted hover:text-accent'
              }`}
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
