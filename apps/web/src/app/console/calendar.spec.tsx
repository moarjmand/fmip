import { isoToDay } from '@fmip/contracts/console';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CALENDAR, CALENDAR_PUSH } from './calendar.fixture';

const calls = vi.hoisted(() => ({ list: [] as { path: string; init: unknown }[], redirect: '' }));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
  headers: async () => new Headers({ 'x-fmip-console-base': '/agents' }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    calls.redirect = to;
    throw new Error('NEXT_REDIRECT');
  },
}));
vi.mock('@/app/console/console-link', () => ({
  ConsoleLink: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/console-api', () => {
  const ok = <T,>(data: T) =>
    Promise.resolve({ ok: true as const, status: 200, data, setCookie: null });
  return {
    consoleCalendar: () => ok(CALENDAR),
    consoleCalendarPush: () => ok(CALENDAR_PUSH),
    consoleCall: async (path: string, init: unknown) => {
      calls.list.push({ path, init });
      return { ok: true, status: 200, data: {}, setCookie: null };
    },
    applyConsoleCookie: async () => undefined,
  };
});

const html = async (node: ReactNode | Promise<ReactNode>) =>
  renderToStaticMarkup(<>{await node}</>);
const page = async (query: Record<string, string>) =>
  html((await import('./(app)/calendar/page')).default({ searchParams: Promise.resolve(query) }));

beforeEach(() => {
  calls.list = [];
  calls.redirect = '';
});

describe('reading the calendar query (T-1788)', () => {
  it('falls back to today, the month and Solar Hijri, and keeps what it can read', async () => {
    const { readQuery, hrefWith } = await import('./calendar');
    const today = isoToDay('2026-11-08')!;
    expect(readQuery({}, today)).toMatchObject({
      view: 'month',
      basis: 'j',
      at: today,
      day: today,
      event: null,
      newOn: null,
    });
    const q = readQuery(
      { view: 'week', cal: 'g', day: '2026-11-21', event: 'nope', sub: 'Data Feed' },
      today,
    );
    expect(q).toMatchObject({
      view: 'week',
      basis: 'g',
      day: isoToDay('2026-11-21'),
      at: isoToDay('2026-11-21'),
      event: null,
      sub: null,
    });
    expect(hrefWith(q, { event: '11111111-1111-4111-8111-111111111111', view: null })).toBe(
      '/calendar?cal=g&at=2026-11-21&day=2026-11-21&event=11111111-1111-4111-8111-111111111111',
    );
  });
});

describe('the calendar page', () => {
  it('draws Aban 1405 from Saturday with today marked and each event on its days', async () => {
    const out = await page({});
    expect(out).toContain('آبان ۱۴۰۵');
    expect(out).toContain('اکتبر – نوامبر ۲۰۲۶');
    // Today, and its own day panel.
    expect(out).toMatch(
      /aria-current="date"[^>]*aria-label="یکشنبه ۱۷ آبان ۱۴۰۵ · ۸ نوامبر ۲۰۲۶، روز انتخاب‌شده/,
    );
    // The weekly meeting falls on every Tuesday from 3 November, the monthly renewal on the 21st.
    for (const day of ['۱۲ آبان ۱۴۰۵', '۱۹ آبان ۱۴۰۵', '۲۶ آبان ۱۴۰۵', '۳ آذر ۱۴۰۵'])
      expect(out).toContain(`سه‌شنبه ${day}`);
    expect(out).toContain('aria-label="شنبه ۳۰ آبان ۱۴۰۵ · ۲۱ نوامبر ۲۰۲۶، ۱ رویداد"');
    // The reminder sent, and to how many browsers.
    expect(out).toContain('به ۱ از ۲ مرورگر رسید');
  });

  it('opens an event in the side panel with its values and a guarded delete', async () => {
    const out = await page({ event: '22222222-2222-4222-8222-222222222222', view: 'week' });
    expect(out).toContain('ویرایش رویداد');
    expect(out).toContain('value="جلسهٔ هفتگی تیم"');
    expect(out).toMatch(/<option value="weekly" selected="">/);
    expect(out).toMatch(/<option value="60" selected="">/);
    expect(out).toContain('بله، حذف شود');
    expect(out).toContain('data-testid="week"');
  });

  it('prefills a renewal from a subscription: monthly by the Gregorian calendar, a day before at 09:00', async () => {
    const out = await page({ new: '2026-11-21', sub: 'data-feed', cal: 'g', view: 'agenda' });
    expect(out).toContain('رویداد یا یادآور تازه');
    expect(out).toContain('value="تمدید سرویس داده"');
    expect(out).toContain('name="subscription_key" value="data-feed"');
    expect(out).toMatch(/<option value="monthly" selected="">/);
    expect(out).toMatch(/<option value="1440" selected="">/);
    expect(out).toContain('name="date" value="2026-11-21"');
    expect(out).not.toContain('بله، حذف شود');
  });

  it('says so when the event asked for is gone', async () => {
    expect(await page({ event: '99999999-9999-4999-8999-999999999999' })).toContain(
      'این رویداد دیگر نیست',
    );
  });
});

describe('the subscriptions page', () => {
  it('counts the urgent, names the next renewal and links each row to the calendar', async () => {
    const out = await html((await import('./(app)/calendar/subscriptions/page')).default());
    expect(out).toContain('۱ مورد فوری');
    expect(out).toContain(
      'تمدید بعدی: <bdi dir="auto">سرویس داده</bdi>، ۲۱ نوامبر ۲۰۲۶ · ۳۰ آبان ۱۴۰۵',
    );
    expect(out).toContain('در تقویم است');
    expect(out).toContain('event=11111111-1111-4111-8111-111111111111');
    expect(out).toContain('new=2026-11-08&amp;sub=backup-store');
    expect(out).toContain('href="https://secure.backblaze.com"');
  });
});

describe('the reminders worker', () => {
  it('is JavaScript the browser takes as a service worker, and opens the calendar relative to its scope', async () => {
    const response = (await import('./reminders-worker/route')).GET();
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    const body = await response.text();
    expect(body).toContain("addEventListener('push'");
    expect(body).toContain('self.registration.scope');
    expect(body).not.toContain("addEventListener('fetch'");
  });
});

describe('saving an event', () => {
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  };

  it('turns a Solar Hijri day into its date and returns to the calendar on it', async () => {
    const { saveEvent } = await import('@/lib/console-actions');
    await expect(
      saveEvent(
        { error: null, done: null },
        form({
          calendar: 'j',
          jy: '1405',
          jm: '8',
          jd: '20',
          title: 'جلسه',
          time: '18:30',
          repeat: 'weekly',
          remind_minutes: '60',
          back: '?view=week&cal=j&event=x',
        }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(calls.list[0]).toMatchObject({
      path: 'calendar/events',
      init: {
        method: 'POST',
        body: {
          title: 'جلسه',
          date: '2026-11-11',
          time: '18:30',
          repeat: 'weekly',
          remind_minutes: 60,
          repeat_until: null,
        },
      },
    });
    expect(calls.redirect).toBe('/agents/calendar?view=week&cal=j&day=2026-11-11');
  });

  it('refuses a day the month does not have, and changes an event by its id', async () => {
    const { saveEvent } = await import('@/lib/console-actions');
    expect(
      await saveEvent(
        { error: null, done: null },
        form({ calendar: 'j', jy: '1405', jm: '7', jd: '31', title: 'x' }),
      ),
    ).toEqual({
      error: 'این ماه چنین روزی ندارد.',
      done: null,
    });
    expect(calls.list).toEqual([]);
    await expect(
      saveEvent(
        { error: null, done: null },
        form({ id: 'abc', calendar: 'g', date: '2026-11-21', title: 'x', remind_minutes: '' }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(calls.list[0]).toMatchObject({
      path: 'calendar/events/abc',
      init: { method: 'PATCH', body: { date: '2026-11-21', remind_minutes: null } },
    });
  });
});
