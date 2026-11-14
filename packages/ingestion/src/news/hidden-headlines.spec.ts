import { describe, expect, it } from 'vitest';
import { HIDDEN_HEADLINES, hiddenHeadline } from './hidden-headlines';

/** Headlines as production stored them (Khabar Varzeshi, 2026-09-29..11-12), and the reports beside them. */
describe('hiddenHeadline (T-1818, D-413)', () => {
  it('names every entry with its decision and at least one marker', () => {
    for (const entry of HIDDEN_HEADLINES) {
      expect(entry.key).toMatch(/^[a-z-]+$/);
      expect(entry.decision).toMatch(/^D-\d+$/);
      expect(entry.startsWith.trim()).toBe(entry.startsWith);
      expect(entry.markers.length).toBeGreaterThan(0);
    }
  });

  it('hides an invitation to watch a match on the publisher’s site', () => {
    for (const headline of [
      'پخش زنده بازی آرسنال و اورتون/ تماشای زنده و رایگان لیگ برتر در سایت خبرورزشی',
      'پخش زنده بازی آرسنال و هال سیتی/ تماشای رایگان لیگ برتر انگلیس در خبرورزشی',
      'پخش زنده بازی بارسلونا و آلاوس/ تماشای آنلاین لالیگا در خبرورزشی',
      'پخش زنده بازی آرسنال و لیدزیونایتد/ تماشای اینترنتی لیگ برتر انگلیس',
      'پخش زنده بازی استقلال و پرسپولیس + لینک تماشا',
      'پخش زنده بازی سپاهان و تراکتور آنلاین',
      '  پخش  زنده   بازی منچستر سیتی/ تماشای رایگان',
      // Arabic yeh and alef maksura, as some feeds write them.
      'پخش زنده بازي سپاهان / تماشا',
      'پخش زنده بازى سپاهان / تماشا',
      // A right-to-left mark before the headline.
      '‏پخش زنده بازی رم و میلان/ تماشای آنلاین',
      'پخش زنده بازی: تراکتور و گل گهر، تماشای رایگان',
    ]) {
      expect(hiddenHeadline(headline), headline).toBe('live-stream-invitation');
    }
  });

  it('shows a report that starts with the same words but invites nobody to watch', () => {
    for (const headline of [
      'پخش زنده بازی ایران و آمریکا لغو شد',
      'پخش زنده بازی پرسپولیس از شبکه سه',
      // Six such Khabar Varzeshi headlines carry no marker and stay shown (D-413).
      'پخش زنده بازی اتلتیکومادرید و بارسلونا با گزارش عادل فردوسی‌پور',
      // A marker only as a whole word: the spectators («تماشاگران») of a report are no invitation.
      'پخش زنده بازی پرسپولیس لغو شد؛ تماشاگران معترض شدند',
      'پخش زنده بازی برای تماشاچیان ورزشگاه آزادی پخش نمی‌شود',
    ]) {
      expect(hiddenHeadline(headline), headline).toBeNull();
    }
  });

  it('shows everything else: the words elsewhere, or as part of a longer word', () => {
    for (const headline of [
      'حق پخش زنده بازی‌ها به صداوسیما رسید؛ تماشای رایگان ممنوع',
      'پخش زنده بازی‌های جام جهانی از شبکه سه/ تماشای آنلاین',
      'پخش زنده‌ی دیدار امشب لغو شد',
      'تاخیر در پخش زنده و تماشای تبلیغات به جای بازی روسیه - ایران!',
      'Live stream: Arsenal v Chelsea',
      '',
    ]) {
      expect(hiddenHeadline(headline), headline).toBeNull();
    }
  });
});
