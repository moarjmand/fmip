import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * «اعلان درخواست‌های تازه» (T-1832, D-425): the switch's state from the
 * server's answer and this browser's, honest about a browser that cannot or
 * may not show notifications, and the iPhone note always there.
 */

vi.mock('@/lib/console-actions', () => ({
  registerReminderDevice: async () => ({ ok: true, error: null }),
  setRequestAlerts: async () => ({ ok: true, error: null }),
}));

const { ALERT_WORDS, RequestAlerts, alertView } = await import('./request-alerts');

describe('alertView', () => {
  const base = { configured: true, support: 'ready' as const, wanted: false, subscribed: false };

  it('says the server cannot send before anything else', () => {
    expect(alertView({ ...base, configured: false, wanted: true, subscribed: true })).toBe(
      'absent',
    );
  });

  it('is off until the person switches it on', () => {
    expect(alertView(base)).toBe('off');
    expect(alertView({ ...base, subscribed: true })).toBe('off');
  });

  it('is on here only when wanted and this browser is registered', () => {
    expect(alertView({ ...base, wanted: true, subscribed: true })).toBe('on');
    expect(alertView({ ...base, wanted: true, subscribed: false })).toBe('on_elsewhere');
  });

  it('is honest about a browser that cannot or may not notify', () => {
    expect(alertView({ ...base, support: 'unsupported' })).toBe('unsupported');
    expect(alertView({ ...base, support: 'denied' })).toBe('denied');
    // Wanted, but blocked here: the other browsers still get it.
    expect(alertView({ ...base, support: 'denied', wanted: true })).toBe('on_elsewhere');
    expect(alertView({ ...base, support: 'checking' })).toBe('checking');
  });

  it('words every state in Persian, with the iPhone way for an unsupported browser', () => {
    for (const words of Object.values(ALERT_WORDS)) expect(words).toMatch(/[؀-ۿ]/);
    expect(ALERT_WORDS.unsupported).toContain('افزودن به صفحهٔ اصلی');
  });
});

describe('the switch on the server', () => {
  const render = (configured: boolean, wanted = false) =>
    renderToStaticMarkup(
      <RequestAlerts
        configured={configured}
        publicKey="BKEY"
        wanted={wanted}
        workerUrl="/agents/reminders-worker"
        scope="/agents/"
      />,
    );

  it('draws a labelled switch that waits for the browser, with the iPhone note', () => {
    const html = render(true, true);
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-labelledby="request-alerts-label"');
    expect(html).toContain('اعلان درخواست‌های تازه');
    expect(html).toContain('data-view="checking"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('در آیفون، اعلان فقط وقتی می‌رسد');
    expect(html).toContain('نه درخواست خود شما');
  });

  it('says so when the server cannot send', () => {
    const html = render(false);
    expect(html).toContain('data-view="absent"');
    expect(html).toContain(ALERT_WORDS.absent);
  });

  it('uses logical sides only', () => {
    expect(render(true)).not.toMatch(/\b(ml|mr|pl|pr|left|right)-|translate-x/);
  });
});
