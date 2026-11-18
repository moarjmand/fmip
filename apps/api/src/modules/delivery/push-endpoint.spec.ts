import { describe, expect, it } from 'vitest';
import { PUSH_ENDPOINT_MAX, isPushServiceEndpoint, isPushServiceHost } from './push-endpoint';

/**
 * The push services a subscription may name (T-1880): the browsers' own, over
 * https on the default port, and nothing a caller could point elsewhere.
 */
describe('push service endpoints (T-1880)', () => {
  it('takes the endpoints the browsers hand out', () => {
    for (const endpoint of [
      'https://fcm.googleapis.com/fcm/send/dQw4w9WgXcQ:APA91bHPRgkF3JUikC4ENAHEeMrd41Zxv3hVZjC9KtT8OvPVGJ-hQMRKRrZuJAEcl7B338qju59zJMjw2DELjzEvxwYv7hH5Ynpc1ODQ0aT4U4OFEeco8ohsN5PjL1iC2dNtk2BAokeMCg2ZXKqpc8FXKmhX94kIxQ',
      'https://updates.push.services.mozilla.com/wpush/v2/gAAAAABl0x3_9Zc1mB-kq',
      'https://autopush.push.services.mozilla.com/wpush/v1/abc',
      'https://wns2-par02p.notify.windows.com/w/?token=BQYAAAD%2bd3Jk%2fAbc%3d',
      'https://db5p.notify.windows.com/w/?token=AwYAAAC',
      'https://web.push.apple.com/QGuQyavXutnMH9RHpMDTt5F5K8mmAI',
      'https://api.push.apple.com/3/device/abc',
    ]) {
      expect(isPushServiceEndpoint(endpoint), endpoint).toBe(true);
    }
  });

  it('refuses any other host, however much it looks like one', () => {
    for (const endpoint of [
      'https://example.com/push',
      'https://push.example/abc',
      'https://localhost/x',
      'https://api.internal/x',
      'https://fcm.googleapis.com.example.com/fcm/send/x',
      'https://example.com/fcm.googleapis.com/fcm/send/x',
      'https://example.com/?h=fcm.googleapis.com',
      'https://example.com/#fcm.googleapis.com',
      'https://evilnotify.windows.com/w/',
      'https://notify.windows.com/w/',
      'https://push.apple.com/x',
      'https://push.services.mozilla.com/x',
      'https://googleapis.com/fcm/send/x',
      'https://xfcm.googleapis.com/fcm/send/x',
      'https://fcm.googleapis.com./fcm/send/x',
      'https://a..notify.windows.com/w/',
      'https://-a.notify.windows.com/w/',
    ]) {
      expect(isPushServiceEndpoint(endpoint), endpoint).toBe(false);
    }
  });

  it('refuses an IP literal, a port, a user, and anything but https', () => {
    for (const endpoint of [
      'https://127.0.0.1/x',
      'https://10.0.0.5/x',
      'https://169.254.169.254/latest/meta-data/',
      'https://[::1]/x',
      'https://[fd00::1]/x',
      'https://2130706433/x',
      'https://0x7f.1/x',
      'https://fcm.googleapis.com:8443/fcm/send/x',
      'https://fcm.googleapis.com:80/fcm/send/x',
      'https://fcm.googleapis.com:443/fcm/send/x',
      'https://user@fcm.googleapis.com/fcm/send/x',
      'https://user:secret@fcm.googleapis.com/fcm/send/x',
      'https://fcm.googleapis.com@example.com/fcm/send/x',
      'http://fcm.googleapis.com/fcm/send/x',
      'ftp://fcm.googleapis.com/fcm/send/x',
      'file:///etc/passwd',
      '//fcm.googleapis.com/fcm/send/x',
      'fcm.googleapis.com/fcm/send/x',
    ]) {
      expect(isPushServiceEndpoint(endpoint), endpoint).toBe(false);
    }
  });

  it('refuses an address a second parser could read differently', () => {
    for (const endpoint of [
      'https://example.com\\@fcm.googleapis.com/fcm/send/x',
      'https://fcm.googleapis.com\\@example.com/fcm/send/x',
      'https://FCM.googleapis.com/fcm/send/x',
      'https://fcm.googleapis.com/fcm/send/x y',
      ' https://fcm.googleapis.com/fcm/send/x',
      'https://fcm.googleapis.com/fcm/send/x\n',
      'https://fcm.googleapis.com/fcm/../send/x',
      'https:/fcm.googleapis.com/fcm/send/x',
      'https://fcm.googleapis.com',
    ]) {
      expect(isPushServiceEndpoint(endpoint), JSON.stringify(endpoint)).toBe(false);
    }
  });

  it('refuses what is not text, and what is too long', () => {
    for (const endpoint of [undefined, null, 7, {}, ['https://fcm.googleapis.com/x'], '']) {
      expect(isPushServiceEndpoint(endpoint)).toBe(false);
    }
    const base = 'https://fcm.googleapis.com/fcm/send/';
    expect(isPushServiceEndpoint(base + 'a'.repeat(PUSH_ENDPOINT_MAX - base.length))).toBe(true);
    expect(isPushServiceEndpoint(base + 'a'.repeat(PUSH_ENDPOINT_MAX - base.length + 1))).toBe(
      false,
    );
  });

  it('judges a host by whole labels', () => {
    expect(isPushServiceHost('fcm.googleapis.com')).toBe(true);
    expect(isPushServiceHost('a.b.notify.windows.com')).toBe(true);
    expect(isPushServiceHost('.notify.windows.com')).toBe(false);
    expect(isPushServiceHost('notify.windows.com')).toBe(false);
    expect(isPushServiceHost('a_b.notify.windows.com')).toBe(false);
    expect(isPushServiceHost('')).toBe(false);
  });
});
