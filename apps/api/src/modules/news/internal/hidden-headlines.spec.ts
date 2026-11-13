import { describe, expect, it } from 'vitest';
import { HIDDEN_HEADLINES, hiddenHeadline } from './hidden-headlines';

describe('hiddenHeadline (T-1818, D-413)', () => {
  it('names every entry with its decision', () => {
    for (const entry of HIDDEN_HEADLINES) {
      expect(entry.key).toMatch(/^[a-z-]+$/);
      expect(entry.decision).toMatch(/^D-\d+$/);
      expect(entry.startsWith.trim()).toBe(entry.startsWith);
    }
  });

  it('hides an invitation to watch a match live on the publisher’s site', () => {
    // The shape of finding cnt-2026-11-04-02's headlines.
    for (const headline of [
      'پخش زنده بازی استقلال و پرسپولیس + تماشای رایگان',
      'پخش زنده بازی رئال مادرید - بارسلونا',
      'پخش زنده بازی',
      '  پخش  زنده   بازی منچستر سیتی',
      // Written with the Arabic yeh, as some feeds do.
      'پخش زنده باز\u064A سپاهان',
      'پخش زنده بازی: تراکتور و گل گهر',
    ]) {
      expect(hiddenHeadline(headline), headline).toBe('live-stream-invitation');
    }
  });

  it('shows everything else, the same words elsewhere or as part of a longer word', () => {
    for (const headline of [
      'حق پخش زنده بازی‌ها به صداوسیما رسید',
      'پخش زنده بازی‌های جام جهانی از شبکه سه',
      'پخش زنده‌ی دیدار امشب لغو شد',
      'Live stream: Arsenal v Chelsea',
      'سرمربی استقلال: پخش زنده بازی را ندیدم',
      '',
    ]) {
      expect(hiddenHeadline(headline), headline).toBeNull();
    }
  });
});
