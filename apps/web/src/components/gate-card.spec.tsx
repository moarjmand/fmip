import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EN, message } from '@/i18n/messages';
import { GATES, type GateRoute, gateLinks } from '@/lib/gate';
import { GateCard, GatePage } from './gate-card';

/**
 * The gate of the member-only pages (T-1736, D-358): one map from route to
 * copy, one card, and every page that used to answer a guest with a bare
 * sign-in form now answering with it. The pages and the actions are server
 * code with a live API behind them, so their part is read from the source, as
 * `register-defaults.spec.ts` does.
 */
const APP = join(__dirname, '..', 'app', '[locale]');
const page = (...parts: string[]) => readFileSync(join(APP, ...parts, 'page.tsx'), 'utf8');
const ROUTES = Object.keys(GATES) as GateRoute[];

/** The opening tag of the element with this test id. */
const tag = (html: string, testId: string): string =>
  new RegExp(`<[a-z0-9]+[^>]*data-testid="${testId}"[^>]*>`).exec(html)?.[0] ?? '';
const href = (html: string, testId: string): string =>
  /href="([^"]*)"/.exec(tag(html, testId))?.[1]?.replace(/&amp;/g, '&') ?? '';

describe('the gate copy map', () => {
  it('names every member-only page the review listed, the picks view and the You tab', () => {
    expect(ROUTES).toEqual([
      '/following',
      '/following/saved',
      '/friends',
      '/notifications',
      '/settings/notifications',
      '/messages',
      '/groups',
      '/scores?unpicked=1',
      '/you',
    ]);
  });

  it('gives each page a name and one sentence of its own, in English and Persian', () => {
    const sentences = new Set<string>();
    for (const route of ROUTES) {
      const gate = GATES[route];
      for (const key of [gate.title, gate.value]) {
        expect(typeof EN[key], `${route} ${key}`).toBe('string');
        expect(message('fa', key).status, `${route} ${key} in Persian`).not.toBe('untranslated');
      }
      // One sentence, short enough for a phone: no second full stop.
      const value = EN[gate.value] as string;
      expect(value.endsWith('.'), value).toBe(true);
      expect(value.slice(0, -1), value).not.toContain('. ');
      sentences.add(value);
    }
    expect(sentences.size).toBe(ROUTES.length);
  });

  it('carries the page as the return address on both links, encoded once', () => {
    expect(gateLinks('en', '/following')).toEqual({
      register: '/en/register?next=%2Fen%2Ffollowing',
      login: '/en/login?next=%2Fen%2Ffollowing',
    });
    expect(gateLinks('fa', '/settings/notifications')).toEqual({
      register: '/fa/register?next=%2Ffa%2Fsettings%2Fnotifications',
      login: '/fa/login?next=%2Ffa%2Fsettings%2Fnotifications',
    });
    expect(gateLinks('en', '/scores?unpicked=1').login).toBe(
      '/en/login?next=%2Fen%2Fscores%3Funpicked%3D1',
    );
  });

  it('gives the You tab no return address: it has no page to come back to', () => {
    expect(gateLinks('en', '/you')).toEqual({ register: '/en/register', login: '/en/login' });
  });
});

describe('GateCard', () => {
  it('says the page’s name and what it gives, then Create account before Sign in', () => {
    const html = renderToStaticMarkup(<GateCard locale="en" route="/following" />);
    expect(html).toContain('data-gate="/following"');
    expect(html).toMatch(/<h1[^>]*data-testid="gate-title"[^>]*>Following<\/h1>/);
    expect(html).toContain('Follow teams and competitions; their matches come first.');
    expect(href(html, 'gate-register')).toBe('/en/register?next=%2Fen%2Ffollowing');
    expect(href(html, 'gate-sign-in')).toBe('/en/login?next=%2Fen%2Ffollowing');
    expect(html.indexOf('gate-register')).toBeLessThan(html.indexOf('gate-sign-in'));
    expect(html).toContain('>Create account<');
    expect(html).toContain('>Sign in<');
  });

  it('fills only Create account in saffron, with Sign in outlined', () => {
    const html = renderToStaticMarkup(<GateCard locale="en" route="/notifications" />);
    expect(tag(html, 'gate-register')).toContain('bg-brand');
    expect(tag(html, 'gate-sign-in')).not.toContain('bg-brand');
    expect(tag(html, 'gate-sign-in')).toContain('border-strong');
    // Both are 44px touch targets.
    for (const id of ['gate-register', 'gate-sign-in']) {
      expect(tag(html, id)).toContain('min-h-touch');
    }
  });

  it('speaks Persian on /fa', () => {
    const html = renderToStaticMarkup(<GateCard locale="fa" route="/groups" />);
    expect(html).toContain('ساخت حساب');
    expect(html).toContain('ورود');
    expect(href(html, 'gate-register')).toBe('/fa/register?next=%2Ffa%2Fgroups');
    // Nothing fell back to English, which would be marked with its own lang.
    expect(html).not.toContain('lang="en"');
  });

  it('takes the second rank and less room above a page that keeps its own title', () => {
    const html = renderToStaticMarkup(
      <GateCard locale="en" route="/scores?unpicked=1" heading="h2" compact />,
    );
    expect(html).toMatch(/<h2[^>]*data-testid="gate-title"[^>]*>Your picks<\/h2>/);
    expect(html).not.toContain('<h1');
    expect(href(html, 'gate-sign-in')).toBe('/en/login?next=%2Fen%2Fscores%3Funpicked%3D1');
  });

  it('uses logical properties only (rule 7)', () => {
    const source = readFileSync(join(__dirname, 'gate-card.tsx'), 'utf8');
    expect(source).not.toMatch(/\b(?:ml|mr|pl|pr|left|right|text-left|text-right)-/);
  });
});

