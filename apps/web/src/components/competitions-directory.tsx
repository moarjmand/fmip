'use client';

import Link from '@/components/ui/link';
import { type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { MessageText } from '@/components/message-text';
import { TextField } from '@/components/ui';
import type { Message } from '@/i18n/messages';
import {
  type DirectoryGroup,
  directoryHref,
  directoryView,
  groupSlug,
} from '@/lib/competitions-directory';

/** A group as the page hands it over: its heading and its count already in the reader's words. */
export interface ShownGroup extends DirectoryGroup {
  heading: string;
  /** "3 competitions", in the reader's words and digits. */
  count: Message;
}

/** How many of its competitions' logos a tile shows; its count says how many there are. */
const TILE_LOGOS = 4;

/**
 * The All competitions page's chooser, list and filter (T-1433, T-1612,
 * D-283).
 *
 * The chooser is a tile per country or region -- its flag or mark, its name,
 * how many competitions we follow there and a row of their logos -- and an
 * "All" tile first. A tile is a link to `?country=<slug>`, so a choice works
 * without a script, is kept in the address and can be shared; with a script
 * the list narrows at once and the address follows. The chosen tile is
 * `aria-current`, edged in saffron with a check (never colour alone).
 *
 * The filter is a plain GET form (`?q=`) that carries the choice with it, so
 * the two combine: the list shows the chosen group's competitions the filter
 * matches, and the chooser keeps every group with a match plus the chosen
 * one. A filter that matches nothing says so rather than leaving an empty
 * page (rule 3).
 *
 * Every image -- flags, region marks and logos -- is drawn by the server and
 * handed in, so neither `EntityImage` nor `@fmip/contracts` rides on the
 * page's first load (T-808).
 */
export function CompetitionsDirectory({
  locale,
  groups,
  marks,
  minis,
  logos,
  kinds,
  initialFilter,
  initialGroup,
  words,
}: {
  locale: string;
  groups: readonly ShownGroup[];
  /** Each group's flag or region mark, by group key, plus `all` for the All tile. */
  marks: Readonly<Record<string, ReactNode>>;
  /** Each competition's small logo, by id, for the tiles. */
  minis: Readonly<Record<string, ReactNode>>;
  /** Each competition's large logo, by id, for the cards. */
  logos: Readonly<Record<string, ReactNode>>;
  /** Each competition kind's name ("League", "Cup"). */
  kinds: Readonly<Partial<Record<string, Message>>>;
  initialFilter: string;
  /** The group `?country=` chose, by key; `null` for all. */
  initialGroup: string | null;
  words: {
    /** The filter's label, with its marking. */
    filter: { text: string; lang?: string };
    /** The chooser's landmark name, with its marking. */
    jump: { text: string; lang?: string };
    noMatch: Message;
    /** The All tile's name and count. */
    all: Message;
    allCount: Message;
  };
}) {
  const [filter, setFilter] = useState(initialFilter);
  const [chosen, setChosen] = useState<string | null>(initialGroup);
  const [announced, setAnnounced] = useState(false);
  const chooser = useRef<HTMLUListElement>(null);

  const slugOf = useMemo(
    () => new Map(groups.map((group) => [group.key, groupSlug(group)])),
    [groups],
  );
  const slug = chosen === null ? null : (slugOf.get(chosen) ?? null);

  // The address keeps the choice and the filter, so a narrowed list can be shared or reloaded.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (slug === null) url.searchParams.delete('country');
    else url.searchParams.set('country', slug);
    if (filter.trim() === '') url.searchParams.delete('q');
    else url.searchParams.set('q', filter);
    window.history.replaceState(window.history.state, '', url);
  }, [filter, slug]);

  // On a phone the chooser scrolls sideways: the chosen tile is brought into view.
  useEffect(() => {
    chooser.current
      ?.querySelector('[aria-current="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [chosen]);

  const { shown, tiles } = useMemo(
    () => directoryView(groups, chosen, filter),
    [groups, chosen, filter],
  );
  const chosenGroup = groups.find((group) => group.key === chosen) ?? null;

  /** A plain click chooses in place; a modified one (new tab) follows the link. */
  const choose = (key: string | null) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    setChosen(key);
    setAnnounced(true);
  };

  const tile = (
    key: string | null,
    name: ReactNode,
    count: Message,
    mark: ReactNode,
    competitions: DirectoryGroup['competitions'],
  ) => {
    const current = key === chosen;
    return (
      <li key={key ?? 'all'} className="w-44 shrink-0 snap-start sm:w-auto">
        <a
          href={directoryHref(locale, key === null ? null : (slugOf.get(key) ?? null), filter)}
          onClick={choose(key)}
          aria-current={current ? 'true' : undefined}
          className="focus-inset relative flex h-full min-h-touch flex-col gap-2 rounded-tile border border-default bg-surface p-3 transition-colors hover:border-strong hover:bg-surface-raised aria-[current=true]:border-accent aria-[current=true]:bg-surface-raised aria-[current=true]:shadow-[inset_0_0_0_1px_var(--color-accent)] motion-reduce:transition-none"
          data-testid="competitions-region"
          data-region={key === null ? 'all' : slugOf.get(key)}
        >
          <span className="flex items-center gap-2.5 pe-5">
            {mark}
            <span className="min-w-0 truncate text-sm font-bold">{name}</span>
          </span>
          <span className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1" aria-hidden>
              {competitions.slice(0, TILE_LOGOS).map((c) => (
                <span key={c.id} className="contents">
                  {minis[c.id]}
                </span>
              ))}
            </span>
            <span className="text-xs whitespace-nowrap text-muted">
              <MessageText message={count} />
            </span>
          </span>
          {current ? (
            <span
              aria-hidden
              className="absolute end-2.5 top-2.5 flex size-4 items-center justify-center rounded-full bg-accent text-on-accent"
              data-testid="competitions-region-check"
            >
              <svg viewBox="0 0 16 16" className="size-2.5" fill="none" stroke="currentColor">
                <path d="m3.5 8.5 3 3 6-7" strokeWidth={2.25} strokeLinecap="round" />
              </svg>
            </span>
          ) : null}
        </a>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <form
        role="search"
        method="get"
        action={`/${locale}/competitions`}
        onSubmit={(event) => event.preventDefault()}
      >
        {slug === null ? null : <input type="hidden" name="country" value={slug} />}
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

      <nav aria-label={words.jump.text} lang={words.jump.lang} data-testid="competitions-jump">
        <ul
          ref={chooser}
          className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))] sm:overflow-visible sm:px-0 sm:pb-0"
        >
          {tile(
            null,
            <MessageText message={words.all} />,
            words.allCount,
            marks.all,
            groups.flatMap((group) => group.competitions),
          )}
          {tiles.map((group) =>
            tile(
              group.key,
              <bdi>{group.heading}</bdi>,
              group.count,
              marks[group.key],
              group.competitions,
            ),
          )}
        </ul>
      </nav>

      {/* Said once the reader chooses: which group the list now shows. */}
      <p className="sr-only" role="status" data-testid="competitions-chosen">
        {announced ? (
          chosenGroup === null ? (
            <>
              <MessageText message={words.all} />, <MessageText message={words.allCount} />
            </>
          ) : (
            <>
              <bdi>{chosenGroup.heading}</bdi>, <MessageText message={chosenGroup.count} />
            </>
          )
        ) : null}
      </p>

      {shown.length === 0 ? (
        <p className="text-muted" role="status" data-testid="competitions-no-match">
          <MessageText message={words.noMatch} />
        </p>
      ) : (
        <div className="flex flex-col gap-10" data-testid="competitions-groups">
          {shown.map((group) => (
            <section
              key={group.key}
              id={`group-${group.key}`}
              aria-labelledby={`group-${group.key}-heading`}
              className="flex scroll-mt-4 flex-col gap-4"
              data-testid="competitions-group"
              data-kind={group.kind}
            >
              <div className="flex items-center gap-3 border-b border-default pb-3">
                {marks[group.key]}
                <h2 id={`group-${group.key}-heading`} className="text-lg font-bold">
                  <bdi>{group.heading}</bdi>
                </h2>
                <span className="ms-auto rounded-pill bg-surface-raised px-2.5 py-0.5 text-xs font-semibold text-muted">
                  <MessageText message={group.count} />
                </span>
              </div>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {group.competitions.map((c) => {
                  const kind = kinds[c.kind];
                  return (
                    <li key={c.id}>
                      <Link
                        href={`/${locale}/competition/${c.id}`}
                        className="group flex h-full min-h-20 items-center gap-4 rounded-tile border border-default bg-surface p-3 transition-colors hover:border-accent hover:bg-surface-raised motion-reduce:transition-none"
                        data-testid="competitions-item"
                        data-competition={c.id}
                      >
                        {logos[c.id]}
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="line-clamp-2 leading-snug font-bold">
                            <bdi>{c.name}</bdi>
                          </span>
                          <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
                            {kind === undefined ? null : <MessageText message={kind} />}
                            {kind !== undefined && c.season !== null ? (
                              <span aria-hidden>·</span>
                            ) : null}
                            {c.season === null ? null : (
                              <bdi data-testid="competitions-item-season">{c.season}</bdi>
                            )}
                          </span>
                        </span>
                        <svg
                          aria-hidden
                          viewBox="0 0 16 16"
                          className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent motion-reduce:transition-none rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5"
                          fill="none"
                          stroke="currentColor"
                        >
                          <path
                            d="m6 3.5 4.5 4.5L6 12.5"
                            strokeWidth={1.75}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
