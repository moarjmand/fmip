'use client';

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from 'react';
import type { ConsoleCanvasBlock, ConsoleCanvasCard, ConsoleCanvasTag } from '@fmip/contracts';
import {
  CONSOLE_CANVAS_BLOCKS,
  CONSOLE_CANVAS_NOTE_MAX,
  CONSOLE_CANVAS_SOURCE_MAX,
  CONSOLE_CANVAS_TAGS,
  CONSOLE_CANVAS_TEXT_MAX,
} from '@fmip/contracts/console';
import {
  type CanvasCardFields,
  type CanvasResult,
  createCanvasCard,
  moveCanvasCard,
  removeCanvasCard,
  restoreCanvasCard,
  updateCanvasCard,
} from '@/lib/console-actions';
import {
  type CanvasLang,
  CANVAS_WORDS,
  TAG_TONE,
  TAG_WORDS,
  at,
  blockName,
  canvasJson,
  cardText,
} from './canvas-words';

/**
 * The business model canvas's one client part (T-1855, D-440): a card with
 * its controls (edit in place in both languages with its tag and block, up,
 * down, remove with an undo), the add button of a block, a removed card's
 * restore, the JSON download and the print button, and the toast that
 * carries an undo past the card's own removal. Every write is a server
 * action; the page redraws from the server after it.
 */

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
const ICON = `inline-flex min-h-touch min-w-touch items-center justify-center rounded-control text-muted hover:bg-surface hover:text-fg disabled:opacity-40 ${FOCUS}`;
const SECONDARY = `inline-flex min-h-touch items-center justify-center gap-1.5 whitespace-nowrap rounded-control border border-strong bg-surface px-3 text-sm text-fg hover:bg-surface-raised disabled:opacity-50 ${FOCUS}`;
const PRIMARY = `inline-flex min-h-touch items-center justify-center rounded-control bg-brand px-4 text-sm font-bold text-on-brand disabled:opacity-60 ${FOCUS}`;
const FIELD =
  'w-full rounded-control border border-strong bg-canvas px-2.5 py-1.5 text-sm leading-6 text-fg focus:outline-2 focus:outline-focus';

// --- The toast ---------------------------------------------------------------

interface Toast {
  words: string;
  action?: { label: string; run: () => void };
}

const ToastContext = createContext<(toast: Toast | null) => void>(() => undefined);

/**
 * The canvas's toast: one message at a time, with an action (the undo of a
 * removal), gone after eight seconds. It sits above the board so a removed
 * card, which leaves the page, can still be brought back from it.
 */
