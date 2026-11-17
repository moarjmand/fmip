import type { Metadata } from 'next';
import type { ConsoleCanvasKey, ConsoleCanvasTag } from '@fmip/contracts';
import { CONSOLE_CANVAS_KEYS, CONSOLE_CANVAS_TAGS } from '@fmip/contracts/console';
import { ConsoleLink as Link } from '@/app/console/console-link';
import { consoleCanvas } from '@/lib/console-api';
import { CanvasBin, CanvasBoard, CanvasHistory } from '../../canvas';
import { CanvasTabKeys, CanvasToasts, JsonDownload, PrintButton } from '../../canvas-card';
import {
  type CanvasLang,
  CANVAS_NAMES,
  CANVAS_WORDS,
  TAG_TONE,
  TAG_WORDS,
  num,
  tagCounts,
} from '../../canvas-words';
import '../../canvas.css';

export const metadata: Metadata = { title: 'بوم کسب‌وکار' };

type Param = string | string[] | undefined;
type Props = { searchParams: Promise<{ canvas?: Param; lang?: Param; tag?: Param }> };

const one = (value: Param): string | undefined => (Array.isArray(value) ? value[0] : value);

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
/** Compact on a wide screen without a touch pointer; any touch keeps the 44 px target (T-1872). */
const COMPACT = 'lg:min-h-8 lg:any-pointer-coarse:min-h-touch';
const CHIP = `inline-flex min-h-touch items-center gap-1.5 whitespace-nowrap rounded-pill border px-3 text-sm ${COMPACT} ${FOCUS}`;
const CHIP_ON = 'border-accent bg-surface-raised font-bold text-fg';
const CHIP_OFF = 'border-default bg-surface text-muted hover:text-fg';
const BUTTON = `inline-flex min-h-touch items-center justify-center whitespace-nowrap rounded-control border border-strong bg-surface px-3 text-sm text-fg hover:bg-surface-raised lg:min-h-9 lg:any-pointer-coarse:min-h-touch ${FOCUS}`;
const TAB = `inline-flex min-h-touch items-center whitespace-nowrap rounded-pill border px-4 text-sm font-bold lg:min-h-9 lg:any-pointer-coarse:min-h-touch ${FOCUS}`;
const TAB_ON = 'border-fg bg-fg text-canvas';
const TAB_OFF = 'border-default bg-surface text-muted hover:border-strong hover:text-fg';

/**
 * The business model canvas (T-1856, D-441): the nine blocks in the classic
 * layout (`canvas.css`), every card in Persian by default and in English
 * with `?lang=en` (D-441's exception to D-352: only this page's own
 * container turns English and left to right; the console's frame stays
 * Persian), tag filters with counts (`?tag=`), the bin and the canvas's
 * history, a JSON download and a print layout. Server-rendered; the card
 * controls are the one client part (`canvas-card.tsx`).
 *
 * Two canvases as two tabs (T-1872, D-448): Claude's (the seed, the default,
 * so every old link opens it) and the teammate's (`?canvas=teammate`, empty
 * at first, filled by the teammate), each with its own cards, filters, bin,
 * history, JSON and print. The tabs are links, so the URL keeps the tab; a
 * tab keeps the language and drops the tag filter.
 */
