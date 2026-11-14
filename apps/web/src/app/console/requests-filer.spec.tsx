import type { ConsoleRequestDetail, ConsoleRequestList } from '@fmip/contracts';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Who filed a teammate request (T-1831, D-424): every card names the console
 * account that filed it, or says it is not known; the list can be narrowed
 * to one filer, and the status tabs and the filer filter keep each other in
 * their links.
 */

const state = vi.hoisted(() => ({
  calls: [] as [string | undefined, string | undefined][],
  list: null as unknown,
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
  const action = async () => ({ error: null, done: null });
  return {
    createRequest: action,
    editRequest: action,
    requestAction: action,
    decideRequest: action,
    removeRequestImage: action,
    captionRequestImage: action,
    refreshRequests: async () => undefined,
    registerReminderDevice: async () => ({ ok: true, error: null }),
    removeReminderDevice: async () => ({ ok: true }),
    setRequestAlerts: async () => ({ ok: true, error: null }),
  };
});
vi.mock('@/lib/console-api', () => ({
  consoleRequests: (status?: string, by?: string) => {
    state.calls.push([status, by]);
    return Promise.resolve({ ok: true, status: 200, data: state.list, setCookie: null });
  },
  consoleCalendarPush: () =>
    Promise.resolve({
      ok: true,
      status: 200,
      data: { state: 'configured', public_key: 'BPk', devices: 0, request_alerts: false },
      setCookie: null,
    }),
}));

const request = (overrides: Partial<ConsoleRequestDetail> = {}): ConsoleRequestDetail => ({
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  title: 'جدول لیگ آمریکا دو کنفرانس شود',
  body: '',
  status: 'new',
  priority: 'normal',
  created_by: 'محمد',
  created_by_username: 'mohammad',
  created_at: '2026-11-13T08:00:00.000Z',
  updated_at: '2026-11-13T08:00:00.000Z',
  result: null,
  result_at: null,
  decision_question: null,
  decision_asked_at: null,
  decision_choice: null,
  decision_text: null,
  decision_by: null,
  decided_at: null,
  execute_requested_at: null,
  images: [],
  events: [],
  ...overrides,
});

const list = (requests: ConsoleRequestDetail[]): ConsoleRequestList => ({
  requests,
  counts: {
    all: requests.length,
    open: requests.length,
    by_status: {
      new: requests.length,
      in_progress: 0,
      waiting_decision: 0,
      decided: 0,
      done: 0,
      cancelled: 0,
    },
  },
  filers: [
    { username: 'mostafa', display_name: 'مصطفی', count: 5 },
    { username: 'mohammad', display_name: 'محمد', count: 2 },
  ],
});

const page = async (params: Record<string, string> = {}) => {
  const { default: Page } = await import('./(app)/requests/page');
  return renderToStaticMarkup(<>{await Page({ searchParams: Promise.resolve(params) })}</>);
};

beforeEach(() => {
  state.calls = [];
  state.list = list([request()]);
});

describe('the filer on a card', () => {
  it('names the console account that filed it, and anchors the card', async () => {
    const { RequestCard } = await import('./requests');
    const html = renderToStaticMarkup(<RequestCard request={request()} />);
    expect(html).toContain('ثبت‌کننده:');
    expect(html).toContain('data-testid="filer">محمد</span>');
    expect(html).toContain('id="r-0f8fad5b-d9cb-469f-a165-70867728950e"');
  });

  it('says the filer is not known rather than leave it blank', async () => {
    const { RequestCard, UNKNOWN_FILER } = await import('./requests');
    const html = renderToStaticMarkup(<RequestCard request={request({ created_by: '' })} />);
    expect(UNKNOWN_FILER).toBe('ثبت‌کننده نامشخص');
    expect(html).toContain(UNKNOWN_FILER);
    expect(html).not.toContain('data-testid="filer"');
  });
});

describe('the filer filter', () => {
  it('lists everyone who filed, with their counts, and asks for everyone by default', async () => {
    const html = await page();
    expect(state.calls).toEqual([[undefined, undefined]]);
    expect(html.match(/data-testid="filer-filter"/g)).toHaveLength(3);
    expect(html).toContain('href="/requests?by=mohammad"');
    expect(html).toContain('<span dir="auto">مصطفی</span><span class="text-xs">۵</span>');
  });

  it("asks for one filer's requests and keeps the filer in the status tabs", async () => {
    const html = await page({ by: 'mohammad', status: 'new' });
    expect(state.calls).toEqual([['new', 'mohammad']]);
    expect(html).toContain('href="/requests?status=done&amp;by=mohammad"');
    expect(html).toContain('href="/requests?status=new"');
    expect(html).toMatch(/aria-current="page"[^>]*data-testid="filer-filter"/);
  });

  it('ignores a filer that is not a username', async () => {
    await page({ by: '../admin' });
    expect(state.calls).toEqual([[undefined, undefined]]);
  });

  it('says when a filer has no request', async () => {
    state.list = list([]);
    expect(await page({ by: 'mohammad' })).toContain('درخواستی از «محمد» نیست.');
  });
});

describe('the new-request notification switch (T-1832)', () => {
  it('sits on the requests page, off until the person switches it on', async () => {
    const html = await page();
    expect(html).toContain('data-testid="request-alerts"');
    expect(html).toContain('اعلان درخواست‌های تازه');
    expect(html).toContain('aria-checked="false"');
  });
});
