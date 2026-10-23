import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EN } from '@/i18n/messages';

/**
 * The register form's defaults (T-1480). The country list opened on its first
 * entry (Afghanistan) and the time zone on UTC, so a reader who did not look
 * registered with both. These read the source, as `account-deletion.spec.ts`
 * does: the page and the action are server code with a live API behind them.
 */
const HERE = __dirname;
const read = (...parts: string[]) => readFileSync(join(HERE, ...parts), 'utf8');
const PAGE = read('..', 'app', '[locale]', 'register', 'page.tsx');
const ACTIONS = read('..', 'lib', 'auth-actions.ts');
const DEVICE = read('device-time-zone.tsx');

describe('the register form', () => {
  it('preselects no country, and asks for one in the reader’s words', () => {
    expect(PAGE).toContain("{ value: '', label: t(lang, 'auth.register.countryChoose') }");
    expect(PAGE).toMatch(/name: 'country_id',[\s\S]*?defaultValue: ''/);
    expect(ACTIONS).toContain("if (body.country_id === '')");
    expect(ACTIONS).toContain("say(locale, 'auth.register.countryRequired')");
    expect(EN['auth.register.countryChoose']).toBe('Choose your country or territory');
  });

  it('offers this device’s zone in place of UTC, unless the guest already chose one', () => {
    expect(PAGE).toContain('guest.timezone === undefined');
    expect(PAGE).toContain('<DeviceTimeZone form="register-form" field="timezone" unless="UTC" />');
    expect(DEVICE).toContain('Intl.DateTimeFormat().resolvedOptions().timeZone');
    // Only a zone the list offers, and only over the untouched default.
    expect(DEVICE).toContain('select.value !== unless');
    expect(DEVICE).toContain('[...select.options].some');
  });
});
