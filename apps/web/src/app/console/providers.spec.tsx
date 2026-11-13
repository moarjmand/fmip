import type { ConsoleProviders } from '@fmip/contracts';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROVIDERS } from './providers.fixture';
import { lowestPrice, sortProviders, viewHref, viewOf, weightedTotal } from './providers';

/**
 * The data providers' comparison page (T-1830, D-423): the weighted total
 * counts only scored criteria and says how much weight that is, sorting puts
 * a provider with nothing to sort by last, the filters live in the address,
 * every unverified fact is marked, a source that is a link opens apart, and
 * a missing comparison is said, never filled. Its Persian-only scan is in
 * `console-persian.spec.tsx` with every other console page.
 */

const state = vi.hoisted(() => ({
  providers: null as unknown,
  ok: true,
  reports: [] as unknown[],
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
vi.mock('@/lib/console-api', () => ({
  consoleSnapshot: () =>
    Promise.resolve(
      state.ok
        ? {
            ok: true,
            status: 200,
            data: {
              snapshot: { providers: state.providers, reports: state.reports },
              loaded_at: '2026-11-13T10:00:00Z',
            },
            setCookie: null,
          }
        : { ok: false, status: 0, error: null, setCookie: null },
    ),
}));

const page = async (params: Record<string, string> = {}) => {
  const { default: Page } = await import('./(app)/providers/page');
  return renderToStaticMarkup(<>{await Page({ searchParams: Promise.resolve(params) })}</>);
};

const clone = (): ConsoleProviders => structuredClone(PROVIDERS);

beforeEach(() => {
  state.providers = PROVIDERS;
  state.ok = true;
  state.reports = [];
});

describe('weightedTotal', () => {
  it('weighs every score by its criterion', () => {
    const [apiFootball] = PROVIDERS.providers;
    // 20·5 + 15·4 + 15·3 + 10·4 + 15·5 + 15·2 + 5·3 + 5·4 = 385, over 100.
    expect(weightedTotal(apiFootball!, PROVIDERS.criteria)).toEqual({
      value: 3.85,
      counted: 8,
      of: 8,
      weight_share: 1,
    });
  });

  it('never takes a missing score as a number, and says the weight it counted', () => {
    const footballData = PROVIDERS.providers[2]!;
    const total = weightedTotal(footballData, PROVIDERS.criteria);
    expect(total.counted).toBe(7);
    expect(total.weight_share).toBeCloseTo(0.95);
    // 20·3 + 15·2 + 15·2 + 10·3 + 15·4 + 15·4 + 5·2 = 280, over 95.
    expect(total.value).toBeCloseTo(280 / 95);
  });

  it('counts verified facts alone when asked', () => {
    const [apiFootball] = PROVIDERS.providers;
    const total = weightedTotal(apiFootball!, PROVIDERS.criteria, true);
    expect(total.counted).toBe(6);
    expect(total.value).toBeCloseTo((385 - 15 * 3 - 15 * 2) / 70);
  });

  it('is empty, not zero, with no score', () => {
    const provider = { ...PROVIDERS.providers[0]!, facts: {} };
    expect(weightedTotal(provider, PROVIDERS.criteria).value).toBeNull();
  });
});

describe('sorting and the address', () => {
  it('sorts by the total, high first, by default', () => {
    const order = sortProviders(PROVIDERS.providers, PROVIDERS.criteria, 'total', 'desc', false);
    expect(order.map((p) => p.key)).toEqual([
      'sportradar',
      'sportmonks',
      'api-football',
      'football-data-org',
    ]);
  });

  it('puts a provider with nothing to sort by last, both ways', () => {
    const asc = sortProviders(
      PROVIDERS.providers,
      PROVIDERS.criteria,
      'c:sanctions',
      'asc',
      false,
    ).map((p) => p.key);
    const desc = sortProviders(
      PROVIDERS.providers,
      PROVIDERS.criteria,
      'c:sanctions',
      'desc',
      false,
    ).map((p) => p.key);
    expect(asc.at(-1)).toBe('football-data-org');
    expect(desc.at(-1)).toBe('football-data-org');
  });

  it('sorts by the lowest paid price, a quote-only provider last', () => {
    expect(lowestPrice(PROVIDERS.providers[0]!)).toBe(19);
    expect(lowestPrice(PROVIDERS.providers[3]!)).toBeNull();
    const order = sortProviders(PROVIDERS.providers, PROVIDERS.criteria, 'price', 'asc', false);
    expect(order.map((p) => p.key)).toEqual([
      'api-football',
      'football-data-org',
      'sportmonks',
      'sportradar',
    ]);
  });

  it('reads only choices it knows from the address', () => {
    expect(viewOf({ sort: 'c:nonsense', dir: 'up', status: 'maybe' }, PROVIDERS.criteria)).toEqual({
      sort: 'total',
      dir: 'desc',
      status: 'all',
      verifiedOnly: false,
    });
    const view = viewOf(
      { sort: 'c:price', dir: 'asc', status: 'candidate', verified: '1' },
      PROVIDERS.criteria,
    );
    expect(view).toEqual({ sort: 'c:price', dir: 'asc', status: 'candidate', verifiedOnly: true });
    expect(viewHref(view, { status: 'all' })).toBe(
      '/providers?sort=c%3Aprice&dir=asc&verified=1#matrix',
    );
  });
});

describe('the providers page', () => {
  it('shows the recommendation, the current stack, the matrix, the plans, the cards and the next steps', async () => {
    const html = await page();
    expect(html).toContain('پیشنهاد پژوهش');
    expect(html).toContain(PROVIDERS.recommendation_fa!);
    expect(html).toContain(PROVIDERS.current_stack_fa!);
    expect(html.match(/data-testid="matrix-row"/g)).toHaveLength(4);
    expect(html.match(/data-testid="provider-card"/g)).toHaveLength(4);
    expect(html).toContain('data-testid="plans"');
    for (const step of PROVIDERS.next_steps_fa) expect(html).toContain(step);
  });

  it('marks every unverified fact, in the matrix and on the cards', async () => {
    const html = await page();
    const unverified = PROVIDERS.providers.flatMap((p) =>
      Object.values(p.facts).filter((f) => !f.verified && f.score !== null),
    ).length;
    // The matrix and the card each draw the score; the legend draws one more.
    expect(html.match(/data-verified="false"/g)).toHaveLength(unverified * 2 + 1);
    const cardBadges = PROVIDERS.providers.flatMap((p) =>
      Object.values(p.facts).filter((f) => !f.verified),
    ).length;
    expect(html.match(/<span aria-hidden="true" class="me-1">؟<\/span>تأییدنشده/g)).toHaveLength(
      cardBadges,
    );
  });

  it('gives each provider a confidence badge, and says when it is not known', async () => {
    const html = await page();
    expect(html).toContain('اطمینان زیاد');
    expect(html).toContain('اطمینان متوسط');
    expect(html).toContain('اطمینان کم');
    const providers = clone();
    providers.providers[0]!.confidence = null;
    state.providers = providers;
    expect(await page()).toContain('اطمینان نامشخص');
  });

  it('opens a source link apart, and shows a source in words as words', async () => {
    const html = await page();
    expect(html).toContain(
      'href="https://www.api-football.com/coverage" target="_blank" rel="noopener noreferrer nofollow"',
    );
    expect(html).toContain('سوابق دریافت داده‌ی خود ما');
  });

  it('filters by status and keeps the sort in the links', async () => {
    const html = await page({ status: 'candidate', sort: 'c:price' });
    expect(html.match(/data-testid="matrix-row"/g)).toHaveLength(2);
    expect(html).toContain('href="/providers?sort=c%3Aprice#matrix"');
  });

  it('says a comparison that has not arrived, and a page that cannot be read', async () => {
    state.providers = null;
    const missing = await page();
    expect(missing).toContain('data-coverage="not_supplied"');
    expect(missing).not.toContain('data-testid="matrix"');
    state.ok = false;
    expect(await page()).toContain('role="alert"');
  });

  it("links the research's full report when the snapshot carries it", async () => {
    expect(await page()).not.toContain('data-testid="full-report"');
    state.reports = [
      {
        agent: 'business-adviser',
        date: '2026-11-13',
        title: 'ارائه‌دهنده‌ها',
        path: 'reports/business-adviser/2026-11-13-football-data-providers-fa.md',
        text: '',
      },
      {
        agent: 'business-adviser',
        date: '2026-11-14',
        title: 'هزینه',
        path: 'reports/business-adviser/costs.md',
        text: '',
      },
    ];
    expect(await page()).toContain(
      'href="/reports?path=reports%2Fbusiness-adviser%2F2026-11-13-football-data-providers-fa.md"',
    );
  });

  it('says how many items of the file were left out', async () => {
    state.providers = { ...clone(), skipped: 3 };
    expect(await page()).toContain('۳ مورد از فایل پژوهش');
  });
});
