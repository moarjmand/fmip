'use client';

import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageText } from '@/components/message-text';
import Link from '@/components/ui/link';
import type { Message } from '@/i18n/messages';
import { refreshCompetitionsMenu } from '@/lib/competitions-menu-actions';
import {
  type CompetitionsMenuView,
  type MenuRowView,
  type MenuShow,
  closeCompetitionsMenu,
} from '@/lib/competitions-menu-state';
import { foldName } from '@/lib/fold-name';

/**
 * The competitions menu's panel and list (T-1643, D-301), the code a reader
 * fetches only when they first point at, focus or open Competitions: the
 * header's shell (`competitions-menu-view.tsx`) loads it lazily, so no page
 * carries it in its first load. The competitions page imports the list
 * directly for a phone. The rows are drawn by the server
 * (`components/competitions-menu.tsx`); what runs here is asking for them,
 * focus and closing, the filter and the toggles.
 */

type Words = { text: string; lang?: string };

/** The words the header resolves for the panel's frame (`menuFrameWords`). */
export interface MenuFrameWords {
  title: Message;
  loading: Message;
  unreachable: Message;
  open: Message;
  filter: Words;
  show: Words;
}

/** What is held is asked for again when the panel opens this long after it came, and every this long while open. */
const MENU_FRESH_MS = 30_000;

/** Whether a row answers the toggles and the filter: every word typed is in its name, short name, country or group. */
export function rowShown(
  row: Pick<MenuRowView, 'fold' | 'live' | 'today'>,
  filter: string,
  show: MenuShow,
): boolean {
  if (show === 'live' && !row.live) return false;
  if (show === 'today' && !row.today) return false;
  return foldName(filter)
    .split(' ')
    .filter(Boolean)
    .every((word) => row.fold.includes(word));
}

/**
 * The panel itself, inside the shell's `#competitions-menu`: under the
 * header, the container's width, over a scrim that dims the page (the header
 * is lifted above it, `globals.css`). It asks for its list when it is first
 * drawn, again on an opening once that is `MENU_FRESH_MS` old, and every
 * `MENU_FRESH_MS` while it stays open. Focus moves to the filter on opening;
 * Esc, a click on the scrim or a chosen link closes it and hands focus back
 * to the trigger; focus leaving it closes it.
 */
