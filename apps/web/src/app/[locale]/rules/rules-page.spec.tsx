import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The rules page in numbered sections (T-1789, D-410): the 1.0.0 text from
 * its migration, under eight headings with anchors and an "On this page"
 * index, English and left to right on every page; a version nobody checked
 * is plain blocks, as before. Rendered whole with the API mocked.
 */

const api = vi.hoisted(() => ({
  fetchPlatformRules: vi.fn(),
  fetchSession: vi.fn(),
}));
vi.mock('@/lib/api', () => api);
vi.mock('@/lib/session', () => ({ sessionCookieHeader: async () => undefined }));
vi.mock('@/lib/reader-time-zone-server', () => ({
  pageTimeZone: async () => ({ timeZone: 'Europe/London', chosen: false }),
}));
vi.mock('@/lib/rules-actions', () => ({ acceptRulesAction: async () => undefined }));

const { default: RulesPage } = await import('./page');

const V1 = /\$rules\$([\s\S]*?)\$rules\$/.exec(
  readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      '..',
      '..',
      'packages',
      'db',
      'migrations',
      '1765300000000_platform-rules-version.sql',
    ),
    'utf8',
  ),
)![1]!;

const PHYSICAL = /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/;

const draw = async (locale: string) =>
  renderToStaticMarkup(
    await RulesPage({
      params: Promise.resolve({ locale }),
      searchParams: Promise.resolve({}),
    }),
  );

const rules = (version: string) => ({
  ok: true,
  data: { version, body: V1, published_at: '2026-09-15T00:00:00Z' },
});

beforeEach(() => {
  api.fetchPlatformRules.mockResolvedValue(rules('platform-rules@1.0.0'));
  api.fetchSession.mockResolvedValue(null);
});

describe('the rules page (T-1789, D-410)', () => {
  it('shows 1.0.0 in eight numbered sections, each with its anchor', async () => {
    const html = await draw('en');
    const ids = [...html.matchAll(/data-testid="rules-section-([a-z-]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual([
      'joining',
      'what-this-place-is-for',
      'what-is-not-allowed',
      'your-rating-is-earned-and-is-shown',
      'reports-and-decisions',
      'appeals',
      'leaving',
      'changes',
    ]);
    expect(html).toContain('<section id="joining"');
    expect(html).toMatch(/<h2 id="joining-heading"[^>]*><span[^>]*>1<\/span>Joining<\/h2>/);
    // The lead-in left its paragraph; the paragraph's own words follow.
    expect(html).toContain('<p>You need an e-mail address you can receive mail at,');
    expect(html).not.toContain('Joining. You need');
    // Text with no lead-in stays in Leaving.
    expect(html).toContain('<p>The deletion is recorded (who asked and when)');
  });

  it('has an index of the eight: beside the text from 1024px, a closed details below', async () => {
    const html = await draw('en');
    const side = html.slice(html.indexOf('data-testid="rules-index"'));
    expect(side.slice(0, side.indexOf('</nav>'))).toContain('href="#changes"');
    const phone = html.slice(html.indexOf('data-testid="rules-index-phone"'));
    expect(phone.slice(0, phone.indexOf('</details>')).match(/href="#/g)).toHaveLength(8);
    expect(html).toMatch(/<details(?![^>]*\bopen\b)[^>]*data-testid="rules-index-phone"/);
    expect(html).toMatch(/<nav aria-label="On this page"/);
    expect(html).not.toMatch(PHYSICAL);
  });

  it('keeps the headings and the index English and left to right on the Persian page', async () => {
    const html = await draw('fa');
    expect(html).toContain('در این صفحه');
    expect(html).toMatch(/<article lang="en" dir="ltr"[^>]*data-testid="rules-body"/);
    expect(html).toMatch(/<ol lang="en" dir="ltr"/);
    expect(html).toContain('Your rating is earned and is shown</a>');
    expect(html).toContain('data-testid="rules-retention"');
  });

  it('shows a version nobody has checked as plain blocks, with no index', async () => {
    api.fetchPlatformRules.mockResolvedValue(rules('platform-rules@1.1.0'));
    const html = await draw('en');
    expect(html).not.toContain('rules-section-');
    expect(html).not.toContain('rules-index');
    expect(html).toContain('<p>Joining. You need an e-mail address');
  });
});
