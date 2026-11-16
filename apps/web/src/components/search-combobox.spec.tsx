import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { suggestWords } from '@/lib/search-suggest';

/**
 * The search field with suggestions (T-1844, D-435), as the server draws it:
 * the form's own `q` field as an ARIA combobox, its list there but hidden
 * until the reader types, and the live region empty. What it does while
 * typing is in `tests/e2e/search-suggest.spec.ts`.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { SearchCombobox } = await import('./search-combobox');

describe('the search combobox', () => {
  it('is the form field, a combobox tied to its list, closed and quiet', () => {
    const html = renderToStaticMarkup(
      <SearchCombobox
        variant="header"
        locale="en"
        words={suggestWords('en')}
        placeholder="Search"
        defaultValue="man utd"
        testId="nav-search-input"
      />,
    );
    const input = /<input[^>]*>/.exec(html)![0];
    expect(input).toContain('name="q"');
    expect(input).toContain('type="search"');
    expect(input).toContain('value="man utd"');
    expect(input).toContain('role="combobox"');
    expect(input).toContain('aria-autocomplete="list"');
    expect(input).toContain('aria-expanded="false"');
    expect(input).toContain('autoComplete="off"');
    expect(input).not.toContain('aria-activedescendant');
    const controls = /aria-controls="([^"]+)"/.exec(input)![1]!;
    expect(html).toContain(`id="${controls}" role="listbox" aria-label="Suggestions"`);
    // Closed: hidden, and nothing said yet.
    expect(html).toMatch(/<div hidden=""[^>]*data-testid="search-suggest-box"/);
    // The list holds only options and groups; what it says of itself is outside it.
    expect(html).not.toMatch(/role="listbox"[^>]*lang=/);
    expect(html).toContain('<span role="status" class="sr-only"></span>');
    // The header's list hangs from the field's end; logical properties only.
    expect(html).toContain('end-0 w-[372px]');
    expect(html).not.toMatch(/\b(left|right)-\d/);
  });

  it('gives the page field the row width, and its name when no label is tied to it', () => {
    const html = renderToStaticMarkup(
      <SearchCombobox
        variant="page"
        locale="fa"
        words={suggestWords('fa')}
        label="تیم، رقابت، بازیکن"
        testId="search-input"
      />,
    );
    expect(html).toContain('aria-label="تیم، رقابت، بازیکن"');
    expect(html).toContain('start-0 end-0');
    expect(html).toContain('aria-label="پیشنهادها"');
  });
});