export default function CompetitionsMenuPanelBody({
  locale,
  timeZone,
  words,
  open,
}: {
  locale: string;
  timeZone: string;
  words: MenuFrameWords;
  /** Open and on a screen wide enough for it. */
  open: boolean;
}) {
  const [view, setView] = useState<CompetitionsMenuView | null>(null);
  const [failed, setFailed] = useState(false);
  const received = useRef(0);
  const asking = useRef(false);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const ask = useCallback(
    (maxAge: number) => {
      if (asking.current || Date.now() - received.current < maxAge) return;
      asking.current = true;
      refreshCompetitionsMenu(locale, timeZone)
        .then(
          (next) => {
            if (next === null) {
              setFailed(true);
              return;
            }
            received.current = Date.now();
            setView(next);
            setFailed(false);
          },
          () => setFailed(true),
        )
        .finally(() => {
          asking.current = false;
        });
    },
    [locale, timeZone],
  );

  // Drawn for the first time (a hover or a focus of the trigger, or an opening): ask.
  useEffect(() => ask(MENU_FRESH_MS), [ask]);

  // Open: ask if what is held is old, and keep it current while it stays open (rule 4).
  useEffect(() => {
    if (!open) return;
    ask(MENU_FRESH_MS);
    const every = window.setInterval(() => ask(0), MENU_FRESH_MS);
    return () => window.clearInterval(every);
  }, [open, ask]);

  // Focus into the panel once it is drawn open: the filter, else the panel itself.
  const loaded = view !== null;
  useEffect(() => {
    if (!open) return;
    const box = panel.current;
    (box?.querySelector<HTMLInputElement>('input[type="search"]') ?? box)?.focus();
  }, [open, loaded]);

  // Esc closes from anywhere while it is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeCompetitionsMenu();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const title = (
    <h2 id={titleId} className="text-lg font-bold">
      <MessageText message={words.title} />
    </h2>
  );
  return (
    <>
      {open
        ? createPortal(
            <div
              aria-hidden="true"
              className="fixed inset-0 z-30 bg-on-brand/50"
              data-testid="competitions-menu-scrim"
              onClick={() => closeCompetitionsMenu()}
            />,
            document.body,
          )
        : null}
      <div
        ref={panel}
        role="dialog"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="menu-panel"
        data-testid="competitions-menu"
        onClick={(event) => {
          if ((event.target as Element).closest('a')) closeCompetitionsMenu();
        }}
        onBlur={(event) => {
          // Focus gone elsewhere on the page (not into the panel, not to an
          // opener, which toggles it itself): the reader has moved on.
          const to = event.relatedTarget as HTMLElement | null;
          if (to === null || event.currentTarget.contains(to)) return;
          if (to.closest('[aria-controls="competitions-menu"]')) return;
          closeCompetitionsMenu(false);
        }}
      >
        <div className="page-frame flex max-h-[calc(100dvh-5rem)] flex-col gap-5 overflow-y-auto py-5">
          {view === null ? (
            <>
              {title}
              <p
                className="text-sm text-muted"
                role="status"
                data-testid={failed ? 'competitions-menu-unreachable' : 'competitions-menu-loading'}
              >
                <MessageText message={failed ? words.unreachable : words.loading} />
              </p>
            </>
          ) : (
            <CompetitionsMenuBody
              view={view}
              layout="columns"
              filter={words.filter}
              show={words.show}
              head={
                <div className="me-auto flex min-w-0 flex-col">
                  {title}
                  <p className="text-xs text-muted" data-testid="competitions-menu-counts">
                    <MessageText message={view.counts} />
                  </p>
                </div>
              }
            />
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-default pt-3 text-xs text-muted">
            <Link
              href={`/${locale}/competitions`}
              className="inline-flex min-h-8 items-center font-bold text-accent hover:underline"
              data-testid="competitions-menu-all"
            >
              <MessageText message={words.open} />
            </Link>
            {view === null ? null : (
              <>
                <span data-testid="competitions-menu-note">
                  <MessageText message={view.note} />
                </span>
                {view.stamp}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * The list with its filter and toggles. `columns`: the desktop panel's five
 * tracks, More of Europe across two of them with its rows in two columns.
 * `stack`: a phone's, every group under the other with 44px rows. Both read
 * the groups in one order, so the page and the panel never disagree.
 *
 * The filter keeps the competitions whose name, short name, country or
 * group holds every word typed, in the reader's language and letters
 * (`foldName`); the toggles keep all, today's or the live ones. A group left
 * with none is not drawn; nothing left says so, never an empty box (rule 3).
 * The number shown is said to a screen reader once the reader narrows it.
 */
export function CompetitionsMenuBody({
  view,
  layout,
  filter: filterLabel,
  show: showLabel,
  head,
  headingLevel = 3,
}: {
  view: CompetitionsMenuView;
  layout: 'columns' | 'stack';
  filter: Words;
  show: Words;
  head?: ReactNode;
  headingLevel?: 2 | 3;
}) {
  const [filter, setFilter] = useState('');
  const [show, setShow] = useState<MenuShow>('all');
  const [touched, setTouched] = useState(false);
  const id = useId();
  const Heading = headingLevel === 2 ? 'h2' : 'h3';

  const columns = view.columns.map((column) =>
    column
      .map((group) => ({ ...group, rows: group.rows.filter((row) => rowShown(row, filter, show)) }))
      .filter((group) => group.rows.length > 0),
  );
  const count = columns.flat().reduce((sum, group) => sum + group.rows.length, 0);
  const choices: MenuShow[] = view.show === null ? [] : ['all', 'today', 'live'];

  const group = (g: (typeof columns)[number][number], wide: boolean) => (
    <section
      key={g.region}
      aria-labelledby={`${id}-${g.region}`}
      className="flex flex-col gap-1"
      data-testid="competitions-menu-group"
      data-region={g.region}
    >
      <Heading id={`${id}-${g.region}`} className="menu-group-label">
        <MessageText message={g.label} />
        <span aria-hidden="true" className="tabular-nums">
          {view.numbers[g.rows.length] ?? g.rows.length}
        </span>
      </Heading>
      <ul
        className={
          layout === 'stack'
            ? 'flex flex-col divide-y divide-default [&_.menu-row]:min-h-touch'
            : wide
              ? 'grid grid-cols-2 gap-x-6'
              : 'flex flex-col'
        }
      >
        {g.rows.map((row) => (
          <li key={row.id} className="min-w-0">
            {row.node}
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div className="flex flex-col gap-5" data-testid="competitions-menu-body" data-layout={layout}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {head}
        <label className="menu-search">
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
            className="shrink-0"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-4-4" />
          </svg>
          <span className="sr-only" lang={filterLabel.lang}>
            {filterLabel.text}
          </span>
          <input
            type="search"
            value={filter}
            placeholder={filterLabel.text}
            autoComplete="off"
            enterKeyHint="search"
            data-testid="competitions-menu-filter"
            onChange={(event) => {
              setFilter(event.target.value);
              setTouched(true);
            }}
          />
        </label>
        {choices.length === 0 ? null : (
          <div
            role="group"
            aria-label={showLabel.text}
            lang={showLabel.lang}
            className="flex gap-1"
            data-testid="competitions-menu-show"
          >
            {choices.map((choice) => (
              <button
                key={choice}
                type="button"
                aria-pressed={show === choice}
                className="menu-toggle"
                data-show={choice}
                onClick={() => {
                  setShow(choice);
                  setTouched(true);
                }}
              >
                <MessageText message={view.show![choice]} />
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="sr-only" role="status" data-testid="competitions-menu-shown">
        {touched ? view.counted[count] : null}
      </p>

      {count === 0 ? (
        <p className="text-sm text-muted" data-testid="competitions-menu-no-match">
          <MessageText message={view.noMatch} />
        </p>
      ) : layout === 'columns' ? (
        <div className="grid grid-cols-5 gap-x-6 gap-y-5" data-testid="competitions-menu-columns">
          {columns.map((column, index) => (
            <div
              key={index}
              className={index === 1 ? 'col-span-2 flex flex-col gap-5' : 'flex flex-col gap-5'}
            >
              {column.map((g) => group(g, index === 1))}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-6">{columns.flat().map((g) => group(g, false))}</div>
      )}
    </div>
  );
}
