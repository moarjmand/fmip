import type { ConsoleCanvasCard, ConsoleCanvasEvent, ConsoleCanvasTag } from '@fmip/contracts';
import { CONSOLE_CANVAS_BLOCKS } from '@fmip/contracts/console';
import { CanvasCard, NewCard, RestoreButton } from './canvas-card';
import {
  BLOCK_WORDS,
  type CanvasLang,
  CANVAS_WORDS,
  TAG_TONE,
  TAG_WORDS,
  at,
  blockName,
  cardLabel,
  cardText,
  cut,
  fieldLang,
  historyWords,
  num,
} from './canvas-words';

/**
 * The business model canvas's server-drawn pieces (T-1856, D-441): the sheet
 * with its nine numbered cells and their cards (`canvas.css` lays them out),
 * the bin of removed cards with their restore, and the canvas's history.
 */

/**
 * The sheet: a head line, then the nine cells, each with its number in the
 * fill order, its name, its guiding question, its cards (only the chosen
 * tag's when filtered) and its add button.
 */
export function CanvasBoard({
  cards,
  lang,
  tag,
}: {
  cards: readonly ConsoleCanvasCard[];
  lang: CanvasLang;
  tag: ConsoleCanvasTag | undefined;
}) {
  const w = CANVAS_WORDS[lang];
  return (
    <div className="canvas-sheet overflow-hidden rounded-card border border-strong bg-surface">
      <p className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-b border-strong px-4 py-2 text-xs text-caption">
        <span>{w.sheetHead}</span>
        <span>{w.sheetOrder}</span>
      </p>
      <div className="canvas-board">
        {CONSOLE_CANVAS_BLOCKS.map((block) => {
          const meta = BLOCK_WORDS[block];
          const all = cards.filter((c) => c.block === block);
          const shown = tag === undefined ? all : all.filter((c) => c.tag === tag);
          const headingId = `canvas-${block}`;
          return (
            <section
              key={block}
              aria-labelledby={headingId}
              data-area={meta.area}
              data-testid="canvas-block"
              className="canvas-block flex min-h-44 min-w-0 flex-col gap-2.5 bg-surface p-3"
            >
              <div className="flex items-start gap-2">
                <span
                  className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-pill border border-strong px-1.5 text-xs font-bold text-muted"
                  aria-label={lang === 'fa' ? `خانه‌ی ${num(meta.n, lang)}` : `Cell ${meta.n}`}
                >
                  {num(meta.n, lang)}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 id={headingId} className="text-sm font-bold leading-6 text-fg">
                    {blockName(block, lang)}
                  </h2>
                  <p className="text-xs leading-5 text-caption">
                    {lang === 'fa' ? meta.qfa : meta.qen}
                  </p>
                </div>
              </div>
              {shown.length === 0 ? (
                <p className="text-xs text-caption">
                  {tag === undefined ? w.emptyBlock : w.emptyFiltered}
                </p>
              ) : (
                <ol className="canvas-cards flex flex-col gap-2">
                  {shown.map((card) => {
                    const place = all.findIndex((c) => c.id === card.id);
                    return (
                      <CanvasCard
                        key={`${card.id}-${card.last_change?.at ?? 'seed'}`}
                        card={card}
                        lang={lang}
                        first={place === 0}
                        last={place === all.length - 1}
                      />
                    );
                  })}
                </ol>
              )}
              <NewCard block={block} lang={lang} />
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** Removed cards, the newest removal first, each with who removed it and its restore. */
export function CanvasBin({
  removed,
  lang,
}: {
  removed: readonly ConsoleCanvasCard[];
  lang: CanvasLang;
}) {
  const w = CANVAS_WORDS[lang];
  return (
    <section
      aria-labelledby="canvas-bin"
      className="flex flex-col gap-3 rounded-card border border-default bg-surface p-4"
      data-print="hide"
      data-testid="canvas-bin"
    >
      <div>
        <h2 id="canvas-bin" className="text-base font-bold text-fg">
          {w.bin}
          {removed.length > 0 && (
            <span className="ms-2 text-sm font-normal text-muted">{num(removed.length, lang)}</span>
          )}
        </h2>
        <p className="text-xs text-caption">{w.binNote}</p>
      </div>
      {removed.length === 0 ? (
        <p className="text-sm text-caption">{w.binEmpty}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {removed.map((card) => {
            const shown = cardText(card, lang);
            return (
              <li
                key={card.id}
                className={`flex flex-wrap items-start justify-between gap-2 rounded-tile border p-2.5 ${TAG_TONE[card.tag].card}`}
                data-testid="canvas-removed"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="text-xs text-muted">
                    {blockName(card.block, lang)} · {TAG_WORDS[card.tag][lang]}
                  </p>
                  <p
                    className="text-sm font-semibold leading-6 text-fg"
                    lang={shown.textLang}
                    dir={shown.textLang === 'fa' ? 'rtl' : 'ltr'}
                  >
                    {shown.text}
                  </p>
                  {card.removed_at !== null && (
                    <p className="text-xs text-caption">
                      {w.removedBy} <span dir="auto">{card.removed_by ?? '—'}</span> ·{' '}
                      {at(card.removed_at, lang)}
                    </p>
                  )}
                </div>
                <RestoreButton id={card.id} lang={lang} />
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** The canvas's newest changes, newest first: who, what, on which card, when. */
export function CanvasHistory({
  history,
  lang,
}: {
  history: readonly ConsoleCanvasEvent[];
  lang: CanvasLang;
}) {
  const w = CANVAS_WORDS[lang];
  return (
    <section
      aria-labelledby="canvas-history"
      className="flex flex-col gap-3 rounded-card border border-default bg-surface p-4"
      data-print="hide"
      data-testid="canvas-history"
    >
      <div>
        <h2 id="canvas-history" className="text-base font-bold text-fg">
          {w.history}
        </h2>
        <p className="text-xs text-caption">{w.historyNote}</p>
      </div>
      {history.length === 0 ? (
        <p className="text-sm text-caption">{w.historyEmpty}</p>
      ) : (
        <ol className="flex max-h-[32rem] flex-col gap-2 overflow-y-auto border-s-2 border-default ps-3">
          {history.map((event) => {
            const label = cardLabel(event, lang);
            const valueLang = fieldLang(event.field);
            return (
              <li key={event.id} className="text-sm leading-6" data-testid="canvas-event">
                <span className="font-bold" dir="auto">
                  {event.actor}
                </span>{' '}
                <span className="text-muted">{historyWords(event, lang)}</span>
                {lang === 'fa' ? '؛ ' : ': '}
                <span
                  className="text-fg"
                  lang={label.lang}
                  dir={label.lang === 'fa' ? 'rtl' : 'ltr'}
                >
                  {label.text}
                </span>
                {event.kind === 'edited' && event.next !== null && (
                  <span
                    className="block text-xs text-muted"
                    lang={valueLang}
                    dir={valueLang === 'fa' ? 'rtl' : 'ltr'}
                  >
                    {event.next === '' ? '—' : cut(event.next, 120)}
                  </span>
                )}
                <span className="block text-xs text-caption">{at(event.created_at, lang)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