export default async function ConsoleCanvasPage({ searchParams }: Props) {
  const params = await searchParams;
  const lang: CanvasLang = one(params.lang) === 'en' ? 'en' : 'fa';
  const rawCanvas = one(params.canvas);
  const canvas: ConsoleCanvasKey = (CONSOLE_CANVAS_KEYS as readonly unknown[]).includes(rawCanvas)
    ? (rawCanvas as ConsoleCanvasKey)
    : 'claude';
  const rawTag = one(params.tag);
  const tag = (CONSOLE_CANVAS_TAGS as readonly unknown[]).includes(rawTag)
    ? (rawTag as ConsoleCanvasTag)
    : undefined;
  const w = CANVAS_WORDS[lang];
  const english = lang === 'en' ? ({ lang: 'en', dir: 'ltr' } as const) : {};

  const href = (next: { lang?: CanvasLang; tag?: ConsoleCanvasTag; canvas?: ConsoleCanvasKey }) => {
    const query = new URLSearchParams();
    if ((next.canvas ?? canvas) === 'teammate') query.set('canvas', 'teammate');
    if ((next.lang ?? lang) === 'en') query.set('lang', 'en');
    if (next.tag !== undefined) query.set('tag', next.tag);
    const q = query.toString();
    return `/canvas${q === '' ? '' : `?${q}`}`;
  };

  const tabs = (
    <div data-print="hide" className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none]">
      <CanvasTabKeys label={w.tabs}>
        {CONSOLE_CANVAS_KEYS.map((key) => (
          <Link
            key={key}
            href={href({ canvas: key })}
            role="tab"
            id={`canvas-tab-${key}`}
            aria-selected={key === canvas}
            // The panel shows the chosen canvas only; the other tab opens its own page.
            aria-controls={key === canvas ? 'canvas-panel' : undefined}
            tabIndex={key === canvas ? 0 : -1}
            className={`${TAB} ${key === canvas ? TAB_ON : TAB_OFF}`}
            data-testid="canvas-tab"
          >
            {CANVAS_NAMES[key][lang]}
          </Link>
        ))}
      </CanvasTabKeys>
    </div>
  );

  // One line on a wide screen: the title, the two tabs, the language.
  const head = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <h1 className="text-xl font-bold">{w.title}</h1>
      {tabs}
      <Link
        href={href({ lang: lang === 'fa' ? 'en' : 'fa', tag })}
        lang={lang === 'fa' ? 'en' : 'fa'}
        dir={lang === 'fa' ? 'ltr' : 'rtl'}
        title={w.otherTitle}
        className={`${BUTTON} ms-auto`}
        data-print="hide"
        data-testid="canvas-lang"
      >
        {w.other}
      </Link>
    </div>
  );
  const result = await consoleCanvas(canvas);
  if (!result.ok) {
    return (
      <div className="canvas-page flex flex-col gap-3" {...english}>
        {head}
        <p
          id="canvas-panel"
          role="tabpanel"
          aria-labelledby={`canvas-tab-${canvas}`}
          className="text-sm text-danger"
        >
          <span role="alert">{w.readError}</span>
        </p>
      </div>
    );
  }
  const { cards, removed, history } = result.data;
  const counts = tagCounts(cards);
  const shown = tag === undefined ? cards.length : counts[tag];

  return (
    <div className="canvas-page flex flex-col gap-3" {...english} data-testid="canvas-page">
      <CanvasToasts lang={lang} canvas={canvas}>
        {head}
        {/*
         * Keyed by the canvas: a tab is the same route with another
         * `?canvas=`, and React keeps the client state of a page whose search
         * changes, so without the key an open «افزودن کارت» draft would stay
         * and save to the other canvas.
         */}
        <div
          key={canvas}
          id="canvas-panel"
          role="tabpanel"
          aria-labelledby={`canvas-tab-${canvas}`}
          className="flex flex-col gap-3"
          data-canvas={canvas}
        >
          <p className="max-w-measure text-sm text-muted" data-print="hide">
            {canvas === 'claude' ? w.lede : w.ledeTeammate}
          </p>

          {/* One line on a wide screen: the tag filters, then the download and print. */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <nav
              aria-label={w.tags}
              className="-mx-1 min-w-0 overflow-x-auto px-1 [scrollbar-width:none]"
              data-print="hide"
            >
              <ul className="flex gap-1.5">
                <li>
                  <Link
                    href={href({})}
                    aria-current={tag === undefined ? 'page' : undefined}
                    className={`${CHIP} ${tag === undefined ? CHIP_ON : CHIP_OFF}`}
                  >
                    {w.all}
                    <span className="text-xs">{num(cards.length, lang)}</span>
                  </Link>
                </li>
                {CONSOLE_CANVAS_TAGS.map((t) => (
                  <li key={t}>
                    <Link
                      href={href({ tag: t })}
                      aria-current={tag === t ? 'page' : undefined}
                      className={`${CHIP} ${tag === t ? CHIP_ON : CHIP_OFF}`}
                      data-testid="canvas-tag-filter"
                    >
                      <span
                        aria-hidden="true"
                        className={`size-2.5 rounded-pill ${TAG_TONE[t].dot}`}
                      />
                      {TAG_WORDS[t][lang]}
                      <span className="text-xs">{num(counts[t], lang)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="flex flex-wrap items-center gap-2" data-print="hide">
              <JsonDownload cards={cards} lang={lang} />
              <PrintButton lang={lang} />
            </div>
          </div>
          {tag !== undefined && (
            <p className="text-sm text-muted" role="status" data-print="hide">
              {w.filtered(num(shown, lang), num(cards.length, lang))}{' '}
              <Link href={href({})} className={`font-bold text-brand underline ${FOCUS}`}>
                {w.clear}
              </Link>
            </p>
          )}
          {cards.length === 0 && (
            <p
              className="max-w-measure rounded-tile border border-dashed border-strong bg-surface px-3 py-2 text-sm text-muted"
              data-print="hide"
              data-testid="canvas-empty"
            >
              {w.emptyCanvas}
            </p>
          )}

          <CanvasBoard cards={cards} lang={lang} tag={tag} canvas={canvas} />
          {canvas === 'claude' && (
            <p className="max-w-measure text-xs text-caption" data-print="hide">
              {w.foot}
            </p>
          )}

          <div className="grid gap-3 lg:grid-cols-2">
            <CanvasBin removed={removed} lang={lang} />
            <CanvasHistory history={history} lang={lang} canvas={canvas} />
          </div>
        </div>
      </CanvasToasts>
    </div>
  );
}
