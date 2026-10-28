import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MatchesFreshness } from './matches-freshness';

/**
 * The club and competition pages' footer (T-1633, D-296): what the time is
 * of (the matches), when the provider last answered the list and when a match
 * on it last changed, each saying its day unless it is today (D-189).
 */

// Wednesday 28 October 2026, 11:30 UTC; Manchester City's case on that day.
const NOW = Date.parse('2026-10-28T11:30:00.000Z');
const CHANGED = '2026-10-24T13:24:24.595Z';
const CHECKED = '2026-10-28T04:07:32.986Z';

const text = (html: string) => html.replace(/<[^>]+>/g, '');

const footer = (
  checkedAt: string | null | undefined,
  locale = 'en',
  timeZone = 'Europe/London',
  changedAt = CHANGED,
) =>
  renderToStaticMarkup(
    <MatchesFreshness
      changedAt={changedAt}
      checkedAt={checkedAt}
      locale={locale}
      timeZone={timeZone}
      now={NOW}
    />,
  );

describe('MatchesFreshness', () => {
  it('says when the matches were last checked and since when they are unchanged', () => {
    const html = footer(CHECKED);
    expect(text(html)).toMatch(
      /^Matches last checked 04:07; unchanged since 4 days ago \(24 Oct 2026, 14:24\)$/,
    );
    expect(html).toContain(`<time dateTime="${CHECKED}">`);
    expect(html).toContain(`<time dateTime="${CHANGED}">`);
  });

  it('says the last change alone, as the matches’ change, with no newer check', () => {
    expect(text(footer(null))).toMatch(/^Matches last changed 4 days ago \(24 Oct 2026, 14:24\)$/);
    expect(text(footer(undefined))).toMatch(/^Matches last changed /);
    // A check older than the change says nothing the change does not.
    expect(text(footer('2026-10-20T04:07:00.000Z'))).toMatch(/^Matches last changed /);
  });

  it('names UTC when that is the zone the page is drawn in', () => {
    expect(text(footer(CHECKED, 'en', 'UTC'))).toMatch(
      /^Matches last checked 04:07 UTC; unchanged since 4 days ago \(24 Oct 2026, 13:24\) UTC$/,
    );
  });

  it('is Persian on /fa, with Persian digits', () => {
    const words = text(footer(CHECKED, 'fa', 'Asia/Tehran'));
    expect(words).toContain('آخرین بررسی بازی‌ها');
    expect(words).toContain('بدون تغییر از');
    expect(words).not.toMatch(/[0-9]/);
    expect(words).not.toContain('Matches');
  });
});
