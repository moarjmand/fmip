import type { ConsoleModelReport } from '@fmip/contracts';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MODEL_REPORT,
  MODEL_REPORT_EMPTY,
  MODEL_REPORT_REACHED,
  MODEL_REPORT_THIN,
} from './model-report.fixture';

/**
 * The console's forecast-model page (T-1729, D-355): each section on a
 * report shaped like the weekly watch's, then the states with too little to
 * show -- nothing published, a version just promoted -- and a candidate
 * whose paired count is reached. Its Persian-only scan is in
 * `console-persian.spec.tsx` with every other console page.
 */

const state = vi.hoisted(() => ({ report: null as unknown, ok: true }));

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
vi.mock('@/lib/console-api', () => ({
  consoleModel: () =>
    Promise.resolve(
      state.ok
        ? { ok: true, status: 200, data: state.report, setCookie: null }
        : { ok: false, status: 0, error: null, setCookie: null },
    ),
  consoleSnapshot: () =>
    Promise.resolve({
      ok: true,
      status: 200,
      setCookie: null,
      data: {
        loaded_at: '2026-11-03T05:00:00Z',
        snapshot: {
          schema: 1,
          generated_at: '2026-11-03T05:00:00Z',
          agents: [],
          findings: [],
          brief: null,
          decisions: [],
          reports: [
            {
              agent: 'model-scientist',
              date: '2026-10-31',
              title: 'پایش هفتگی مدل',
              path: 'ops/reports/model-scientist/2026-10-31.md',
              text: 'متن',
            },
            {
              agent: 'model-scientist',
              date: '2026-11-02',
              title: 'پایش هفتگی مدل',
              path: 'ops/reports/model-scientist/2026-11-02.md',
              text: 'متن',
            },
          ],
        },
      },
    }),
}));

async function render(report: ConsoleModelReport): Promise<string> {
  state.report = report;
  const { default: Page } = await import('./(app)/model/page');
  return renderToStaticMarkup(<>{await Page()}</>);
}

beforeEach(() => {
  state.ok = true;
});

