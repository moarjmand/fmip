import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EN, message } from '@/i18n/messages';

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
    expect(DEVICE).toContain('select.value = zone;');
  });
});

/**
 * The shorter form (T-1737, D-358, board P1-7): what it asks, in what order,
 * what it no longer asks and who supplies that instead, and the words the
 * board wrote.
 */
describe('the register form after T-1737', () => {
  const asked = [...PAGE.matchAll(/^\s+name: (?:'([a-z_]+)'|(RETURN_PARAM)),$/gm)].map(
    (match) => match[1] ?? match[2],
  );

  it('asks username, e-mail and password first, then country, time zone and the rules', () => {
    expect(asked).toEqual([
      'invited_by',
      'RETURN_PARAM',
      'username',
      'email',
      'password',
      'country_id',
      'timezone',
      'accept_rules',
    ]);
  });

  it('no longer asks for a display name or a language; the action supplies both', () => {
    expect(asked).not.toContain('display_name');
    expect(asked).not.toContain('preferred_language');
    expect(PAGE).not.toContain('auth.register.language');
    expect(ACTIONS).toContain(
      "display_name: registrationDisplayName(text(formData, 'display_name'), username),",
    );
    expect(ACTIONS).toContain(
      'preferred_language: registrationLanguage(locale, await offeredNow()),',
    );
    // The API's contract is unchanged: every field of the request is still sent.
    for (const field of [
      'username',
      'display_name',
      'email',
      'password',
      'country_id',
      'preferred_language',
      'timezone',
      'accept_rules',
    ]) {
      expect(ACTIONS, field).toMatch(new RegExp(`\\n    ${field}[:,]`));
    }
  });

  it('marks the three Latin values, with the keyboard a phone should open', () => {
    for (const name of ['username', 'email', 'password']) {
      expect(PAGE, name).toMatch(new RegExp(`name: '${name}',[^}]*latin: true`));
    }
    expect(PAGE).toMatch(/name: 'email',[^}]*inputMode: 'email'/);
    expect(PAGE).toMatch(/name: 'username',[^}]*autoComplete: 'username'/);
    expect(PAGE).toMatch(/name: 'email',[^}]*autoComplete: 'email'/);
    expect(PAGE).toMatch(/name: 'password',[^}]*autoComplete: 'new-password'/);
  });

  it('lets the password be shown and states its length rule', () => {
    expect(PAGE).toMatch(
      /name: 'password',[\s\S]*?after: \(\s*<PasswordReveal\s+show=\{t\(lang, 'auth\.passwordShow'\)\}\s+hide=\{t\(lang, 'auth\.passwordHide'\)\}/,
    );
    expect(PAGE).toMatch(/name: 'password',[^}]*hint: t\(lang, 'auth\.passwordHint'\)/);
    expect(EN['auth.passwordHint']).toBe('At least 10 characters.');
  });

  it('shows the time zone as one line with the list behind Change, kept in step by the device’s zone', () => {
    expect(PAGE).toMatch(
      /name: 'timezone',[\s\S]*?summary: \(\s*<ZoneLine\s+before=\{zoneBefore\}\s+after=\{zoneAfter\}/,
    );
    // The line starts from the zone the server drew: the guest's own, else UTC.
    expect(PAGE).toContain("initial={guest.timezone ?? 'UTC'}");
    expect(EN['auth.register.timezoneLine']).toBe('Time zone: {zone}');
    expect(EN['auth.register.timezoneChange']).toBe('Change');
    // The line reads the list's value through a change event.
    expect(DEVICE).toContain("select.dispatchEvent(new Event('change', { bubbles: true }));");
  });

  it('says what the country is used for, and only that', () => {
    expect(PAGE).toMatch(
      /name: 'country_id',[\s\S]*?hint: t\(lang, 'auth\.register\.countryWhy'\)/,
    );
    const why = EN['auth.register.countryWhy'] as string;
    expect(why).toBe(
      'Stored with your account, so the platform can send a message to members in one country.',
    );
    // Not the review's guess: the Watch listings follow the viewing territory
    // (T-312) and no leaderboard is split by country.
    expect(why).not.toMatch(/broadcast|board|watch/i);
  });

  it('puts the rules link inside the checkbox’s label, on a 44px row', () => {
    expect(EN['auth.register.acceptRules']).toBe('I accept the {rules}');
    expect(EN['auth.register.rulesLink']).toBe('platform rules');
    expect(PAGE).toMatch(/name: 'accept_rules',[\s\S]*?data-testid="register-rules-link"/);
    expect(PAGE).toMatch(/name: 'accept_rules',[\s\S]*?touch: true/);
  });

  it('opens with why to join, and ends with what the e-mail is for', () => {
    expect(EN['auth.register.title']).toBe('Create your account');
    expect(EN['auth.register.lead']).toBe('Join Stadiomind to:');
    expect([
      EN['auth.register.point.pick'],
      EN['auth.register.point.rating'],
      EN['auth.register.point.follow'],
    ]).toEqual([
      'Pick the result before kick-off',
      'Earn a rating anyone can recompute',
      'Follow your teams',
    ]);
    expect(EN['auth.register.emailUse']).toBe(
      'We use your email only for sign-in, password reset and the notifications you choose.',
    );
    expect(PAGE).toContain('wideSubmit');
    expect(PAGE).toContain('message="auth.register.emailUse"');
  });

  it('says all of it in Persian', () => {
    for (const key of [
      'auth.passwordShow',
      'auth.passwordHide',
      'auth.register.title',
      'auth.register.lead',
      'auth.register.point.pick',
      'auth.register.point.rating',
      'auth.register.point.follow',
      'auth.register.countryWhy',
      'auth.register.timezoneLine',
      'auth.register.timezoneChange',
      'auth.register.acceptRules',
      'auth.register.rulesLink',
      'auth.register.emailUse',
    ] as const) {
      expect(message('fa', key).status, key).toBe('translated');
    }
    // The placeholders survive translation.
    expect(message('fa', 'auth.register.timezoneLine').text).toContain('{zone}');
    expect(message('fa', 'auth.register.acceptRules').text).toContain('{rules}');
  });
});
