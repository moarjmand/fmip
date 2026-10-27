import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SectionTabs } from './section-tabs';

/** Section tabs inside a page (the Design System's `Tabs`, T-1510). */

const html = renderToStaticMarkup(
  <SectionTabs
    label="Sections"
    testId="team-tab"
    tabs={[
      { key: 'overview', href: '/en/team/t1', label: 'Overview', current: true },
      { key: 'squad', href: '/en/team/t1?tab=squad', label: 'Squad', current: false },
    ]}
  />,
);

describe('SectionTabs', () => {
  it('is a named row of links, each tab a URL of its own', () => {
    expect(html).toMatch(/^<nav aria-label="Sections"/);
    expect(html).toContain('data-testid="team-tab"');
    expect(html).toContain('href="/en/team/t1?tab=squad"');
    expect(html).toContain('data-testid="team-tab-squad"');
  });

  it('marks the open tab in aria-current, ink and bold over the saffron rule, and only that one', () => {
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*border-accent font-extrabold text-fg/);
    expect(html).toMatch(/border-transparent font-semibold text-muted[^>]*>Squad</);
  });

  it('scrolls sideways rather than wrapping, with 44px targets', () => {
    expect(html).toContain('overflow-x-auto');
    expect(html).toContain('whitespace-nowrap');
    expect(html).toContain('min-h-touch');
    expect(html).not.toContain('flex-wrap');
  });

  it('opens the row scrolled to the open tab, and only to that one (T-1564)', () => {
    expect(html.match(/scroll-initial-target/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*\[scroll-initial-target:nearest\]/);
  });

  it('writes no colour of its own and no physical side', () => {
    expect(html).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(|\b(?:ml|mr|pl|pr|left|right)-/i);
  });
});
