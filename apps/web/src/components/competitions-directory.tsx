'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { EntityImage } from '@/components/entity-image';
import { MessageText } from '@/components/message-text';
import { TextField } from '@/components/ui';
import type { Message } from '@/i18n/messages';
import { type DirectoryGroup, matchesFilter } from '@/lib/competitions-directory';

/** A group as the page hands it over: its heading already in the reader's words. */
export interface ShownGroup extends DirectoryGroup {
  heading: string;
}

/**
 * The All competitions page's list and filter (T-1433). Every group is a
 * section with its heading; the jump list at the top is one link per group.
 * The filter is a plain GET form (`?q=`), so without a script Enter sends it
 * and the server answers the filtered page; with one, the list narrows as
 * the reader types and the address keeps the filter. A filter that matches
 * nothing says so rather than leaving an empty page (rule 3).
 */
export function CompetitionsDirectory({
  locale,
  groups,
  initialFilter,
  words,
}: {
  locale: string;
  groups: readonly ShownGroup[];
  initialFilter: string;
  words: {
    /** The filter's label, with its marking. */
    filter: { text: string; lang?: string };
    /** The jump list's landmark name, with its marking. */
    jump: { text: string; lang?: string };
    noMatch: Message;
  };
}) {
  const [filter, setFilter] = useState(initialFilter);

  // The address keeps the filter, so a narrowed list can be shared or reloaded.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (filter.trim() === '') url.searchParams.delete('q');
    else url.searchParams.set('q', filter);
    window.history.replaceState(window.history.state, '', url);
  }, [filter]);

  const shown = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          competitions: group.competitions.filter((c) => matchesFilter(c, group.heading, filter)),
        }))
        .filter((group) => group.competitions.length > 0),
    [groups, filter],
  );

  return (
    <div className="flex flex-col gap-6">
      <form
        role="search"
        method="get"
        action={`/${locale}/competitions`}
        onSubmit={(event) => event.preventDefault()}
      >
        <TextField
          label={words.filter.text}
          lang={words.filter.lang}
          id="competitions-filter"
          name="q"
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          autoComplete="off"
          enterKeyHint="search"
          data-testid="competitions-filter"
        />
      </form>

      {shown.length === 0 ? (
        <p className="text-muted" role="status" data-testid="competitions-no-match">
          <MessageText message={words.noMatch} />
        </p>
      ) : (
        <>
          <nav aria-label={words.jump.text} lang={words.jump.lang} data-testid="competitions-jump">
            <ul className="flex flex-wrap gap-2">
              {shown.map((group) => (
                <li key={group.key}>
                  <a
                    href={`#group-${group.key}`}
                    className="inline-flex min-h-touch items-center rounded-control border border-default px-3 text-sm font-semibold hover:border-strong"
                  >
                    <bdi>{group.heading}</bdi>
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex flex-col gap-8" data-testid="competitions-groups">
            {shown.map((group) => (
              <section
                key={group.key}
                id={`group-${group.key}`}
                aria-labelledby={`group-${group.key}-heading`}
                className="flex scroll-mt-4 flex-col gap-3"
                data-testid="competitions-group"
                data-kind={group.kind}
              >
                <h2
                  id={`group-${group.key}-heading`}
                  className="border-b border-default pb-2 text-lg font-bold"
                >
                  <bdi>{group.heading}</bdi>
                </h2>
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {group.competitions.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/${locale}/competition/${c.id}`}
                        className="flex min-h-touch items-center gap-3 rounded-control border border-default bg-surface px-3 py-2 font-semibold hover:border-strong"
                        data-testid="competitions-item"
                        data-competition={c.id}
                      >
                        <EntityImage media={c.logo} kind="logo" name={c.name} size={22} />
                        <bdi>{c.name}</bdi>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
