import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PasswordReveal, ZoneLine } from './register-controls';

/**
 * The register form's two controls with state (T-1737, D-358): what each
 * draws before any script runs, and that they are not part of the form
 * component every page shares. What a press and a refused submit do is
 * walked in a browser by `tests/e2e/journeys/register-form.spec.ts`.
 */
const read = (name: string) => readFileSync(join(__dirname, name), 'utf8');

describe('PasswordReveal', () => {
  it('starts as Show, a button that does not submit, naming the field it shows', () => {
    const html = renderToStaticMarkup(<PasswordReveal show="Show" hide="Hide" field="Password" />);
    expect(html).toMatch(/^<button[^>]*type="button"[^>]*data-testid="password-reveal"/);
    expect(html).toContain('>Show<span class="sr-only"> Password</span></button>');
    expect(html).not.toContain('Hide');
    // A 44px target, like every button a thumb presses.
    expect(html).toContain('min-h-touch');
  });

  it('says it in the reader’s words', () => {
    const html = renderToStaticMarkup(
      <PasswordReveal show="نمایش" hide="پنهان کردن" field="گذرواژه" />,
    );
    expect(html).toContain('>نمایش<span class="sr-only"> گذرواژه</span>');
  });
});

describe('ZoneLine', () => {
  it('says the zone the server drew, left-to-right whatever the page, then Change', () => {
    const html = renderToStaticMarkup(
      <ZoneLine before="Time zone: " after="" change="Change" initial="Asia/Tehran" />,
    );
    expect(html).toBe(
      '<span>Time zone: <bdi dir="ltr" data-testid="timezone-value">Asia/Tehran</bdi></span>' +
        '<span aria-hidden="true">·</span>' +
        '<span class="text-accent underline">Change</span>',
    );
  });

  it('keeps a sentence that puts words after the zone', () => {
    const html = renderToStaticMarkup(
      <ZoneLine before="منطقه‌ی زمانی: " after=" است" change="تغییر" initial="UTC" />,
    );
    expect(html).toContain(
      'منطقه‌ی زمانی: <bdi dir="ltr" data-testid="timezone-value">UTC</bdi> است',
    );
  });

  it('follows the list and puts it back after the form is reset', () => {
    const source = read('register-controls.tsx');
    expect(source).toContain("list.addEventListener('change', onChange);");
    expect(source).toContain("form?.addEventListener('reset', onReset);");
    expect(source).toContain('if (list.value !== chosen) list.value = chosen;');
  });
});

describe('where the two controls live', () => {
  it('is outside the form component every page shares, which holds no field state', () => {
    const form = read('action-form.tsx');
    expect(form).not.toMatch(/from '[^']*register-controls'/);
    expect(form).not.toContain('useState');
    expect(form).not.toContain('useEffect');
    const page = readFileSync(
      join(__dirname, '..', 'app', '[locale]', 'register', 'page.tsx'),
      'utf8',
    );
    expect(page).toContain(
      "import { PasswordReveal, ZoneLine } from '@/components/register-controls';",
    );
  });
});