describe('the pages behind the gate', () => {
  const GATED: [GateRoute, string[]][] = [
    ['/following', ['following']],
    ['/following/saved', ['following', 'saved']],
    ['/friends', ['friends']],
    ['/notifications', ['notifications']],
    ['/settings/notifications', ['settings', 'notifications']],
    ['/messages', ['messages']],
    ['/groups', ['groups']],
  ];

  it.each(GATED)('%s shows a guest the gate, not a redirect to a bare form', (route, parts) => {
    const source = page(...parts);
    expect(source).toContain(
      `if (me === null) return <GatePage locale={locale} route="${route}" />;`,
    );
    expect(source).not.toContain('/login');
  });

  it('draws the gate as the whole page, under one h1', () => {
    const html = renderToStaticMarkup(<GatePage locale="en" route="/messages" />);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(/^<main/);
  });

  it('shows the picks gate to a guest who asks for the picks still to make', () => {
    const source = page('scores');
    expect(source).toContain('me === null && asked.unpicked === true');
    expect(source).toContain('<GateCard locale={locale} route="/scores?unpicked=1"');
  });

  it('leads the You tab’s guest to the same two choices, and a member to Settings', () => {
    const source = page('you');
    expect(source).toContain('route="/you"');
    expect(source).toContain('if (me !== null) redirect(`/${locale}/settings`);');
    const html = renderToStaticMarkup(<GateCard locale="en" route="/you" />);
    expect(html).toContain('Your Stadiomind');
    expect(href(html, 'gate-register')).toBe('/en/register');
    expect(href(html, 'gate-sign-in')).toBe('/en/login');
  });

  it('keeps the Settings page’s own explanation for a guest', () => {
    const source = page('settings');
    expect(source).toContain('data-testid="settings-guest"');
    expect(source).not.toContain('GatePage');
  });
});

describe('the redirects that still lead to the sign-in form', () => {
  it.each([
    [['groups', '[slug]'], 'loginHref(locale, `/${locale}/groups/${slug}`)'],
    [['groups', '[slug]', 'history'], 'loginHref(locale, `/${locale}/groups/${slug}/history`)'],
    [['messages', '[id]'], 'loginHref(locale, `/${locale}/messages/${id}`)'],
    [['u', '[username]', 'compare'], 'loginHref(locale, `/${locale}/u/${username}/compare`)'],
  ])('%j carries the page as the return address', (parts, call) => {
    const source = page(...parts);
    expect(source).toContain(`if (me === null) redirect(${call});`);
    expect(source).not.toContain('redirect(`/${locale}/login`)');
  });
});

describe('the account pages and their actions', () => {
  const LOGIN = page('login');
  const REGISTER = page('register');
  const ACTIONS = readFileSync(join(__dirname, '..', 'lib', 'auth-actions.ts'), 'utf8');

  it('read the address by the one rule, and carry it in the form and between the two pages', () => {
    expect(LOGIN).toContain('const next = safeReturnPath(locale, asked);');
    expect(LOGIN).toContain("{ name: RETURN_PARAM, label: 'Return to', type: 'hidden'");
    expect(LOGIN).toContain('href={registerHref(locale, next)}');
    expect(REGISTER).toContain('const next = safeReturnPath(locale, query[RETURN_PARAM]);');
    expect(REGISTER).toContain('name: RETURN_PARAM,');
    expect(REGISTER).toContain('href={loginHref(locale, next)}');
  });

  it('send a reader who is already signed in on to where they were going', () => {
    for (const source of [LOGIN, REGISTER]) {
      expect(source).toContain(
        'if (me !== null) redirect(next ?? `/${locale}/u/${encodeURIComponent(me.username)}`);',
      );
    }
  });

  it('land a sign-in on the address, read again by the same rule, else the profile', () => {
    expect(ACTIONS).toMatch(
      /redirect\(\s*safeReturnPath\(locale, text\(formData, RETURN_PARAM\)\) \?\?\s*`\/\$\{locale\}\/u\/\$\{encodeURIComponent\(result\.data\.user\.username\)\}`,\s*\);/,
    );
  });

  it('land a registration on it after the first run', () => {
    // Read once by the one rule; the same value is where the pending pick
    // comes from (T-1740, D-361) and where the registration lands.
    expect(ACTIONS).toContain('const next = safeReturnPath(locale, text(formData, RETURN_PARAM));');
    expect(ACTIONS).toMatch(
      /const destination = next \?\?\s*afterRegistration\(locale, result\.data\.user\.username, inviter\);/,
    );
    expect(ACTIONS).toContain(
      "redirect(firstRunDone ? destination : stepHref(locale, 'language', destination));",
    );
  });

  it('save the outcome a guest chose with the new account, from the validated address only', () => {
    // After the account exists, in the POST action: never on a page load.
    expect(ACTIONS).toContain('await keepChosenOutcome(locale, next, result.setCookie);');
    expect(ACTIONS).toContain('const chosen = pickFromReturnPath(locale, next);');
    // Sign-in stores nothing: a member taps the outcome they came back with.
    const login = ACTIONS.slice(ACTIONS.indexOf('export async function loginAction'));
    expect(login.slice(0, login.indexOf('export async function logoutAction'))).not.toContain(
      'savePendingPick',
    );
  });
});
