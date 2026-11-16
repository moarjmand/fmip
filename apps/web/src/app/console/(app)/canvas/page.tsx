import type { Metadata } from 'next';
import type { ConsoleCanvasTag } from '@fmip/contracts';
import { CONSOLE_CANVAS_TAGS } from '@fmip/contracts/console';
import { ConsoleLink as Link } from '@/app/console/console-link';
import { consoleCanvas } from '@/lib/console-api';
import { CanvasBin, CanvasBoard, CanvasHistory } from '../../canvas';
import { CanvasToasts, JsonDownload, PrintButton } from '../../canvas-card';
import {
  type CanvasLang,
  CANVAS_WORDS,
  TAG_TONE,
  TAG_WORDS,
  num,
  tagCounts,
} from '../../canvas-words';
import '../../canvas.css';

export const metadata: Metadata = { title: 'بوم کسب‌وکار' };

type Param = string | string[] | undefined;
type Props = { searchParams: Promise<{ lang?: Param; tag?: Param }> };

const one = (value: Param): string | undefined => (Array.isArray(value) ? value[0] : value);

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
const CHIP = `inline-flex min-h-touch items-center gap-1.5 whitespace-nowrap rounded-pill border px-3 text-sm ${FOCUS}`;
const CHIP_ON = 'border-accent bg-surface-raised font-bold text-fg';
const CHIP_OFF = 'border-default bg-surface text-muted hover:text-fg';
const BUTTON = `inline-flex min-h-touch items-center justify-center whitespace-nowrap rounded-control border border-strong bg-surface px-3 text-sm text-fg hover:bg-surface-raised ${FOCUS}`;

/**
 * The business model canvas (T-1855, D-440): the nine blocks in the classic
 * layout (`canvas.css`), every card in Persian by default and in English
 * with `?lang=en` (D-440's exception to D-352: only this page's own
 * container turns English and left to right; the console's frame stays
 * Persian), tag filters with counts (`?tag=`), the bin and the canvas's
 * history, a JSON download and a print layout. Server-rendered; the card
 * controls are the one client part (`canvas-card.tsx`).
 */
export default async function ConsoleCanvasPage({ searchParams }: Props) {
  const params = await searchParams;
  const lang: CanvasLang = one(params.lang) === 'en' ? 'en' : 'fa';
  const rawTag = one(params.tag);
  const tag = (CONSOLE_CANVAS_TAGS as readonly unknown[]).includes(rawTag)
    ? (rawTag as ConsoleCanvasTag)
    : undefined;
  const w = CANVAS_WORDS[lang];
  const english = lang === 'en' ? ({ lang: 'en', dir: 'ltr' } as const) : {};

  const href = (next: { lang?: CanvasLang; tag?: ConsoleCanvasTag }) => {
    const query = new URLSearchParams();
    if ((next.lang ?? lang) === 'en') query.set('lang', 'en');
    if (next.tag !== undefined) query.set('tag', next.tag);
    const q = query.toString();
    return `/canvas${q === '' ? '' : `?${q}`}`;
  };

  const result = await consoleCanvas();
  if (!result.ok) {
    return (
      <div className="canvas-page flex flex-col gap-3" {...english}>
        <h1 className="text-xl font-bold">{w.title}</h1>
        <p className="text-sm text-danger" role="alert">
          {w.readError}
        </p>
      </div>
    );
  }
  const { cards, removed, history } = result.data;
  const counts = tagCounts(cards);
  const shown = tag === undefined ? cards.length : counts[tag];

  return (
    <div className="canvas-page flex flex-col gap-4" {...english} data-testid="canvas-page">
      <CanvasToasts lang={lang}>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-xl font-bold">{w.title}</h1>
            <p className="max-w-measure text-sm text-muted" data-print="hide">
              {w.lede}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2" data-print="hide">
            <Link
              href={href({ lang: lang === 'fa' ? 'en' : 'fa', tag })}
              lang={lang === 'fa' ? 'en' : 'fa'}
              dir={lang === 'fa' ? 'ltr' : 'rtl'}
              title={w.otherTitle}
              className={BUTTON}
              data-testid="canvas-lang"
            >
              {w.other}
            </Link>
            <JsonDownload cards={cards} lang={lang} />
            <PrintButton lang={lang} />
          </div>
        </div>

        <nav
          aria-label={w.tags}
          className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none]"
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
                  <span aria-hidden="true" className={`size-2.5 rounded-pill ${TAG_TONE[t].dot}`} />
                  {TAG_WORDS[t][lang]}
                  <span className="text-xs">{num(counts[t], lang)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {tag !== undefined && (
          <p className="text-sm text-muted" role="status" data-print="hide">
            {w.filtered(num(shown, lang), num(cards.length, lang))}{' '}
            <Link href={href({})} className={`font-bold text-brand underline ${FOCUS}`}>
              {w.clear}
            </Link>
          </p>
        )}

        <CanvasBoard cards={cards} lang={lang} tag={tag} />
        <p className="max-w-measure text-xs text-caption" data-print="hide">
          {w.foot}
        </p>

        <div className="grid gap-4 lg:grid-cols-2">
          <CanvasBin removed={removed} lang={lang} />
          <CanvasHistory history={history} lang={lang} />
        </div>
      </CanvasToasts>
    </div>
  );
}
