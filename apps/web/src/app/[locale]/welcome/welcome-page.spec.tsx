import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/welcome` (T-620), rendered whole with the API mocked, on its time-zone
 * step (the one step drawn without a fetch of its own). What it is checked
 * for here: the testers' "Send feedback" line under the steps when the
 * contact mailbox is set, and nothing when it is not (T-1965, D-465).
 */

vi.mock('@/lib/api', () => ({
  fetchMe: async () => null,
  fetchOwnProfile: async () => ({ ok: false, status: 401 }),
  fetchFollowing: async () => null,
  fetchTeams: async () => [],
  fetchTerritories: async () => [],
}));
vi.mock('@/lib/session', () => ({ sessionCookieHeader: async () => undefined }));
vi.mock('@/lib/first-run-cookie', () => ({ readGuestChoices: async () => ({}) }));
vi.mock('@/lib/first-run-actions', () => ({
  saveFirstRunStepAction: async () => undefined,
  finishFirstRunAction: async () => undefined,
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/en/welcome' }));
vi.mock('next/server', () => ({ connection: async () => undefined }));

const { default: WelcomePage } = await import('./page');

async function render(locale = 'en'): Promise<string> {
  const element = await WelcomePage({
    params: Promise.resolve({ locale }),
    searchParams: Promise.resolve({ step: 'timezone' }),
  });
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  vi.stubEnv('SITE_CONTACT_EMAIL', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/welcome', () => {
  it('has no feedback line without a contact mailbox (rule 3)', async () => {
    const html = await render();
    expect(html).toContain('data-testid="first-run-steps"');
    expect(html).not.toContain('feedback');
  });

  it('ends on "Send feedback", an e-mail naming this page, in English and in Persian', async () => {
    vi.stubEnv('SITE_CONTACT_EMAIL', 'feedback@example.test');
    const html = await render();
    expect(html).toContain('data-testid="welcome-feedback-line"');
    expect(html.indexOf('first-run-finish')).toBeLessThan(html.indexOf('welcome-feedback-line'));
    expect(html).toContain('Something unclear, wrong or missing? Write to us by e-mail:');
    const subject = encodeURIComponent('Feedback on Stadiomind, from /en/welcome');
    expect(html).toContain(`href="mailto:feedback@example.test?subject=${subject}"`);
    const fa = await render('fa');
    expect(fa).toContain('چیزی نامفهوم، نادرست یا ناقص است؟ با ایمیل برای ما بنویسید:');
    expect(fa).toContain('>ارسال بازخورد</a>');
  });
});