export function CanvasToasts({ children, lang }: { children: ReactNode; lang: CanvasLang }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((next: Toast | null) => {
    if (timer.current !== null) clearTimeout(timer.current);
    setToast(next);
    if (next !== null) timer.current = setTimeout(() => setToast(null), 8000);
  }, []);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        role="status"
        aria-live="polite"
        data-print="hide"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
      >
        {toast !== null && (
          <div className="pointer-events-auto flex max-w-xl items-center gap-3 rounded-tile bg-fg px-4 py-2.5 text-sm text-canvas shadow-lg">
            <span>{toast.words}</span>
            {toast.action !== undefined && (
              <button
                type="button"
                onClick={() => {
                  toast.action?.run();
                  show(null);
                }}
                className={`min-h-touch rounded-control bg-brand px-3 font-bold text-on-brand ${FOCUS}`}
              >
                {toast.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => show(null)}
              aria-label={CANVAS_WORDS[lang].close}
              className={`min-h-touch min-w-touch rounded-control ${FOCUS}`}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

// --- Icons -----------------------------------------------------------------------

const PATHS = {
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  remove: 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12',
  plus: 'M12 5v14M5 12h14',
} as const;

function Icon({ name }: { name: keyof typeof PATHS }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

// --- A card ------------------------------------------------------------------------

/** The other language's text, marked as such (FA or EN), in its own direction. */
function OtherLanguage({ lang, title }: { lang: CanvasLang; title: string }) {
  return (
    <abbr
      lang="en"
      dir="ltr"
      title={title}
      className="ms-1.5 inline-block rounded-control border border-strong px-1 align-middle text-xs font-bold leading-4 text-muted no-underline"
    >
      {lang === 'fa' ? 'EN' : 'FA'}
    </abbr>
  );
}

/** One card: tag, text, note, source, who changed it last, and its controls. */
export function CanvasCard({
  card,
  lang,
  first,
  last,
}: {
  card: ConsoleCanvasCard;
  lang: CanvasLang;
  first: boolean;
  last: boolean;
}) {
  const w = CANVAS_WORDS[lang];
  const toast = useContext(ToastContext);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const shown = cardText(card, lang);
  const run = (work: () => Promise<CanvasResult>, after?: () => void) => {
    setError(null);
    start(async () => {
      const result = await work();
      if (!result.ok) setError(result.error);
      else after?.();
    });
  };

  if (editing)
    return (
      <li className="canvas-card" data-testid="canvas-card-editor">
        <CardEditor
          lang={lang}
          initial={card}
          onCancel={() => setEditing(false)}
          onSave={(patch) => updateCanvasCard(card.id, patch)}
          onSaved={() => setEditing(false)}
        />
      </li>
    );

  return (
    <li
      className={`canvas-card flex flex-col gap-1 rounded-tile border p-2.5 ${TAG_TONE[card.tag].card}`}
      data-testid="canvas-card"
      data-tag={card.tag}
    >
      <p className="flex items-center gap-1.5 text-xs font-bold text-muted">
        <span
          aria-hidden="true"
          className={`size-2.5 shrink-0 rounded-pill ${TAG_TONE[card.tag].dot}`}
        />
        {TAG_WORDS[card.tag][lang]}
      </p>
      <p className="whitespace-pre-line break-words text-sm font-semibold leading-6 text-fg">
        <span lang={shown.textLang} dir={shown.textLang === 'fa' ? 'rtl' : 'ltr'}>
          {shown.text}
        </span>
        {shown.textLang !== lang && <OtherLanguage lang={lang} title={w.onlyOther} />}
      </p>
      {shown.note !== '' && (
        <p
          className="whitespace-pre-line break-words text-xs leading-5 text-muted"
          lang={shown.noteLang}
          dir={shown.noteLang === 'fa' ? 'rtl' : 'ltr'}
        >
          {shown.note}
        </p>
      )}
      {card.source !== '' && (
        <p
          className="break-words font-mono text-xs leading-4 text-caption [unicode-bidi:plaintext]"
          dir="ltr"
        >
          {card.source}
        </p>
      )}
      <div className="mt-0.5 flex flex-wrap items-center justify-between gap-x-2">
        <p className="min-w-0 truncate text-xs text-caption" data-testid="canvas-card-who">
          {card.last_change === null ? (
            w.firstFill
          ) : (
            <>
              <span dir="auto">{card.last_change.actor}</span> · {at(card.last_change.at, lang)}
            </>
          )}
        </p>
        <div className="-me-2 flex" role="group" aria-label={w.cardActions} data-print="hide">
          <button
            type="button"
            className={ICON}
            aria-label={w.edit}
            title={w.edit}
            disabled={pending}
            onClick={() => setEditing(true)}
          >
            <Icon name="edit" />
          </button>
          <button
            type="button"
            className={ICON}
            aria-label={w.up}
            title={w.up}
            disabled={pending || first}
            onClick={() => run(() => moveCanvasCard(card.id, 'up'))}
          >
            <Icon name="up" />
          </button>
          <button
            type="button"
            className={ICON}
            aria-label={w.down}
            title={w.down}
            disabled={pending || last}
            onClick={() => run(() => moveCanvasCard(card.id, 'down'))}
          >
            <Icon name="down" />
          </button>
          <button
            type="button"
            className={`${ICON} hover:text-danger`}
            aria-label={w.remove}
            title={w.remove}
            disabled={pending}
            onClick={() =>
              run(
                () => removeCanvasCard(card.id),
                () =>
                  toast({
                    words: w.removed,
                    action: {
                      label: w.undo,
                      run: () => void restoreCanvasCard(card.id),
                    },
                  }),
              )
            }
          >
            <Icon name="remove" />
          </button>
        </div>
      </div>
      <p role="status" aria-live="polite" className="text-xs text-danger empty:hidden">
        {error}
      </p>
    </li>
  );
}

// --- The editor --------------------------------------------------------------------

type Draft = Required<Omit<CanvasCardFields, 'block' | 'tag'>> & {
  block: ConsoleCanvasBlock;
  tag: ConsoleCanvasTag;
};

const FIELDS = ['text_fa', 'text_en', 'note_fa', 'note_en', 'source'] as const;

/**
 * The editor in place: both languages' text and note, the source, the tag
 * and the block. A save sends only what changed; Ctrl+Enter saves and Esc
 * cancels.
 */
export function CardEditor({
  lang,
  initial,
  onCancel,
  onSave,
  onSaved,
}: {
  lang: CanvasLang;
  initial: Draft;
  onCancel: () => void;
  onSave: (fields: CanvasCardFields) => Promise<CanvasResult>;
  onSaved: () => void;
}) {
  const w = CANVAS_WORDS[lang];
  const id = useId();
  const [draft, setDraft] = useState<Draft>({
    block: initial.block,
    tag: initial.tag,
    text_fa: initial.text_fa,
    text_en: initial.text_en,
    note_fa: initial.note_fa,
    note_en: initial.note_en,
    source: initial.source,
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const first = useRef<HTMLTextAreaElement>(null);
  useEffect(() => first.current?.focus(), []);

  const set = (key: keyof Draft) => (value: string) =>
    setDraft((d) => ({ ...d, [key]: value }) as Draft);
  const save = () => {
    if (draft.text_fa.trim() === '' && draft.text_en.trim() === '') {
      setError(w.needText);
      return;
    }
    const changed: CanvasCardFields = {};
    if (draft.block !== initial.block) changed.block = draft.block;
    if (draft.tag !== initial.tag) changed.tag = draft.tag;
    for (const key of FIELDS) if (draft[key] !== initial[key]) changed[key] = draft[key];
    if (Object.keys(changed).length === 0) return onCancel();
    setError(null);
    start(async () => {
      const result = await onSave(changed);
      if (result.ok) onSaved();
      else setError(result.error);
    });
  };

  const area = (
    key: (typeof FIELDS)[number],
    label: string,
    dir: 'rtl' | 'ltr',
    max: number,
    rows: number,
  ) => (
    <label className="flex flex-col gap-1 text-xs font-bold text-muted" htmlFor={`${id}-${key}`}>
      {label}
      <textarea
        id={`${id}-${key}`}
        ref={key === (lang === 'fa' ? 'text_fa' : 'text_en') ? first : undefined}
        value={draft[key]}
        onChange={(e) => set(key)(e.target.value)}
        maxLength={max}
        rows={rows}
        dir={dir}
        lang={dir === 'rtl' ? 'fa' : 'en'}
        className={`${FIELD} font-normal ${key.startsWith('text') ? 'font-semibold' : ''}`}
      />
    </label>
  );

  return (
    <form
      className="flex flex-col gap-2.5 rounded-tile border-2 border-focus bg-surface p-3"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          save();
        }
      }}
      data-testid="canvas-editor"
    >
      {lang === 'fa' ? (
        <>
          {area('text_fa', w.fTextFa, 'rtl', CONSOLE_CANVAS_TEXT_MAX, 2)}
          {area('text_en', w.fTextEn, 'ltr', CONSOLE_CANVAS_TEXT_MAX, 2)}
          {area('note_fa', w.fNoteFa, 'rtl', CONSOLE_CANVAS_NOTE_MAX, 2)}
          {area('note_en', w.fNoteEn, 'ltr', CONSOLE_CANVAS_NOTE_MAX, 2)}
        </>
      ) : (
        <>
          {area('text_en', w.fTextEn, 'ltr', CONSOLE_CANVAS_TEXT_MAX, 2)}
          {area('text_fa', w.fTextFa, 'rtl', CONSOLE_CANVAS_TEXT_MAX, 2)}
          {area('note_en', w.fNoteEn, 'ltr', CONSOLE_CANVAS_NOTE_MAX, 2)}
          {area('note_fa', w.fNoteFa, 'rtl', CONSOLE_CANVAS_NOTE_MAX, 2)}
        </>
      )}
      <label className="flex flex-col gap-1 text-xs font-bold text-muted" htmlFor={`${id}-source`}>
        {w.fSource}
        <input
          id={`${id}-source`}
          value={draft.source}
          onChange={(e) => set('source')(e.target.value)}
          maxLength={CONSOLE_CANVAS_SOURCE_MAX}
          dir="ltr"
          className={`${FIELD} font-mono text-xs`}
        />
      </label>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-xs font-bold text-muted">{w.fTag}</legend>
        <div className="flex flex-wrap gap-1.5">
          {CONSOLE_CANVAS_TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              aria-pressed={draft.tag === tag}
              onClick={() => set('tag')(tag)}
              className={`inline-flex min-h-touch items-center gap-1.5 rounded-pill border px-3 text-xs font-bold ${FOCUS} ${
                draft.tag === tag
                  ? 'border-fg bg-surface-raised text-fg'
                  : 'border-default text-muted'
              }`}
            >
              <span aria-hidden="true" className={`size-2.5 rounded-pill ${TAG_TONE[tag].dot}`} />
              {TAG_WORDS[tag][lang]}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1 text-xs font-bold text-muted" htmlFor={`${id}-block`}>
        {w.fBlock}
        <select
          id={`${id}-block`}
          value={draft.block}
          onChange={(e) => set('block')(e.target.value)}
          className={`${FIELD} min-h-touch`}
        >
          {CONSOLE_CANVAS_BLOCKS.map((block) => (
            <option key={block} value={block}>
              {blockName(block, lang)}
            </option>
          ))}
        </select>
      </label>
      <p role="status" aria-live="polite" className="text-xs text-danger empty:hidden">
        {error}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <button type="submit" className={PRIMARY} disabled={pending}>
            {w.save}
          </button>
          <button type="button" className={SECONDARY} onClick={onCancel} disabled={pending}>
            {w.cancel}
          </button>
        </div>
        <span className="text-xs text-caption" dir="ltr">
          {w.keys}
        </span>
      </div>
    </form>
  );
}

// --- The block's add, the bin's restore, the download and print -------------------

const EMPTY = { text_fa: '', text_en: '', note_fa: '', note_en: '', source: '' };

/** A block's «افزودن کارت»: the editor, empty, with the block chosen; a new card is an assumption. */
export function NewCard({ block, lang }: { block: ConsoleCanvasBlock; lang: CanvasLang }) {
  const [open, setOpen] = useState(false);
  const w = CANVAS_WORDS[lang];
  if (open)
    return (
      <CardEditor
        lang={lang}
        initial={{ ...EMPTY, block, tag: 'assumption' }}
        onCancel={() => setOpen(false)}
        onSave={(fields) => createCanvasCard({ block, tag: 'assumption', ...fields })}
        onSaved={() => setOpen(false)}
      />
    );
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      data-print="hide"
      className={`inline-flex min-h-touch items-center gap-1.5 self-start rounded-control border border-dashed border-strong px-3 text-sm font-bold text-muted hover:text-fg ${FOCUS}`}
    >
      <Icon name="plus" />
      {w.add}
    </button>
  );
}

/** Brings a removed card back to its place. */
export function RestoreButton({ id, lang }: { id: string; lang: CanvasLang }) {
  const w = CANVAS_WORDS[lang];
  const toast = useContext(ToastContext);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="flex flex-col items-start gap-1">
      <button
        type="button"
        className={SECONDARY}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await restoreCanvasCard(id);
            if (result.ok) toast({ words: w.restored });
            else setError(result.error);
          })
        }
      >
        {w.restore}
      </button>
      <span role="status" aria-live="polite" className="text-xs text-danger empty:hidden">
        {error}
      </span>
    </span>
  );
}

/** The live cards as a JSON file, made in the browser from what the page already has. */
export function JsonDownload({ cards, lang }: { cards: ConsoleCanvasCard[]; lang: CanvasLang }) {
  const w = CANVAS_WORDS[lang];
  return (
    <button
      type="button"
      className={SECONDARY}
      title={w.jsonTitle}
      onClick={() => {
        const now = new Date();
        const blob = new Blob([canvasJson(cards, now.toISOString())], {
          type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const link = Object.assign(globalThis.document.createElement('a'), {
          href: url,
          download: `stadiomind-canvas-${now.toISOString().slice(0, 10)}.json`,
        });
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}
    >
      {w.json}
    </button>
  );
}

/** The browser's own print, or save as PDF; `canvas.css` lays the sheet on one A3 page. */
export function PrintButton({ lang }: { lang: CanvasLang }) {
  return (
    <button type="button" className={SECONDARY} onClick={() => globalThis.print()}>
      {CANVAS_WORDS[lang].print}
    </button>
  );
}
