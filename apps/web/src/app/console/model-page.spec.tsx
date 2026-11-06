import type { ConsoleModelLab, ConsoleModelReport } from '@fmip/contracts';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MODEL_LAB,
  MODEL_REPORT,
  MODEL_REPORT_EMPTY,
  MODEL_REPORT_THIN,
} from './model-report.fixture';

/**
 * The console's forecast-model page (T-1729, D-355; every version, T-1752,
 * D-371): each section on the API's real answer of 2026-11-06, then the
 * states with too little to show -- nothing published, a version just
 * promoted, no ledger -- and the rule that a version in shadow now is never
 * given a figure of its promotion conditions. Its Persian-only scan is in
 * `console-persian.spec.tsx` with every other console page.
 */

const state = vi.hoisted(() => ({ report: null as unknown, ok: true, lab: null as unknown }));

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
        loaded_at: '2026-11-06T20:00:00Z',
        snapshot: {
          schema: 1,
          generated_at: '2026-11-06T20:00:00Z',
          agents: [],
          findings: [],
          brief: null,
          decisions: [],
          reports: [
            {
              agent: 'model-scientist',
              date: '2026-11-02',
              title: 'پایش هفتگی مدل',
              path: 'ops/reports/model-scientist/2026-11-02.md',
              text: 'متن',
            },
          ],
          model_lab: state.lab,
        },
      },
    }),
}));

async function render(report: ConsoleModelReport, lab: ConsoleModelLab | null = MODEL_LAB) {
  state.report = report;
  state.lab = lab;
  const page = (await import('./(app)/model/page')).default;
  return renderToStaticMarkup(<>{await page()}</>);
}

const section = (html: string, id: string): string => {
  const start = html.indexOf(`data-testid="section-${id}"`);
  const end = html.indexOf('data-testid="section-', start + 10);
  return html.slice(start, end === -1 ? undefined : end);
};
const count = (html: string, needle: string): number => html.split(needle).length - 1;

beforeEach(() => {
  state.ok = true;
});

describe('now', () => {
  it('names the published version, its four figures against the guess, and what the record leaves out', async () => {
    const html = await render(MODEL_REPORT);
    const now = section(html, 'now');
    expect(now).toContain('data-testid="published-version"');
    expect(now).toContain('dixon-coles-elo@0.6.0');
    expect(count(now, 'data-testid="tile-strip"')).toBe(4);
    expect(now).toContain('RPS');
    expect(now).toContain('حدس یک‌سوم روی همین مسابقه‌ها');
    expect(now).toContain('data-testid="unscored"');
    expect(now).toContain('data-testid="limited"');
  });

  it("shows the candidate's counts toward its conditions, and that no verdict is recorded", async () => {
    const html = await render(MODEL_REPORT);
    const now = section(html, 'now');
    expect(now).toContain('data-testid="candidate"');
    expect(count(now, 'role="meter"')).toBe(2);
    expect(now).toContain('رسید');
    expect(now).toContain('data-testid="judgement-slot"');
    expect(now).toContain('هنوز ثبت نشده');
    expect(now).not.toContain('data-testid="judgements"');
  });

  it('shows a recorded judgement when the ledger carries one', async () => {
    const html = await render(MODEL_REPORT, {
      ...MODEL_LAB,
      judgements: [
        {
          model_version: 'dixon-coles-elo@0.7.0',
          rule: 'D-336',
          condition: 'no_worse',
          result: 'met',
          judged_on: '2026-11-09',
          matches: 352,
          text: 'بدتر نیست: بالای بازه زیر سقف است.',
          report: null,
        },
      ],
    });
    expect(section(html, 'now')).toContain('data-testid="judgements"');
    expect(section(html, 'now')).toContain('برقرار');
  });
});

describe('the model', () => {
  it('draws the pipeline twice with a pill per stored version, and the matrix of every version', async () => {
    const html = await render(MODEL_REPORT);
    const model = section(html, 'model');
    expect(model).toContain('data-layout="wide"');
    expect(model).toContain('data-layout="narrow"');
    // Four stored versions, so four pills on the first input, in each drawing.
    expect(count(model, '0.1.0: به‌کار می‌رود')).toBeGreaterThanOrEqual(2);
    expect(count(model, '+0.5')).toBeGreaterThanOrEqual(2);
    expect(model).toContain('data-testid="makeup-matrix"');
    for (const number of ['0.2.0', '0.3.0', '0.4.0', '0.8.0']) expect(model).toContain(number);
    expect(model).toContain('هرگز اجرا نشد');
    expect(model).toContain('data-testid="version-deltas"');
    expect(model).toContain('۲۳٬۹۰۴ مسابقه');
    expect(model).toContain('هنوز نیامده');
  });
});

describe("every version's record", () => {
  it('lists one row per version and role, the one on the site first, with its lead time', async () => {
    const html = await render(MODEL_REPORT);
    const records = section(html, 'records');
    expect(count(records, 'data-testid="version-row"')).toBe(4);
    expect(records.indexOf('منتشرشده‌ی الان')).toBeLessThan(records.indexOf('در shadow الان'));
    expect(records).toContain('دقیقه');
    expect(records).toContain('روز');
    expect(records).toContain('data-testid="records-warning"');
  });

  it('gives a version in shadow now its competitions as counts only', async () => {
    const html = await render(MODEL_REPORT);
    const records = section(html, 'records');
    const blocks = records.split('data-testid="version-competitions"').slice(1);
    const shadow = blocks.find((b) => b.includes('dixon-coles-elo@0.7.0')) as string;
    expect(shadow).toContain('فقط شمارش');
    expect(shadow).not.toContain('data-testid="interval-strip"');
  });
});