describe('the model page', () => {
  it('says what the published model is, since when, and what is in shadow', async () => {
    const html = await render(MODEL_REPORT);
    expect(html).toContain('مدل الان چیست');
    expect(html).toMatch(/data-testid="published-version"[^>]*>dixon-coles-elo@0\.6\.0</);
    expect(html).toContain('D-191');
    expect(html).toContain('dixon-coles-elo@0.7.0');
    expect(html).toContain('یازده لیگ تازه');
    expect(html).toContain('سرویس مدل الان آن را اجرا می‌کند');
    // The three prediction products stay apart (rule 6).
    expect(html).toContain('تحلیل بنیان‌گذار و پیش‌بینی جامعه جدا هستند');
  });

  it('lists the inputs the published version reads, in order, and the factors set aside', async () => {
    const html = await render(MODEL_REPORT);
    const inputs = html.slice(html.indexOf('data-testid="inputs"'), html.indexOf('</ol>'));
    const order = [
      'match results',
      'time decay',
      'home advantage',
      'own Elo prior',
      'ridge',
      'low-score correction',
      'cross-league fit',
      'Poisson score matrix',
    ].map((name) => inputs.indexOf(name));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Line-ups are sent to the model, but the published version does not read them.
    expect(inputs).not.toContain('lineup');
    const rejected = html.slice(html.indexOf('data-testid="rejected"'));
    for (const id of ['D-121', 'D-329', 'D-335', 'D-334']) expect(rejected).toContain(id);
    expect(rejected).toContain('coach quality');
  });

  it('gives each headline number its baseline, its interval, its sample and its window', async () => {
    const html = await render(MODEL_REPORT);
    expect(html).toContain('۱٬۸۳۱');
    const kpis = html.slice(html.indexOf('data-testid="kpis"'));
    expect(kpis).toContain('۵۸٫۲٪');
    expect(kpis).toContain('۰٫۹۵۴');
    expect(kpis).toContain('۰٫۵۶۴');
    expect(kpis).toContain('حدس یک‌سوم: ۳۳٫۳٪');
    expect(kpis).toContain('حدس یک‌سوم: ۱٫۰۹۹');
    expect(kpis).toContain('حدس یک‌سوم: ۰٫۶۶۷');
    expect(kpis).toContain('بازه‌ی ۹۵٪');
  });

  it('draws the calibration of all three outcomes and names the bands the watch flags', async () => {
    const html = await render(MODEL_REPORT);
    for (const outcome of ['home', 'draw', 'away'])
      expect(html).toContain(`data-testid="calibration-${outcome}"`);
    const off = html.slice(html.indexOf('data-testid="calibration-off"'));
    const flagged = off.slice(0, off.indexOf('</ul>')).match(/<li>/g) ?? [];
    // The weekly report's five, plus the draw's 30-40% band the stand-in adds.
    expect(flagged.length).toBe(6);
    expect(off).toContain('برد میهمان در باند ۴۰٪ تا ۵۰٪');
    // A band of fewer than 20 forecasts is in the table, not on the chart.
    const home = html.slice(html.indexOf('data-testid="calibration-home"'));
    expect(home.slice(0, home.indexOf('</svg>')).match(/r="4\.5"/g)).toHaveLength(7);
  });

  it('draws the weekly trend with the one-third line, and the competitions best first', async () => {
    const html = await render(MODEL_REPORT);
    expect(html).toContain('data-testid="trend"');
    expect(html).toContain('حدس یک‌سوم ۱٫۰۹۹');
    const table = html.slice(html.indexOf('data-testid="competitions"'));
    expect(table.indexOf('Champions League')).toBeLessThan(table.indexOf('Scottish Premiership'));
    expect(table).toContain('بهترین');
    expect(table).toContain('ضعیف‌ترین');
    expect(table.slice(table.indexOf('data-testid="thin"'))).toContain('Copa del Rey');
  });

  it("gives a candidate's counts alone before D-336's thresholds, and links the weekly report", async () => {
    const html = await render(MODEL_REPORT);
    const card = html.slice(html.indexOf('data-testid="candidate"'));
    expect(card).toContain('شمار هنوز نرسیده: ۲۵۴ از ۳۰۰');
    expect(card).toContain('۷۲ از ۱۰۰');
    expect(card).toContain('۹۷٫۲٪');
    expect(card).not.toContain('data-testid="paired-figures"');
    expect(html).toContain(
      `href="/reports?path=${encodeURIComponent('ops/reports/model-scientist/2026-11-02.md')}"`,
    );
  });

  it('shows the paired figures once the count is reached, labelled as no verdict', async () => {
    const html = await render(MODEL_REPORT_REACHED);
    expect(html).toContain('data-testid="paired-figures"');
    expect(html).toContain('حکم نیستند');
    expect(html).toContain('۱۰۴ مسابقه‌ی لیگ‌های تازه');
  });

  it('says there is nothing to show rather than show an empty figure', async () => {
    const html = await render(MODEL_REPORT_EMPTY);
    expect(html).toContain('data-testid="no-published"');
    expect(html).toContain('data-testid="no-accuracy"');
    expect(html).toContain('سرویس مدل پاسخ نداد');
    expect(html).toContain('الان نسخه‌ای در shadow نیست');
    expect(html).not.toContain('data-testid="kpis"');
  });

  it("says a version's make-up is not written, and that a week and 14 matches are too few", async () => {
    const html = await render(MODEL_REPORT_THIN);
    expect(html).toContain('شرح ورودی‌های این نسخه هنوز در کنسول نوشته نشده است');
    expect(html).not.toContain('data-testid="inputs"');
    expect(html).toContain('عددها هنوز سست‌اند');
    expect(html).toContain('دست‌کم دو هفته‌ی ارزیابی‌شده لازم است');
    expect(html).toContain('هنوز هیچ رقابتی ۳۰ مسابقه‌ی ارزیابی‌شده ندارد');
    expect(html).toContain('هنوز هیچ باندی پیش‌بینی کافی ندارد');
  });

  it('says when the figures could not be read', async () => {
    state.ok = false;
    const html = await render(MODEL_REPORT);
    expect(html).toContain('اعداد مدل از API نرسید');
  });
});
