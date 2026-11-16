'use client';

import { useRouter } from 'next/navigation';
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { EntityImage } from '@/components/entity-image';
import { cx } from '@/components/ui/cx';
import { formatNumber } from '@/i18n/format';
import type { SuggestAnswer, SuggestRow } from '@/lib/search-suggest';

/** A word handed down already resolved (T-1040); `lang` when the English stands in. */
export interface SuggestWord {
  text: string;
  lang?: string;
}

export interface SearchSuggestWords {
  /** The listbox's name ("Suggestions"). */
  list: SuggestWord;
  /** `{term}`: the last row. */
  seeAll: SuggestWord;
  /** The last row's second line: the full search reaches more kinds. */
  alsoSearches: SuggestWord;
  /** `{term}`: nothing matched. */
  none: SuggestWord;
  unavailable: SuggestWord;
  loading: SuggestWord;
  /** `{count}`: what the live region says when rows arrive. */
  count: SuggestWord;
}

/** Below this many characters nothing is asked (the API's own minimum). */
const MIN_TERM = 2;
/** The pause after a keystroke before asking. */
const DEBOUNCE_MS = 150;
/** "Searching" is drawn only when an answer is slower than this. */
const LOADING_AFTER_MS = 200;

const fill = (word: SuggestWord, params: Record<string, string>): string =>
  word.text.replace(/\{([a-zA-Z]+)\}/g, (whole, name: string) => params[name] ?? whole);

/**
 * A search field with suggestions under it (T-1844, D-435): the ARIA
 * combobox pattern on the form's own `input[name=q]`, so Enter with no row
 * chosen still sends the plain GET form, with or without a script.
 *
 * While the reader types (two characters or more, after a short pause) it
 * asks `/api/search/suggest` and lists at most six teams, competitions and
 * players by kind, then "See all results", which is always there. An answer
 * for a term the field no longer holds is dropped (rule 4); while a new one
 * is on its way the old rows stay, dimmed. Arrow keys move through the rows
 * with the focus kept in the field, Enter opens the row, Escape closes the
 * list (a second Escape clears the field), Tab closes it and moves on.
 *
 * `header` hangs a 372px list from the field's end; `page` gives it the
 * field row's width. Logical properties only (rule 7).
 */
