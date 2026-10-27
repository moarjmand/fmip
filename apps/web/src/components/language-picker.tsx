'use client';

import Link from '@/components/ui/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useId, useRef } from 'react';
import { type OfferedLanguage, pickerEntriesFor, shortName } from '@/lib/language-switch';

/**
 * The language picker (T-306; the header's globe, T-1610, D-281): the
 * languages the product actually speaks.
 *
 * A client component because it links to the *same page* in another
 * language, and a server component cannot read the pathname -- Next documents
 * that as intentional. The proxy only redirects, never rewrites, so the
 * pathname rendered on the server is the one the browser has.
 *
 * Renders nothing while only one language is offered: a menu with one entry
 * is furniture. The day a second catalogue crosses the threshold, this
 * appears -- without a deployment decision, because the threshold is the
 * decision (T-151). A held language (T-1163) is not offered.
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
 *
 * Two looks (D-281):
 * - `menu`, the header's: a globe and the page's language in short ("EN",
 *   «فا»), a `<details>` disclosure like More, so it opens with no script;
 *   its list names every offered language in its own name, the page's own
 *   marked current. Escape, a click elsewhere or a choice closes it (and
 *   the phone's Menu around it).
 * - `list`, the site footer's: the same links in a row under the word
 *   "Language", nothing to open.
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
  /** The word "Language", resolved by the server component, with its marking. */
  label: { text: string; lang?: string };
  variant?: 'menu' | 'list';
  /** Before every test id: `''` in the header, `'footer-'` in the footer, so each is found once. */
  testIdPrefix?: string;
};

/** A globe on the 24-unit grid, in the text colour. */
function Globe() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18" />
    </svg>
  );
}

function Picker({
  languages,
  label,
  variant = 'menu',
  testIdPrefix = '',
  search,
}: PickerProps & { search: string }) {
  const pathname = usePathname();
  const labelId = useId();
  const away = useRef<((event: Event) => void) | null>(null);
  const entries = pickerEntriesFor(pathname, languages, search);
  if (entries.length === 0) return null;

  const links = (className: string) =>
    entries.map((entry) => (
      <li key={entry.locale}>
        <Link
          href={entry.href}
          lang={entry.locale}
          hrefLang={entry.locale}
          aria-current={entry.current ? 'page' : undefined}
          className={className}
          data-testid={`${testIdPrefix}language-${entry.locale}`}
        >
          {entry.autonym}
        </Link>
      </li>
    ));

  if (variant === 'list') {
    return (
      <div
        role="group"
        aria-labelledby={labelId}
        className="flex flex-col gap-1"
        data-testid={`${testIdPrefix}language-picker`}
      >
        <span id={labelId} lang={label.lang} className="flex items-center gap-2 text-caption">
          <Globe />
          {label.text}
        </span>
        <ul className="flex flex-wrap gap-x-5">{links('footer-link')}</ul>
      </div>
    );
  }

  const current = entries.find((entry) => entry.current);
  return (
    <details
      className="relative"
      data-testid={`${testIdPrefix}language-picker`}
      onToggle={(event) => {
        // Open: a click anywhere else closes it. Closed: stop listening.
        const details = event.currentTarget;
        if (away.current !== null) document.removeEventListener('click', away.current);
        away.current = null;
        if (!details.open) return;
        away.current = (click) => {
          if (!details.contains(click.target as Node)) details.open = false;
        };
        document.addEventListener('click', away.current);
      }}
      onKeyDown={(event) => {
        const details = event.currentTarget;
        if (event.key !== 'Escape' || !details.open) return;
        details.open = false;
        details.querySelector('summary')?.focus();
      }}
      onClick={(event) => {
        // A language chosen: close the picker and the phone's Menu around it.
        const details = event.currentTarget;
        if (!(event.target as Element).closest('a')) return;
        details.open = false;
        details.parentElement?.closest('details')?.removeAttribute('open');
      }}
    >
      <summary
        className="lang-toggle cursor-pointer list-none [&::-webkit-details-marker]:hidden"
        data-testid={`${testIdPrefix}language-toggle`}
      >
        <Globe />
        {/* The word in the phone's Menu; in the bar the globe says it, the word kept for a screen reader. */}
        <span lang={label.lang} className="lg:sr-only">
          {label.text}
        </span>
        {current !== undefined && (
          <>
            <span aria-hidden="true" lang={current.locale}>
              {shortName(current.locale)}
            </span>
            <span className="sr-only" lang={current.locale}>
              {current.autonym}
            </span>
          </>
        )}
        <span aria-hidden="true" className="lg:max-xl:hidden">
          ▾
        </span>
      </summary>
      <ul className="lang-panel">{links('lang-entry')}</ul>
    </details>
  );
}
