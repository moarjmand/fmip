import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EN } from '@/i18n/messages';

/**
 * The first run (blueprint 2.3 and 7.1, T-620) keeps these promises.
 *
 * **Offered once, dismissible.** The homepage offers it to a member whose
 * flow is pending and to a guest who neither finished nor dismissed it; "Not
 * now" is a plain form. **Every step is skippable**, and the flow can be
 * finished from any step. **A guest's choice survives until sign-up**: it is
 * kept in a cookie and applied to the account by registration (and by sign-in
 * for an account that never did the flow). **The device's zone is proposed,
 * not assumed**: it is shown for confirmation and nothing is saved until the
 * reader submits. Every word goes through the catalogue, and nothing is laid
 * out by physical side.
 */

const HERE = __dirname;
const APP = join(HERE, '..', 'app', '[locale]');
const read = (...parts: string[]) => readFileSync(join(...parts), 'utf8');
const PAGE = read(APP, 'welcome', 'page.tsx');
const OFFER = read(HERE, 'first-run-offer.tsx');
const ZONE = read(HERE, 'time-zone-field.tsx');
const HOME = read(APP, 'page.tsx');
const REGISTER = read(APP, 'register', 'page.tsx');
const ACTIONS = read(HERE, '..', 'lib', 'first-run-actions.ts');
const AUTH = read(HERE, '..', 'lib', 'auth-actions.ts');
const PROXY = read(HERE, '..', 'proxy.ts');

describe('the first run', () => {
  it('is offered on the homepage while pending, and can be dismissed without script', () => {
    expect(HOME).toContain('{offerFirstRun && <FirstRunOffer locale={locale} />}');
    expect(HOME).toContain("firstRun?.state === 'pending'");
    expect(HOME).toContain('guest.done !== true && guest.dismissed !== true');
    expect(OFFER).toContain('dismissFirstRunAction.bind(null, locale)');
    expect(OFFER).toContain('data-testid="first-run-dismiss"');
    expect(OFFER).toContain('href={`/${locale}/welcome`}');
  });

  it('lets every step be skipped and the flow be finished from any step', () => {
    expect(PAGE).toContain('data-testid="first-run-skip"');
    expect(PAGE).toContain('finishFirstRunAction.bind(null, locale, next)');
    expect(PAGE).toContain('data-testid="first-run-finish"');
    expect(PAGE).toContain('aria-current="step"');
  });

  it('says so in words when a list cannot be loaded, or there is only one language', () => {
    for (const testId of [
      'first-run-one-language',
      'first-run-territory-unreachable',
      'first-run-teams-unreachable',
      'first-run-teams-none',
    ]) {
      expect(PAGE, `no stated state for ${testId}`).toContain(`data-testid="${testId}"`);
    }
  });

  it("carries a guest's choices to the account at sign-up and sign-in", () => {
    expect(AUTH).toContain("await applyGuestChoices(result.setCookie, 'sign_up')");
    expect(AUTH).toContain("await applyGuestChoices(result.setCookie, 'sign_in')");
    // A new member whose flow is not done goes through it, then where they were going.
    expect(AUTH).toContain("stepHref(locale, 'language', destination)");
    expect(ACTIONS).toContain('applyPlan(choices, moment, state)');
    expect(ACTIONS).toContain('await clearGuestChoices()');
    // The registration form starts from the zone the guest confirmed.
    expect(REGISTER).toContain("defaultValue: guest.timezone ?? 'UTC'");
    // And a guest's language is where the bare address goes.
    expect(PROXY).toContain('parseGuestChoices(request.cookies.get(FIRST_RUN_COOKIE)?.value)');
  });

  it("proposes the device's zone for confirmation, and saves nothing by itself", () => {
    expect(ZONE).toContain('Intl.DateTimeFormat().resolvedOptions().timeZone');
    expect(ZONE).toContain('data-testid="first-run-browser-zone"');
    expect(ZONE).not.toMatch(/fetch\(|apiRequest|action=/);
  });

  it('shows every word through the catalogue', () => {
    for (const source of [PAGE, OFFER]) {
      const keys = [...source.matchAll(/message="([^"]+)"/g)].map((m) => m[1]);
      expect(keys.length).toBeGreaterThan(1);
      for (const key of keys) expect(Object.keys(EN), key).toContain(key);
    }
  });

  it('uses no physical sides', () => {
    for (const source of [PAGE, OFFER, ZONE]) {
      expect(source).not.toMatch(/\b(?:ml|mr|pl|pr|left|right)-\S/);
      expect(source).not.toMatch(/text-(?:left|right)\b/);
    }
  });
});
