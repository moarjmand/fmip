import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { resolveMessages } from '@/i18n/messages';
import { FreshnessStamp } from './freshness-stamp';

/**
 * The freshness stamp (rule 4; the Design System's `Freshness`, T-1493):
 * quiet while the surface is within its threshold, the warning saffron and a
 * triangle past it, and nothing at all without a clock.
 */

const WORDS = resolveMessages('en', ['freshness.checked', 'freshness.behind']);
const NOW = Date.parse('2026-10-11T10:00:00.000Z');

const stamp = (agoMs: number, extra: { behind?: boolean; locale?: string } = {}) =>
  renderToStaticMarkup(
    <FreshnessStamp
      checkedAt={NOW - agoMs}
      now={NOW}
      staleAfterMs={45_000}
      behind={extra.behind}
      locale={extra.locale ?? 'en'}
      words={
        extra.locale === 'fa'
          ? resolveMessages('fa', ['freshness.checked', 'freshness.behind'])
          : WORDS
      }
    />,
  );

describe('FreshnessStamp', () => {
  it('says how long ago the check was, in the caption colour and the mono face, after a dot', () => {
    const html = stamp(8_000);
    expect(html).toContain('data-freshness="current"');
    expect(html).toContain('font-mono');
    expect(html).toContain('text-caption');
    expect(html).toContain('<span aria-hidden="true">●</span>');
    expect(html).toMatch(/Last checked <time[^>]*>8 sec(\.)? ago<\/time>/);
    expect(html).not.toContain('may be behind');
  });

  it('turns to the warning colour and a triangle, and says "may be behind", past the threshold', () => {
    const html = stamp(4 * 60_000);
    expect(html).toContain('data-freshness="behind"');
    expect(html).toContain('text-warning');
    // Not colour alone: the mark changes shape and the words say it.
    expect(html).toContain('<span aria-hidden="true">▲</span>');
    expect(html).toMatch(/4 min(\.)? ago<\/time> · may be behind/);
  });

  it('is behind whenever the surface already knows it is, however recent the last word', () => {
    expect(stamp(2_000, { behind: true })).toContain('data-freshness="behind"');
  });

  it('carries a machine-readable time for the check', () => {
    expect(stamp(8_000)).toContain('<time dateTime="2026-10-11T09:59:52.000Z">');
  });

  it('speaks Persian with Persian digits, in the interface face rather than the mono', () => {
    const html = stamp(8_000, { locale: 'fa' });
    expect(html).toContain('آخرین بررسی');
    expect(html).toContain('۸ ثانیه پیش');
    expect(html).toContain('[:root:is(:lang(fa),:lang(ar))_&amp;]:font-sans');
  });

  it('shows nothing without a clock, or with a time it cannot read', () => {
    const none = (checkedAt: number | string, now: number | undefined) =>
      renderToStaticMarkup(
        <FreshnessStamp
          checkedAt={checkedAt}
          now={now}
          staleAfterMs={45_000}
          locale="en"
          words={WORDS}
        />,
      );
    expect(none(NOW, undefined)).toBe('');
    expect(none('not a time', NOW)).toBe('');
  });

  it('writes no colour of its own and no physical side', () => {
    const html = stamp(8_000) + stamp(4 * 60_000);
    expect(html).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(|\b(?:ml|mr|pl|pr|left|right)-/i);
  });
});
