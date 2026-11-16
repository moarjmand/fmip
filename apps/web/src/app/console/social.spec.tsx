import type { SocialConsoleView } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SOCIAL_VIEW } from './social.fixture';
import { SocialTab, queueItems } from './social';
import { apiErrorWords } from './words';

vi.mock('@/lib/console-actions', () => {
  const action = async () => ({ error: null, done: null });
  return {
    approveSocial: action,
    rejectSocial: action,
    editSocial: action,
    settleSocial: action,
    setSocialSwitch: action,
    setSocialLevel: action,
    setSocialKey: action,
    clearSocialKey: action,
  };
});

const page = (view: SocialConsoleView = SOCIAL_VIEW) =>
  renderToStaticMarkup(<SocialTab view={view} />);

/** Whether one `<input>` of the markup carries every one of the attributes (in any order). */
const input = (html: string, ...attrs: string[]) =>
  [...html.matchAll(/<input[^>]*>/g)].some((m) => attrs.every((a) => m[0].includes(a)));

/** The markup of every `<form>`: what a person can post. */
const forms = (html: string) => [...html.matchAll(/<form[\s\S]*?<\/form>/g)].map((m) => m[0]);

describe('the social tab (T-1836)', () => {
  it('shows each queue item once, with its card and both captions inside left-to-right blocks', () => {
    const html = page();
    expect(queueItems(SOCIAL_VIEW.queue)).toHaveLength(2);
    // The card route of T-1835, the same picture Buffer fetches.
    expect(html).toContain(`src="/social-card/${SOCIAL_VIEW.queue[0]!.id}/card.png"`);
    for (const post of SOCIAL_VIEW.queue) {
      const caption = post.body.split('\n')[0]!.replace(/&/g, '&amp;');
      expect(html).toMatch(new RegExp(`<pre dir="ltr" lang="en"[^>]*>${caption}`));
    }
    expect(html).toContain('موضوع حساس: شرط‌بندی');
    expect(html).toContain('تازگی داده');
    expect(html).toContain('باید پیش از شروع بازی منتشر شود');
  });

  it('counts today against the cap of five per network and each kind toward 14 clean posts', () => {
    const html = page();
    expect(html).toContain('۳ از ۵');
    expect(html).toContain('۱ از ۵');
    expect(html).toContain('پست پاک پشت‌سرهم: ۹ از ۱۴');
    expect(html).toContain('آماده‌ی خودکار شدن (۱۴ پست پاک)');
  });

  it('gives the owner the level and key controls, and the teammate neither (the API refuses them anyway)', () => {
    const owner = page();
    expect(owner).toContain('name="level"');
    // The raise is open only from eligible: the forecast kind (9 of 14) has it disabled.
    const forecastLevel = forms(owner).find((f) => f.includes('value="forecast_pre_match"'))!;
    expect(input(forecastLevel, 'value="automatic"', 'disabled')).toBe(true);
    const verdictLevel = forms(owner).find((f) => f.includes('value="model_verdict"'))!;
    expect(input(verdictLevel, 'value="automatic"', 'disabled')).toBe(false);
    const keyForm = forms(owner).find((f) => f.includes('name="key"'))!;
    expect(input(keyForm, 'name="key"', 'type="password"')).toBe(true);
    expect(input(keyForm, 'name="key"', 'autoComplete="off"')).toBe(true);
    // Write-only: the field is never filled back.
    expect(input(keyForm, 'name="key"', 'value=')).toBe(false);

    const mate = page({ ...SOCIAL_VIEW, viewer: { name: 'مریم', owner: false } });
    expect(mate).not.toContain('name="level"');
    expect(mate).not.toContain('name="key"');
    expect(mate).toContain('فقط مالک کنسول کلید را وارد یا پاک می‌کند.');
    // Both accounts stop and resume publishing.
    expect(mate).toContain('توقف همه‌ی ارسال‌ها');
  });

  it('says who set the key and when, never the key', () => {
    const html = page();
    expect(html).toContain('توسط <bdi dir="ltr" lang="en">mostafa</bdi>');
    const rejected = page({
      ...SOCIAL_VIEW,
      key: { state: 'rejected', set_at: '2026-11-15T20:00:00Z', set_by: 'mostafa' },
      health: { ...SOCIAL_VIEW.health, key: 'rejected' },
    });
    expect(rejected).toContain('Buffer کلید را نپذیرفت؛ کلید را دوباره وارد کنید.');
    expect(rejected).toContain('role="alert"');
    expect(page({ ...SOCIAL_VIEW, key: { state: 'not_set' } })).toContain('تنظیم نشده است');
  });

  it('when stopped: an alert with who, when and why, approval off, and resume for either account', () => {
    const stopped: SocialConsoleView = {
      ...SOCIAL_VIEW,
      viewer: { name: 'مریم', owner: false },
      switch: {
        stopped: true,
        changed_at: '2026-11-16T09:00:00Z',
        changed_by: 'maryam',
        reason: 'بررسی متن‌ها',
      },
    };
    const html = page(stopped);
    expect(html).toContain('ارسال خودکار متوقف است');
    expect(html).toContain('بررسی متن‌ها');
    expect(html).toMatch(/<button type="button" disabled=""[^>]*>تأیید و ارسال به Buffer/);
    expect(forms(html).some((f) => f.includes('تأیید و ارسال به Buffer'))).toBe(false);
    expect(html).toContain('از سرگیری ارسال');
    expect(html).toContain('value="false"');
  });

  it('asks for a reason on every change it offers', () => {
    for (const form of forms(page())) {
      if (form.includes('name="key"') && !form.includes('name="reason"')) continue; // setting the key
      if (form.includes('تأیید و ارسال')) continue; // an approval takes none (D-427 point 8)
      expect(
        input(form, 'name="reason"', 'required') || input(form, 'name="note"', 'required'),
        form.slice(0, 160),
      ).toBe(true);
    }
  });

  it('settles an unknown post as published or not, and shows the history with its links', () => {
    const html = page();
    expect(html).toContain('بی‌پاسخ از شبکه');
    expect(html).toContain('name="state" value="published"');
    expect(html).toContain('https://traveltohormuz.ir/en/match/fx-2');
    expect(html).toContain('متن یا لحن: خط دوم بهتر شود');
    // The trail: Persian actions, the previous value as data.
    expect(html).toContain('رد پست');
    expect(html).toMatch(/<bdi dir="ltr" lang="en"[^>]*>state: pending_approval · clean_run: 9/);
  });

  it('says an empty queue, and an unread page, in Persian', async () => {
    expect(page({ ...SOCIAL_VIEW, queue: [] })).toContain('صف خالی است.');
    vi.resetModules();
    vi.doMock('@/lib/console-api', () => ({
      consoleSocial: async () => ({ ok: false, status: 0, error: null, setCookie: null }),
    }));
    const { default: Page } = await import('./(app)/social/page');
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain('وضعیت پست‌ها اکنون خوانده نمی‌شود');
    vi.doUnmock('@/lib/console-api');
  });

  it("words the API's refusals in Persian, naming a failing gate", () => {
    expect(apiErrorWords('A gate fails now: freshness, coverage.', 'x')).toBe(
      'این پست اکنون از شرط‌ها نمی‌گذرد: تازگی داده، پوشش داده.',
    );
    expect(apiErrorWords('Only the console owner changes a level.', 'x')).toContain('مالک');
    expect(apiErrorWords('A kind is raised only after 14 clean posts in a row.', 'x')).toContain(
      '۱۴',
    );
  });
});