describe('the comparison', () => {
  it('shows the pair under judgement as counts, a withheld strip and the verdict slot, never a figure', async () => {
    const html = await render(MODEL_REPORT);
    const compare = section(html, 'compare');
    expect(compare).toContain('data-testid="method-schematic"');
    expect(compare).toContain('data-testid="rules"');
    const judging = compare
      .split('data-testid="pair"')
      .find((b) => b.startsWith(' data-kind="judging"')) as string;
    expect(judging).toContain('۳۵۳ مسابقه‌ی مشترک');
    expect(judging).toContain('data-testid="withheld-strip"');
    expect(judging).toContain('data-testid="judgement-slot"');
    expect(judging).not.toContain('data-testid="pair-figures"');
    expect(judging).not.toContain('data-testid="difference-strip"');
  });

  it('shows the record pairs with both sides, the difference strip and the words when zero is inside', async () => {
    const html = await render(MODEL_REPORT);
    const compare = section(html, 'compare');
    const records = compare
      .split('data-testid="pair"')
      .filter((b) => b.startsWith(' data-kind="record"'));
    expect(records).toHaveLength(3);
    for (const pair of records) {
      expect(pair).toContain('data-testid="pair-figures"');
      expect(pair).toContain('data-testid="difference-strip"');
      expect(pair).toContain('بازه صفر را در بر می‌گیرد');
    }
    expect(compare).toContain('data-testid="unshared"');
  });
});

describe('calibration and the trend', () => {
  it('draws one set of panels and one trend panel per version with enough matches, the published one open', async () => {
    const html = await render(MODEL_REPORT);
    const cal = section(html, 'calibration');
    expect(count(cal, 'data-testid="version-calibration"')).toBe(4);
    expect(cal).toContain('<details open="" data-testid="version-calibration"');
    expect(count(cal, 'data-testid="calibration-draw"')).toBe(12);
    expect(cal).toContain('data-testid="calibration-off"');
    expect(count(cal, 'data-testid="version-trend"')).toBe(4);
  });
});

describe('the ledger', () => {
  it('shows the forest and a card per entry, the large family as one row and one card', async () => {
    const html = await render(MODEL_REPORT);
    const ledger = section(html, 'ledger');
    expect(ledger).toContain('data-testid="ledger-state"');
    expect(ledger).toContain('data-testid="forest"');
    expect(count(ledger, 'data-testid="ledger-entry"')).toBe(MODEL_LAB.entries.length - 5);
    expect(count(ledger, 'data-testid="ledger-family"')).toBe(1);
    expect(ledger).toContain('رد شد');
    expect(ledger).toContain('D-335');
    expect(ledger).toContain('چرا آزموده شد');
  });

  it('says the ledger was not supplied rather than showing an empty section', async () => {
    const html = await render(MODEL_REPORT, null);
    expect(section(html, 'ledger')).toContain('data-testid="ledger-missing"');
    expect(section(html, 'model')).toContain('data-layout="wide"');
  });

  it('says how many entries of the file were left out', async () => {
    const html = await render(MODEL_REPORT, { ...MODEL_LAB, skipped: 2 });
    expect(section(html, 'ledger')).toContain('۲ مورد فایل خوانا نبود');
  });
});

describe('what is not known', () => {
  it('lists the lead times, the limited share, the unscored matches and the late leagues from the answer', async () => {
    const html = await render(MODEL_REPORT);
    const unknown = section(html, 'unknown');
    expect(unknown).toContain('data-testid="unknown-list"');
    expect(unknown).toContain('۳۵۴ مسابقه از ۷۱۵');
    expect(unknown).toContain('۱۰۰ مسابقه از ۸۱۵');
    expect(unknown).toContain('۱۴ لیگ از ۲۶');
  });
});

describe('with too little to show', () => {
  it('says nothing is published, draws the model anyway and lists no record', async () => {
    const html = await render(MODEL_REPORT_EMPTY, null);
    expect(html).toContain('data-testid="no-published"');
    expect(html).toContain('سرویس مدل پاسخ نداد');
    expect(html).toContain('data-testid="model-schematic"');
    expect(html).toContain('هنوز هیچ نسخه‌ای پیش‌بینی ذخیره نکرده');
    expect(html).toContain('هنوز دو نسخه‌ای مسابقه‌ی مشترک ندارند');
    expect(html).toContain('هنوز هیچ باندی پیش‌بینی کافی ندارد');
    expect(html).toContain('دست‌کم دو هفته');
  });

  it('calls a dozen matches an early record and keeps every section', async () => {
    const html = await render(MODEL_REPORT_THIN);
    expect(section(html, 'now')).toContain('رکورد اولیه');
    expect(section(html, 'records')).toContain('رکورد اولیه');
    expect(count(html, 'data-testid="version-row"')).toBe(1);
  });

  it('says the figures did not arrive when the API fails or answers an older shape', async () => {
    state.ok = false;
    expect(await render(MODEL_REPORT)).toContain('اعداد مدل از API نرسید');
    state.ok = true;
    expect(await render({ published: null } as unknown as ConsoleModelReport)).toContain(
      'اعداد مدل از API نرسید',
    );
  });
});
