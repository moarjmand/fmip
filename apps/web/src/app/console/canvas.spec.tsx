import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CANVAS, ENGLISH_ONLY, PARTNER, REMOVED, SEGMENT } from './canvas.fixture';
import { CardEditor } from './canvas-card';
import { canvasJson, cardText, historyWords, tagCounts } from './canvas-words';

/**
 * The business model canvas's page (T-1856, D-441): the nine cells in the
 * fill order with their numbers and guiding questions, the classic layout
 * and the print sheet, cards tinted by tag with their controls and who
 * changed them, the tag filters with counts, the bin with restore, the
 * history newest first in words, the English view on the page's own
 * container, the editor with both languages, the JSON download, and
 * logical CSS only (rule 7).
 */

const state = vi.hoisted(() => ({ answer: null as unknown }));

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
  const done = async () => ({ ok: true, error: null, id: null });
  return {
    createCanvasCard: done,
    updateCanvasCard: done,
    moveCanvasCard: done,
    removeCanvasCard: done,
    restoreCanvasCard: done,
  };
});
vi.mock('@/lib/console-api', () => ({
  consoleCanvas: () => Promise.resolve(state.answer),
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
    expect(html).toMatch(/^<div class="canvas-page flex flex-col gap-4" lang="en" dir="ltr"/);
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
    expect(html).toMatch(/^<div class="canvas-page flex flex-col gap-4" data-testid="canvas-page"/);
    expect(html).toMatch(/href="\/canvas\?lang=en" lang="en" dir="ltr"[^>]*>English</);
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
