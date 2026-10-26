import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shortName } from '@/lib/language-switch';
import { LanguagePicker } from './language-picker';

/**
 * The language picker drawn (T-1610, D-281): the header's globe with the
 * page's language in short, a disclosure listing every offered language in
 * its own name with the page's own current; the footer's row of the same
 * links; nothing at all with one language. `lib/language-picker.spec.ts`
 * covers which languages are offered and where each link leads.
 */

let pathname = '/en/scores';
let search = '';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
}));

const CSS = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
const utility = (name: string): string =>
  new RegExp(`@utility ${name} \\{([\\s\\S]*?)\\n\\}`).exec(CSS)?.[1] ?? '';

const BOTH = [
  { locale: 'en', autonym: 'English' },
  { locale: 'fa', autonym: 'فارسی' },
] as const;

const draw = (props: Partial<Parameters<typeof LanguagePicker>[0]> = {}) =>
  renderToStaticMarkup(<LanguagePicker languages={BOTH} label={{ text: 'Language' }} {...props} />);

/** The opening tag of the element with this test id. */
const tag = (html: string, testId: string): string =>
  new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`).exec(html)?.[0] ?? '';

beforeEach(() => {
  pathname = '/en/scores';
  search = '';
});

describe('the header’s picker', () => {
  it('is a disclosure: a globe, the word for a screen reader, the page’s language in short', () => {
    const html = draw();
    expect(tag(html, 'language-picker')).toMatch(/^<details/);
    const summary = /<summary[^>]*>([\s\S]*?)<\/summary>/.exec(html)?.[1] ?? '';
    expect(summary).toContain('<svg');
    // The word is seen in the phone's Menu and kept for a screen reader in the bar.
    expect(summary).toContain('<span class="lg:sr-only">Language</span>');
    expect(summary).toContain('<span aria-hidden="true" lang="en">EN</span>');
    expect(summary).toContain('<span class="sr-only" lang="en">English</span>');
    expect(tag(html, 'language-toggle')).toContain('lang-toggle');
  });

  it('lists every offered language in its own name, the page’s own current, each to this page', () => {
    search = 'date=2026-10-26';
    const html = draw();
    expect(tag(html, 'language-en')).toContain('aria-current="page"');
    expect(tag(html, 'language-en')).toContain('href="/en/scores?date=2026-10-26"');
    expect(tag(html, 'language-fa')).not.toContain('aria-current');
    expect(tag(html, 'language-fa')).toContain('href="/fa/scores?date=2026-10-26"');
    expect(tag(html, 'language-fa')).toContain('lang="fa"');
    expect(tag(html, 'language-fa')).toMatch(/hreflang="fa"/i);
    expect(html).toContain('>فارسی</a>');
    expect(html).toContain('>English</a>');
  });

  it('shows «فا» on a Persian page', () => {
    pathname = '/fa/scores';
    const html = draw({ label: { text: 'زبان' } });
    expect(html).toContain('<span aria-hidden="true" lang="fa">فا</span>');
    expect(tag(html, 'language-fa')).toContain('aria-current="page"');
    expect(shortName('fa')).toBe('فا');
    expect(shortName('de')).toBe('DE');
  });

  it('draws its targets 44px tall and its panel at the control’s inline end from 1024px', () => {
    expect(utility('lang-toggle')).toMatch(/@apply [^;]*min-h-touch[^;]*min-w-touch/);
    expect(utility('lang-entry')).toMatch(/@apply [^;]*min-h-touch/);
    expect(utility('lang-entry')).toMatch(
      /&\[aria-current='page'\] \{\s*@apply font-bold text-fg;/,
    );
    expect(utility('lang-panel')).toMatch(/lg:absolute lg:end-0/);
    expect(utility('lang-panel')).not.toMatch(/\b(left|right)-/);
  });

  it('renders nothing when one language is offered: one is not a choice', () => {
    expect(draw({ languages: [BOTH[0]] })).toBe('');
  });
});

describe('the footer’s row', () => {
  it('lists the same links under the word, nothing to open, with its own test ids', () => {
    const html = draw({ variant: 'list', testIdPrefix: 'footer-' });
    expect(html).not.toContain('<details');
    expect(tag(html, 'footer-language-picker')).toMatch(/role="group"/);
    expect(tag(html, 'footer-language-en')).toContain('aria-current="page"');
    expect(tag(html, 'footer-language-fa')).toContain('href="/fa/scores"');
    expect(html).not.toContain('data-testid="language-');
    expect(tag(html, 'footer-language-fa')).toContain('footer-link');
  });
});
