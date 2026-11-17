import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ReactElement, type ReactNode, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CANVAS, ENGLISH_ONLY, PARTNER, REMOVED, SEGMENT, TEAMMATE_EMPTY } from './canvas.fixture';
import { CanvasToasts, CardEditor, canvasActions, tabKey, useCanvasKey } from './canvas-card';
import { canvasJson, cardText, historyWords, tagCounts } from './canvas-words';

/**
 * The business model canvas's page (T-1856, D-441): the nine cells in the
 * fill order with their numbers and guiding questions, the classic layout
 * and the print sheet, cards tinted by tag with their controls and who
 * changed them, the tag filters with counts, the bin with restore, the
 * history newest first in words, the English view on the page's own
 * container, the editor with both languages, the JSON download, and
 * logical CSS only (rule 7). T-1872 (D-448): the two canvases as two tabs
 * (an accessible tab list, the URL keeping the tab and the language), the
 * teammate's starting empty with a hint, and the compact sizes that keep the
 * 44 px target on any touch screen.
 */

const state = vi.hoisted(() => ({
  answer: null as unknown,
  asked: [] as unknown[],
  calls: [] as unknown[][],
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock('@/app/console/console-link', () => ({
  ConsoleLink: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/console-actions', () => {
  // Each action records what it was called with (T-1872: the canvas first).
  const done =
    (name: string) =>
    async (...args: unknown[]) => {
      state.calls.push([name, ...args]);
      return { ok: true, error: null, id: null };
    };
  return {
    createCanvasCard: done('create'),
    updateCanvasCard: done('update'),
    moveCanvasCard: done('move'),
    removeCanvasCard: done('remove'),
    restoreCanvasCard: done('restore'),
  };
});
vi.mock('@/lib/console-api', () => ({
  consoleCanvas: (canvas: unknown) => {
    state.asked.push(canvas);
    return Promise.resolve(state.answer);
  },
}));
// The page imports its stylesheet; the test reads it as a file instead.
vi.mock('./canvas.css', () => ({}));

const params = (p: Record<string, string>) => Promise.resolve(p);
const page = async (p: Record<string, string> = {}) =>
  renderToStaticMarkup(
    await (await import('./(app)/canvas/page')).default({ searchParams: params(p) }),
  );
const count = (html: string, needle: string) => html.split(needle).length - 1;

beforeEach(() => {
  state.answer = { ok: true, status: 200, data: CANVAS, setCookie: null };
  state.asked = [];
  state.calls = [];
});

describe('the layout', () => {
  it('draws the nine cells in the fill order, numbered, each with its question', async () => {
    const html = await page();
    expect(count(html, 'data-testid="canvas-block"')).toBe(9);
    const areas = [...html.matchAll(/data-area="(\w+)"/g)].map((m) => m[1]);
    expect(areas).toEqual(['cs', 'vp', 'ch', 'cr', 'rev', 'kr', 'ka', 'kp', 'cost']);
    const titles = [...html.matchAll(/<h2 id="canvas-(?!bin|history)\w+"[^>]*>([^<]+)<\/h2>/g)].map(
      (m) => m[1],
    );
    expect(titles).toEqual([
      'بخش‌های مشتری',
      'ارزش پیشنهادی',
      'کانال‌ها',
      'ارتباط با مشتری',
      'جریان‌های درآمد',
      'منابع کلیدی',
      'فعالیت‌های کلیدی',
      'شرکای کلیدی',
      'ساختار هزینه',
    ]);
    expect(html).toContain('aria-label="خانه‌ی ۱"');
    expect(html).toContain('aria-label="خانه‌ی ۹"');
    expect(html).toContain('برای چه کسانی می‌سازیم؟');
    expect(html).toContain('پول کجا خرج می‌شود؟');
    expect(html).toContain('هنوز کارتی نیست.');
  });

  it('lays the classic canvas from 1180px, two columns from 720px, and one A3 landscape page in print', () => {
    const css = readFileSync(join(__dirname, 'canvas.css'), 'utf8');
    expect(css).toContain("grid-template-areas: 'cs' 'vp' 'ch' 'cr' 'rev' 'kr' 'ka' 'kp' 'cost';");
    expect(css).toMatch(
      /@media \(width >= 720px\)[\s\S]*'cs vp' 'ch cr' 'rev rev' 'kr ka' 'kp cost'/,
    );
    expect(css).toMatch(
      /@media \(width >= 1180px\)[\s\S]*'kp kp ka ka vp vp cr cr cs cs'[\s\S]*'cost cost cost cost cost rev rev rev rev rev'/,
    );
    expect(css).toMatch(/@page canvas \{\s*size: A3 landscape;/);
    expect(css).toMatch(/@media print \{[\s\S]*\[data-print='hide'\][\s\S]*display: none/);
  });

  it('tints each card by its tag and hides the controls in print', async () => {
    const html = await page();
    expect(count(html, 'data-testid="canvas-card"')).toBe(5);
    expect(html).toMatch(
      /border-rating-good bg-rating-good\/10[^"]*" data-testid="canvas-card" data-tag="validated"/,
    );
    expect(html).toMatch(
      /border-danger\/40 bg-danger\/10[^"]*" data-testid="canvas-card" data-tag="risk"/,
    );
    expect(html).toMatch(
      /border-dashed border-strong bg-surface[^"]*" data-testid="canvas-card" data-tag="question"/,
    );
    expect(html).toMatch(/aria-label="کارهای کارت" data-print="hide"/);
    expect(html).toContain('چاپ / ذخیره به PDF');
    expect(html).toContain('دریافت JSON');
  });
});

describe('a card', () => {
  it('shows its text, note and source, and who changed it last or the first fill', async () => {
    const html = await page();
    expect(html).toContain(SEGMENT.text_fa);
    expect(html).toContain(SEGMENT.note_fa);
    expect(html).toMatch(/dir="ltr">ops\/reports\/marketing-manager\/2026-11-09\.md \(Audience\)</);
    expect(html).toContain('پرکردن اولیه');
    expect(html).toContain('>مصطفی</span> · ');
  });

  it('shows the other language with a marker when the shown one is missing', async () => {
    const html = await page();
    expect(html).toContain('<span lang="en" dir="ltr">Club analysts who want shot maps</span>');
    expect(html).toMatch(
      /<abbr lang="en" dir="ltr" title="فقط به انگلیسی نوشته شده"[^>]*>EN<\/abbr>/,
    );
    expect(count(html, '>EN</abbr>')).toBe(1);
    expect(cardText(ENGLISH_ONLY, 'en')).toMatchObject({ textLang: 'en', noteLang: 'en' });
    expect(cardText({ ...PARTNER, text_en: '', note_en: '' }, 'en')).toMatchObject({
      text: PARTNER.text_fa,
      textLang: 'fa',
      noteLang: 'fa',
    });
  });

  it('has its controls, with up off for the first in its block and down off for the last', async () => {
    const html = await page();
    for (const label of ['ویرایش', 'بالاتر', 'پایین‌تر', 'حذف'])
      expect(count(html, `aria-label="${label}"`)).toBe(5);
    // Partners: the validated card is first, the risk card last.
    const partner = html.slice(html.indexOf('data-tag="validated"'));
    expect(partner).toMatch(/aria-label="بالاتر" title="بالاتر" disabled=""/);
    const risk = html.slice(html.indexOf('data-tag="risk"'));
    expect(risk).toMatch(/aria-label="پایین‌تر" title="پایین‌تر" disabled=""/);
  });
});

describe('the editor', () => {
  it('edits both languages, the source, the tag and the block in place', () => {
    const html = renderToStaticMarkup(
      <CardEditor
        lang="fa"
        initial={PARTNER}
        onCancel={() => undefined}
        onSave={async () => ({ ok: true, error: null, id: PARTNER.id })}
        onSaved={() => undefined}
      />,
    );
    expect(html).toMatch(/متن فارسی<textarea[^>]*dir="rtl" lang="fa"/);
    expect(html).toMatch(/متن انگلیسی<textarea[^>]*dir="ltr" lang="en"/);
    expect(html).toContain('یادداشت فارسی');
    expect(html).toContain('یادداشت انگلیسی');
    expect(html).toContain(PARTNER.text_en);
    expect(html).toMatch(/aria-pressed="true"[^>]*>.*تأییدشده/);
    expect(count(html, '<option ')).toBe(9);
    expect(html).toContain('<option value="key_partners" selected="">شرکای کلیدی</option>');
    expect(html).toContain('ذخیره');
    expect(html).toContain('Ctrl+Enter');
  });
});

describe('the tag filters', () => {
  it('counts the live cards by tag', async () => {
    expect(tagCounts(CANVAS.cards)).toEqual({ validated: 1, assumption: 1, risk: 1, question: 2 });
    const html = await page();
    expect(count(html, 'data-testid="canvas-tag-filter"')).toBe(4);
    expect(html).toMatch(/aria-current="page"[^>]*>همه<span class="text-xs">۵<\/span>/);
    expect(html).toContain('href="/canvas?tag=risk"');
  });

  it('shows only the chosen tag’s cards and keeps the language in the links', async () => {
    const html = await page({ tag: 'question', lang: 'en' });
    expect(count(html, 'data-testid="canvas-card"')).toBe(2);
    expect(html).toContain('2 of 5 cards with this tag.');
    expect(html).toContain('No cards with this tag.');
    expect(html).toContain('href="/canvas?lang=en&amp;tag=risk"');
    expect(html).toContain('href="/canvas?lang=en"');
  });

  it('ignores a tag it does not know rather than hide everything', async () => {
    const html = await page({ tag: 'maybe', lang: 'de' });
    expect(count(html, 'data-testid="canvas-card"')).toBe(5);
    expect(html).not.toContain('lang="en" dir="ltr" data-testid="canvas-page"');
  });
});

describe('the bin and the history', () => {
  it('lists removed cards with who removed them and a restore', async () => {
    const html = await page();
    const bin = html.slice(html.indexOf('data-testid="canvas-bin"'));
    expect(bin).toContain(REMOVED.text_fa);
    expect(bin).toContain('حذف به دست <span dir="auto">مصطفی</span>');
    expect(bin).toContain('>بازگرداندن</button>');
  });

  it('says every change in words, newest first, with its card', async () => {
    const html = await page();
    const events = [...html.matchAll(/data-testid="canvas-event"/g)];
    expect(events).toHaveLength(CANVAS.history.length);
    expect(html.indexOf('کارت را از سطل برگرداند')).toBeLessThan(html.indexOf('کارت را افزود'));
    expect(CANVAS.history.map((e) => historyWords(e, 'fa'))).toEqual([
      'کارت را از سطل برگرداند',
      'کارت را به سطل برد',
      'جای کارت را از ۲ به ۱ برد',
      'کارت را از «بخش‌های مشتری» به «کانال‌ها» برد',
      'برچسب را از «فرض» به «تأییدشده» تغییر داد',
      'یادداشت فارسی را ویرایش کرد',
      'متن انگلیسی را ویرایش کرد',
      'کارت را افزود',
    ]);
    expect(CANVAS.history.map((e) => historyWords(e, 'en'))).toEqual([
      'restored the card from the bin',
      'moved the card to the bin',
      'moved the card from place 2 to 1',
      'moved the card from Customer segments to Channels',
      'changed the tag from Assumption to Validated',
      'edited the Persian note',
      'edited the English text',
      'added the card',
    ]);
    // An English edit's new value keeps its own direction in the Persian view.
    expect(html).toContain(
      '<span class="block text-xs text-muted" lang="en" dir="ltr">Club analysts who want shot maps</span>',
    );
  });

  it('says so when nothing is removed and nothing changed yet', async () => {
    state.answer = {
      ok: true,
      status: 200,
      data: { ...CANVAS, removed: [], history: [] },
      setCookie: null,
    };
    const html = await page();
    expect(html).toContain('چیزی حذف نشده.');
    expect(html).toContain('همه‌ی کارت‌ها از پرکردن اولیه‌اند');
  });
});

describe('the English view', () => {
  it('turns only the page’s own container English and left to right', async () => {
    const html = await page({ lang: 'en' });
    expect(html).toMatch(/^<div class="canvas-page flex flex-col gap-3" lang="en" dir="ltr"/);
    expect(html).toContain('<h1 class="text-xl font-bold">Business model canvas</h1>');
    expect(html).toContain('Who are we building for?');
    expect(html).toContain(SEGMENT.text_en);
    expect(html).toContain(PARTNER.note_en);
    expect(html).toContain('First fill');
    expect(html).toContain('Print / save as PDF');
    expect(html).toContain('History of the canvas');
    expect(html).not.toContain(SEGMENT.text_fa);
    // The way back to Persian is in Persian, right to left.
    expect(html).toMatch(/href="\/canvas" lang="fa" dir="rtl"[^>]*>فارسی</);
  });

  it('links the Persian view to the English one', async () => {
    const html = await page();
    expect(html).toMatch(/^<div class="canvas-page flex flex-col gap-3" data-testid="canvas-page"/);
    expect(html).toMatch(/href="\/canvas\?lang=en" lang="en" dir="ltr"[^>]*>English</);
  });
});

describe('the two canvases (T-1872)', () => {
  const tabs = (html: string) =>
    [...html.matchAll(/<a[^>]*role="tab"[^>]*>[^<]*<\/a>/g)].map((m) => m[0]);

  it('opens Claude’s canvas by default, as a tab list whose chosen tab controls the panel', async () => {
    const html = await page();
    expect(state.asked).toEqual(['claude']);
    expect(html).toMatch(/<div role="tablist" aria-label="دو بوم"/);
    const [claude, teammate] = tabs(html);
    expect(tabs(html)).toHaveLength(2);
    expect(claude).toContain('href="/canvas"');
    expect(claude).toContain('id="canvas-tab-claude"');
    expect(claude).toContain('aria-selected="true"');
    expect(claude).toContain('tabindex="0"');
    expect(claude).toContain('aria-controls="canvas-panel"');
    // The panel is the chosen canvas's; the other tab controls no panel here.
    expect(teammate).not.toContain('aria-controls');
    expect(claude).toContain('>بوم Claude</a>');
    expect(teammate).toContain('href="/canvas?canvas=teammate"');
    expect(teammate).toContain('aria-selected="false"');
    expect(teammate).toContain('tabindex="-1"');
    expect(teammate).toContain('>بوم هم‌تیمی</a>');
    expect(html).toMatch(/id="canvas-panel" role="tabpanel" aria-labelledby="canvas-tab-claude"/);
    // Claude's canvas keeps its seed's words and its foot.
    expect(html).toContain('پیش‌نویس زنده از وضعیت واقعی پروژه.');
    expect(html).toContain('این بوم مشاوره‌ی مالی یا حقوقی نیست.');
    expect(html).toContain('Stadiomind · بوم مدل کسب‌وکار · بوم Claude');
    expect(html).not.toContain('data-testid="canvas-empty"');
  });

  it('reads and writes the teammate’s canvas with ?canvas=teammate, empty at first with a hint', async () => {
    state.answer = { ok: true, status: 200, data: TEAMMATE_EMPTY, setCookie: null };
    const html = await page({ canvas: 'teammate' });
    expect(state.asked).toEqual(['teammate']);
    const [claude, teammate] = tabs(html);
    expect(claude).toContain('aria-selected="false"');
    expect(teammate).toContain('aria-selected="true"');
    expect(html).toMatch(/id="canvas-panel" role="tabpanel" aria-labelledby="canvas-tab-teammate"/);
    expect(html).toContain('data-canvas="teammate"');
    // The same nine blocks, each with its add button, and how to begin.
    expect(count(html, 'data-testid="canvas-block"')).toBe(9);
    expect(count(html, 'افزودن کارت')).toBeGreaterThanOrEqual(9);
    expect(count(html, 'data-testid="canvas-card"')).toBe(0);
    expect(html).toContain('data-testid="canvas-empty"');
    expect(html).toContain('این بوم هنوز خالی است.');
    expect(html).toContain('بومی که هم‌تیمی خودش پر می‌کند');
    expect(html).toContain('هنوز تغییری ثبت نشده.');
    expect(html).not.toContain('همه‌ی کارت‌ها از پرکردن اولیه‌اند');
    // Claude's foot and lede speak of Claude's cards only.
    expect(html).not.toContain('این بوم مشاوره‌ی مالی یا حقوقی نیست.');
    expect(html).not.toContain('پیش‌نویس زنده از وضعیت واقعی پروژه.');
    expect(html).toContain('Stadiomind · بوم مدل کسب‌وکار · بوم هم‌تیمی');
    // Every link on the tab keeps it: the filters and the language.
    expect(html).toContain('href="/canvas?canvas=teammate&amp;tag=risk"');
    expect(html).toMatch(/href="\/canvas\?canvas=teammate&amp;lang=en" lang="en" dir="ltr"/);
  });

  it('keeps the language on the tabs, drops the tag filter, and reads an unknown canvas as Claude’s', async () => {
    const english = await page({ lang: 'en', tag: 'risk' });
    const [claude, teammate] = tabs(english);
    expect(claude).toContain('href="/canvas?lang=en"');
    expect(claude).toContain('>Claude’s canvas</a>');
    expect(teammate).toContain('href="/canvas?canvas=teammate&amp;lang=en"');
    expect(teammate).toContain('>Teammate’s canvas</a>');
    expect(english).toMatch(/<div role="tablist" aria-label="The two canvases"/);
    await page({ canvas: 'mine' });
    expect(state.asked.at(-1)).toBe('claude');
  });

  it('downloads the teammate’s canvas named as such', () => {
    const json = JSON.parse(canvasJson([], '2026-11-17T12:00:00.000Z', 'teammate')) as Record<
      string,
      unknown
    >;
    expect(json).toMatchObject({
      canvas_key: 'teammate',
      canvas_name: 'Teammate’s canvas',
      cards: [],
    });
    expect(JSON.parse(canvasJson(CANVAS.cards, 'x'))).toMatchObject({ canvas_key: 'claude' });
  });
});

describe('the canvas each control writes to (T-1872)', () => {
  /** The element with this id in the page's tree, as React holds it before rendering. */
  const find = (node: unknown, id: string): ReactElement | null => {
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = find(child, id);
        if (found !== null) return found;
      }
      return null;
    }
    if (!isValidElement(node)) return null;
    const props = node.props as { id?: string; children?: unknown };
    if (props.id === id) return node;
    return find(props.children, id);
  };

  it('keys the panel by its canvas, so a tab change drops an open draft instead of saving it to the other canvas', async () => {
    const render = async (p: Record<string, string>) =>
      (await import('./(app)/canvas/page')).default({ searchParams: params(p) });
    const claude = find(await render({}), 'canvas-panel');
    state.answer = { ok: true, status: 200, data: TEAMMATE_EMPTY, setCookie: null };
    const teammate = find(await render({ canvas: 'teammate' }), 'canvas-panel');
    expect(claude?.key).toBe('claude');
    expect(teammate?.key).toBe('teammate');
  });

  it('hands the page’s canvas to the controls, Claude’s when none is given', () => {
    function Probe() {
      return <i>{useCanvasKey()}</i>;
    }
    expect(
      renderToStaticMarkup(
        <CanvasToasts lang="fa" canvas="teammate">
          <Probe />
        </CanvasToasts>,
      ),
    ).toContain('<i>teammate</i>');
    expect(
      renderToStaticMarkup(
        <CanvasToasts lang="fa">
          <Probe />
        </CanvasToasts>,
      ),
    ).toContain('<i>claude</i>');
  });

  it('sends that canvas first to every server action', async () => {
    const act = canvasActions('teammate');
    const id = SEGMENT.id;
    await act.create({ block: 'channels', text_fa: 'x' });
    await act.update(id, { tag: 'risk' });
    await act.move(id, 'up');
    await act.remove(id);
    await act.restore(id);
    await canvasActions('claude').move(id, 'down');
    expect(state.calls).toEqual([
      ['create', 'teammate', { block: 'channels', text_fa: 'x' }],
      ['update', 'teammate', id, { tag: 'risk' }],
      ['move', 'teammate', id, 'up'],
      ['remove', 'teammate', id],
      ['restore', 'teammate', id],
      ['move', 'claude', id, 'down'],
    ]);
  });

  it('calls the server actions only through the bound ones', () => {
    // Every control goes through `canvasActions(useCanvasKey())`, never an action by itself.
    const source = readFileSync(join(__dirname, 'canvas-card.tsx'), 'utf8');
    for (const action of [
      'createCanvasCard',
      'updateCanvasCard',
      'moveCanvasCard',
      'removeCanvasCard',
      'restoreCanvasCard',
    ])
      // A word boundary: `removeCanvasCard(` holds `moveCanvasCard(`.
      expect(source.match(new RegExp(`\\b${action}\\(`, 'g')), action).toHaveLength(1);
    expect(count(source, 'canvasActions(useCanvasKey())')).toBe(3);
  });
});

describe('the tab list’s keys (T-1872)', () => {
  it('moves by the arrows in the reading direction, wrapping, with Home and End', () => {
    // Persian, right to left: the left arrow is the next tab.
    expect(tabKey('ArrowLeft', 0, 2, true)).toBe(1);
    expect(tabKey('ArrowRight', 1, 2, true)).toBe(0);
    expect(tabKey('ArrowLeft', 1, 2, true)).toBe(0);
    // English, left to right.
    expect(tabKey('ArrowRight', 0, 2, false)).toBe(1);
    expect(tabKey('ArrowLeft', 0, 2, false)).toBe(1);
    expect(tabKey('Home', 1, 2, true)).toBe(0);
    expect(tabKey('End', 0, 2, false)).toBe(1);
  });

  it('opens the focused tab with Space, and leaves every other key alone', () => {
    expect(tabKey(' ', 1, 2, true)).toBe('open');
    expect(tabKey('Spacebar', 0, 2, false)).toBe('open');
    expect(tabKey('Enter', 0, 2, false)).toBeNull();
    expect(tabKey('Tab', 0, 2, false)).toBeNull();
    expect(tabKey('ArrowDown', 0, 2, false)).toBeNull();
    // Focus outside the tabs: nothing.
    expect(tabKey('ArrowLeft', -1, 2, true)).toBeNull();
  });
});

describe('compact (T-1872)', () => {
  it('shrinks the controls only on a wide screen with a fine pointer; touch keeps 44 px', async () => {
    const html = await page();
    // A card's controls: 44 px, 28 px from lg, 44 px again on any coarse pointer.
    expect(html).toContain(
      'min-h-touch min-w-touch items-center justify-center rounded-control text-muted hover:bg-surface hover:text-fg disabled:opacity-40 lg:min-h-7 lg:min-w-7 lg:any-pointer-coarse:min-h-touch lg:any-pointer-coarse:min-w-touch',
    );
    // Every tag chip, tab and button is 44 px below lg.
    for (const testid of ['canvas-tag-filter', 'canvas-tab', 'canvas-lang']) {
      const tag = new RegExp(`<a[^>]*data-testid="${testid}"[^>]*>`).exec(html)?.[0] ?? '';
      expect(tag, testid).toContain('min-h-touch');
      expect(tag, testid).toContain('lg:any-pointer-coarse:min-h-touch');
    }
    // Tighter cells and smaller card text.
    expect(html).toContain('canvas-block flex min-h-28 min-w-0 flex-col gap-1.5 bg-surface p-2');
    expect(html).toContain('text-[0.8125rem] font-semibold leading-5');
    expect(html).not.toContain('min-h-44');
  });
});

describe('the download', () => {
  it('holds every live card with its block, place, tag, both languages and source', () => {
    const json = JSON.parse(canvasJson(CANVAS.cards, '2026-11-16T12:00:00.000Z')) as {
      exported_at: string;
      cards: Record<string, unknown>[];
    };
    expect(json.exported_at).toBe('2026-11-16T12:00:00.000Z');
    expect(json.cards).toHaveLength(5);
    expect(json.cards[2]).toEqual({
      block: 'key_partners',
      position: 1,
      tag: 'validated',
      text_fa: PARTNER.text_fa,
      text_en: PARTNER.text_en,
      note_fa: PARTNER.note_fa,
      note_en: PARTNER.note_en,
      source: PARTNER.source,
      last_change: PARTNER.last_change,
    });
  });
});

describe('when the canvas cannot be read', () => {
  it('says so, in the shown language', async () => {
    state.answer = { ok: false, status: 0, error: null, setCookie: null };
    expect(await page()).toContain('بوم خوانده نشد.');
    expect(await page({ lang: 'en' })).toContain('The canvas could not be read.');
  });
});

describe('right to left', () => {
  it('uses logical properties only (rule 7)', () => {
    for (const file of [
      'canvas.tsx',
      'canvas-card.tsx',
      'canvas-words.ts',
      'canvas.css',
      '(app)/canvas/page.tsx',
    ]) {
      const source = readFileSync(join(__dirname, file), 'utf8');
      expect(
        source.match(
          /\b(?:ml|mr|pl|pr|left|right|text-left|text-right|border-l|border-r|rounded-l|rounded-r)-[\w[]/g,
        ),
        file,
      ).toBeNull();
      expect(
        source.match(/(?:margin|padding|border)-(?:left|right)\b|\b(?:left|right):/g),
        file,
      ).toBeNull();
    }
  });
});
