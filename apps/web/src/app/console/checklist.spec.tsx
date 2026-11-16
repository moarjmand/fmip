import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECKLIST, SECTION } from './checklist.fixture';
import { ItemDetail } from './checklist-item';
import { assigneeWords, historyWords, progressOf, whoKey } from './checklist-words';

/**
 * The pre-launch checklist's page (T-1840, D-428): both lists as tabs with
 * their progress, a section's progress, each item's status and who must do
 * it in front of it, the filters by who and by status kept in the links,
 * the notes and history behind the toggle, every history row in Persian,
 * and logical CSS only (rule 7).
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
  const done = async () => ({ ok: true, error: null });
  return {
    addChecklistItem: async () => ({ error: null, done: null }),
    updateChecklistItem: done,
    moveChecklistItem: done,
    addChecklistNote: done,
    removeChecklistItem: done,
  };
});
vi.mock('@/lib/console-api', () => ({
  consoleChecklist: () => Promise.resolve(state.answer),
}));

const params = (p: Record<string, string>) => Promise.resolve(p);
const page = async (p: Record<string, string> = {}) =>
  renderToStaticMarkup(
    await (await import('./(app)/checklist/page')).default({ searchParams: params(p) }),
  );
const items = (html: string) => html.match(/data-testid="checklist-item"/g)?.length ?? 0;
const people = CHECKLIST.people;

beforeEach(() => {
  state.answer = { ok: true, status: 200, data: CHECKLIST, setCookie: null };
});

describe('progress', () => {
  it('counts done over every item but «لازم نیست»', () => {
    const p = progressOf([
      { status: 'done' },
      { status: 'done' },
      { status: 'blocked' },
      { status: 'not_needed' },
    ]);
    expect(p).toMatchObject({ counted: 3, done: 2, percent: 66 });
    expect(p.by.not_needed).toBe(1);
  });

  it('is zero, not a division by zero, for an empty section', () => {
    expect(progressOf([])).toMatchObject({ counted: 0, done: 0, percent: 0 });
  });
});

describe('words', () => {
  it('names every kind of assignee', () => {
    expect(assigneeWords(null, people)).toBe('بدون مسئول');
    expect(assigneeWords('agents', people)).toBe('تیم عامل‌ها (Claude)');
    expect(assigneeWords(people[0]!.id, people)).toBe('مصطفی');
    expect(whoKey(people[1]!.id, people)).toBe('mohammad');
    expect(whoKey(null, people)).toBe('none');
  });

  it('says every kind of change in Persian, with its before and after', () => {
    const title = (id: string) => (id === SECTION.brand ? 'برند' : 'تأیید نهایی');
    const words = CHECKLIST.sections[0]!.items[0]!.history.map((e) =>
      historyWords(e, people, title),
    );
    expect(words).toEqual([
      'وضعیت را از «شروع نشده» به «در حال انجام» تغییر داد',
      'مسئول را از «بدون مسئول» به «مصطفی» تغییر داد',
      'متن را از «لوگو» به «نهایی‌سازی و اضافه‌کردن لوگوی رسمی» تغییر داد',
      'از بخش «تأیید نهایی» به «برند» برد',
      'جای مورد را در بخش از ۳ به ۱ برد',
    ]);
    expect(
      historyWords(
        { kind: 'removed', actor: 'م', previous: 'x', next: 'تکراری', created_at: '' },
        people,
        title,
      ),
    ).toBe('مورد را حذف کرد؛ دلیل: تکراری');
  });
});

describe('the page', () => {
  it('shows both lists as tabs with their progress, the first open by default', async () => {
    const html = await page();
    expect(html).toContain('فهرست بررسی پیش از راه‌اندازی برای خانواده و دوستان');
    expect(html).toContain('فهرست نهایی بررسی پیش از راه‌اندازی عمومی');
    expect(html).toMatch(/aria-current="page"[^>]*data-testid="checklist-tab"/);
    // Friends: 5 items, 1 not needed, 1 done of 4 counted.
    expect(html).toContain('۱ از ۴ انجام شد (۲۵٪)');
    expect(items(html)).toBe(5);
    expect(html).not.toContain('آزمایش مجدد تمام قابلیت‌هایی که اصلاح شده‌اند');
  });

  it('opens the public list, and says a section has no items yet', async () => {
    const html = await page({ tab: 'public' });
    // Nothing done is said in words, and the bar of a list nobody began is empty.
    expect(html).toContain('هنوز هیچ‌کدام از ۱ مورد انجام نشده');
    expect(html).not.toContain('class="h-full bg-caption"');
    expect(items(html)).toBe(1);
    expect(html).toContain('این بخش هنوز موردی ندارد.');
    expect(html).toContain('href="/checklist?tab=public&amp;status=done"');
  });

  it('puts each item’s status and who must do it in front of it', async () => {
    const html = await page();
    const row = html.slice(html.indexOf('data-status="blocked"'));
    expect(row).toMatch(/aria-label="وضعیت"/);
    expect(row).toMatch(/<option value="blocked" selected="">مسدود<\/option>/);
    expect(row).toMatch(/<option value="agents" selected="">تیم عامل‌ها \(Claude\)<\/option>/);
    expect(html).toContain('>مصطفی (نگهدارنده)</option>');
    expect(html).toContain('۱ یادداشت');
  });

  it('filters by who and by status, keeping the other in its links', async () => {
    const agents = await page({ who: 'agents' });
    expect(items(agents)).toBe(1);
    expect(agents).toContain('۱ مورد از ۵ با این فیلتر.');
    expect(agents).toContain('href="/checklist?who=agents&amp;status=done"');
    expect(agents).not.toContain('افزودن مورد به این بخش');

    const done = await page({ status: 'done', who: 'mohammad' });
    expect(items(done)).toBe(1);
    expect(done).toContain('اتصال دامنه رسمی برند');

    const none = await page({ status: 'blocked', who: 'mostafa' });
    expect(none).toContain('موردی با این فیلتر در این فهرست نیست.');
  });

  it('ignores a filter it does not know rather than hide everything', async () => {
    const html = await page({ who: 'nobody-here', status: 'finished', tab: 'x' });
    expect(items(html)).toBe(5);
  });

  it('says so when the list cannot be read', async () => {
    state.answer = { ok: false, status: 0, error: null, setCookie: null };
    expect(await page()).toContain('فهرست خوانده نشد.');
  });
});

describe('the item’s detail', () => {
  it('shows the notes with author and time, the history newest first and the controls', () => {
    const item = CHECKLIST.sections[0]!.items[0]!;
    const html = renderToStaticMarkup(
      <ItemDetail
        id="d"
        item={item}
        people={people}
        sections={[{ id: SECTION.brand, label: 'خانواده و دوستان — برند' }]}
        sectionTitle={{ [SECTION.brand]: 'برند', [SECTION.launch]: 'تأیید نهایی' }}
        first
        last={false}
        pending={false}
        run={async () => true}
      />,
    );
    expect(html).toContain('طرح اولیه آماده است.');
    expect(html).toContain('محمد');
    expect(html.indexOf('جای مورد را در بخش')).toBeLessThan(html.indexOf('وضعیت را از'));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*بالاتر/);
    expect(html).toContain('حذف مورد');
    expect(html).toContain('دلیل را بنویسید');
  });
});

describe('right to left', () => {
  it('uses logical properties only (rule 7)', () => {
    for (const file of [
      'checklist.tsx',
      'checklist-item.tsx',
      'checklist-words.ts',
      '(app)/checklist/page.tsx',
    ]) {
      const source = readFileSync(join(__dirname, file), 'utf8');
      expect(
        source.match(
          /\b(?:ml|mr|pl|pr|left|right|text-left|text-right|border-l|border-r|rounded-l|rounded-r)-[\w[]/g,
        ),
        file,
      ).toBeNull();
    }
  });
});
