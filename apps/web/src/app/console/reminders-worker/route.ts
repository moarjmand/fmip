/**
 * The console's service worker for calendar reminders (T-1788, D-391), at
 * `<console base>/reminders-worker`: no file extension, because the proxy
 * leaves a path with one to the site's static files. Its scope is the
 * console's base, so it never controls a site page, and it does nothing but
 * show a reminder and open the calendar on a click; no fetch handler, no
 * cache. A reminder's `url` is relative to the scope (`calendar?day=...`), so
 * the same message opens the right page under `/agents` and on the console's
 * own host.
 */
const WORKER = `'use strict';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('push', (event) => {
  let payload = { title: 'یادآور تقویم', body: '', url: 'calendar' };
  try {
    payload = Object.assign(payload, event.data ? event.data.json() : {});
  } catch (error) {
    // A payload that is not JSON is shown as the title alone.
  }
  const url = new URL(String(payload.url || 'calendar'), self.registration.scope).href;
  event.waitUntil(
    self.registration.showNotification(String(payload.title), {
      body: String(payload.body || ''),
      dir: 'rtl',
      lang: 'fa',
      tag: url,
      renotify: true,
      data: { url },
    }),
  );
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url === url);
      if (open) return open.focus();
      return self.clients.openWindow(url);
    }),
  );
});
`;

export function GET(): Response {
  return new Response(WORKER, {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    },
  });
}