export function SearchCombobox({
  variant,
  locale,
  words,
  name = 'q',
  defaultValue = '',
  placeholder,
  label,
  inputClassName,
  testId,
}: {
  variant: 'header' | 'page';
  locale: string;
  words: SearchSuggestWords;
  name?: string;
  defaultValue?: string;
  placeholder?: string;
  /** The field's accessible name, when no visible label is tied to it. */
  label?: string;
  inputClassName?: string;
  testId?: string;
}) {
  const router = useRouter();
  const ids = useId();
  const listId = `${ids}-list`;
  const optionId = (i: number) => `${ids}-option-${i}`;
  const input = useRef<HTMLInputElement>(null);
  const asked = useRef<AbortController | null>(null);

  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  // What the last finished request answered, and for which term: an error
  // or rows. Set only from the request's own callbacks.
  const [settled, setSettled] = useState<{ term: string; answer: SuggestAnswer | null } | null>(
    null,
  );
  // The last rows that arrived, kept (dimmed) while the next term is asked.
  const [answer, setAnswer] = useState<SuggestAnswer | null>(null);
  // The term whose request has been slower than LOADING_AFTER_MS.
  const [slowTerm, setSlowTerm] = useState<string | null>(null);
  const [active, setActive] = useState(-1);

  const term = value.trim().replace(/\s+/g, ' ');
  const asking = term.length >= MIN_TERM;

  // Ask after a pause; an answer for a term the field no longer holds is dropped.
  useEffect(() => {
    if (!asking) {
      asked.current?.abort();
      return undefined;
    }
    const pause = setTimeout(() => {
      asked.current?.abort();
      const controller = new AbortController();
      asked.current = controller;
      const slowTimer = setTimeout(() => setSlowTerm(term), LOADING_AFTER_MS);
      const url = `/api/search/suggest?q=${encodeURIComponent(term)}&locale=${encodeURIComponent(locale)}`;
      fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } })
        .then(async (response) => {
          if (!response.ok) throw new Error(String(response.status));
          return (await response.json()) as SuggestAnswer;
        })
        .then((found) => {
          if (controller.signal.aborted) return;
          setAnswer(found);
          setSettled({ term, answer: found });
          setActive(-1);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setSettled({ term, answer: null });
          setActive(-1);
        })
        .finally(() => clearTimeout(slowTimer));
    }, DEBOUNCE_MS);
    return () => clearTimeout(pause);
  }, [asking, term, locale]);

  useEffect(() => () => asked.current?.abort(), []);

  const done = settled !== null && settled.term === term;
  const waiting = asking && !done;
  const failed = asking && done && settled.answer === null;
  const slow = waiting && slowTerm === term;
  // The rows that answer this very term; an older answer only while a new one is coming.
  const current = done ? settled.answer : null;
  const shownAnswer = !asking ? null : done ? current : answer;
  const rows: SuggestRow[] = useMemo(
    () => (shownAnswer === null ? [] : shownAnswer.groups.flatMap((g) => g.rows)),
    [shownAnswer],
  );
  const stale = shownAnswer !== null && shownAnswer !== current;
  // Every row, then "See all results": the last option, always there.
  const seeAllIndex = rows.length;
  const expanded = open && asking;

  const close = () => {
    setOpen(false);
    setActive(-1);
  };

  const choose = (index: number) => {
    if (index === seeAllIndex) {
      close();
      input.current?.form?.requestSubmit();
      return;
    }
    const row = rows[index];
    if (row === undefined) return;
    close();
    // The field keeps no term on the page the row opens.
    setValue('');
    router.push(row.href);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const last = seeAllIndex;
    switch (event.key) {
      case 'ArrowDown':
        if (!asking) return;
        event.preventDefault();
        setOpen(true);
        setActive((i) => (i >= last ? 0 : i + 1));
        return;
      case 'ArrowUp':
        if (!asking) return;
        event.preventDefault();
        setOpen(true);
        setActive((i) => (i <= 0 ? last : i - 1));
        return;
      case 'Enter':
        if (expanded && active >= 0) {
          event.preventDefault();
          choose(active);
        }
        return;
      case 'Escape':
        if (expanded) {
          event.preventDefault();
          close();
        } else if (value !== '') {
          event.preventDefault();
          setValue('');
        }
        return;
      case 'Tab':
        close();
        return;
      default:
        return;
    }
  };

  const liveText = !expanded
    ? ''
    : failed
      ? words.unavailable.text
      : slow && current === null
        ? words.loading.text
        : current !== null
          ? current.groups.length === 0
            ? fill(words.none, { term })
            : fill(words.count, { count: formatNumber(locale, rows.length) })
          : '';

  let index = -1;
  return (
    <>
      <input
        ref={input}
        type="search"
        name={name}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
        className={inputClassName}
        data-testid={testId}
        onChange={(event) => {
          setValue(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={close}
        onKeyDown={onKeyDown}
      />
      <span role="status" className="sr-only">
        {liveText}
      </span>
      <div
        id={listId}
        role="listbox"
        aria-label={words.list.text}
        lang={words.list.lang}
        hidden={!expanded}
        // Keep the focus in the field while a row is pressed.
        onMouseDown={(event) => event.preventDefault()}
        className={cx(
          'absolute top-full z-40 mt-1 max-h-[min(70vh,28rem)] flex-col overflow-hidden rounded-control border border-strong bg-surface text-start text-fg shadow-lg',
          variant === 'header' ? 'end-0 w-[372px] max-w-[calc(100vw-2rem)]' : 'start-0 end-0',
          expanded ? 'flex' : 'hidden',
        )}
        data-testid="search-suggest-list"
      >
        <div
          role="presentation"
          className={cx('min-h-0 overflow-y-auto py-1', stale && 'text-muted')}
        >
          {shownAnswer?.groups.map((group) => (
            <div
              key={group.type}
              role="group"
              aria-labelledby={`${ids}-group-${group.type}`}
              className="py-1"
            >
              <div
                id={`${ids}-group-${group.type}`}
                role="presentation"
                lang={group.headingLang ?? undefined}
                className="px-3 py-1 text-xs font-bold text-caption"
              >
                {group.heading}
              </div>
              {group.rows.map((row) => {
                index += 1;
                const i = index;
                return (
                  <div
                    key={`${row.type}-${row.id}`}
                    id={optionId(i)}
                    role="option"
                    aria-selected={active === i}
                    onClick={() => choose(i)}
                    onMouseEnter={() => setActive(i)}
                    className={cx(
                      'flex min-h-touch cursor-pointer items-center gap-3 px-3 py-1.5',
                      active === i && 'bg-surface-raised outline-2 -outline-offset-2 outline-focus',
                    )}
                    data-testid="search-suggest-option"
                  >
                    <EntityImage
                      media={row.image ?? undefined}
                      kind={row.imageKind}
                      name={row.name}
                      size={28}
                    />
                    <span className="flex min-w-0 flex-col">
                      <bdi className="truncate text-sm font-medium">{row.name}</bdi>
                      {row.line !== null && (
                        <bdi className="truncate text-xs text-muted">{row.line}</bdi>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
          {current !== null && current.groups.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted" data-testid="search-suggest-none">
              <span lang={words.none.lang}>{fill(words.none, { term })}</span>
            </p>
          )}
          {failed && (
            <p
              className="flex items-center gap-2 px-3 py-2 text-sm"
              data-testid="search-suggest-unavailable"
            >
              <span aria-hidden="true">⚠</span>
              <span lang={words.unavailable.lang}>{words.unavailable.text}</span>
            </p>
          )}
          {slow && current === null && (
            <p className="px-3 py-2 text-sm text-muted" data-testid="search-suggest-loading">
              <span lang={words.loading.lang}>{words.loading.text}</span>
            </p>
          )}
        </div>
        <div
          id={optionId(seeAllIndex)}
          role="option"
          aria-selected={active === seeAllIndex}
          onClick={() => choose(seeAllIndex)}
          onMouseEnter={() => setActive(seeAllIndex)}
          className={cx(
            'flex min-h-touch shrink-0 cursor-pointer flex-col justify-center border-t border-default px-3 py-1.5',
            active === seeAllIndex && 'bg-surface-raised outline-2 -outline-offset-2 outline-focus',
          )}
          data-testid="search-suggest-all"
        >
          <span className="text-sm font-semibold text-accent" lang={words.seeAll.lang}>
            {fill(words.seeAll, { term })}
          </span>
          <span className="text-xs text-muted" lang={words.alsoSearches.lang}>
            {words.alsoSearches.text}
          </span>
        </div>
      </div>
    </>
  );
}
