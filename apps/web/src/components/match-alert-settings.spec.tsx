import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { NotificationSettings } from '@fmip/contracts';
import {
  MATCH_ALERT_KINDS,
  NOTIFICATION_CATEGORY_OF,
  NOTIFICATION_DEFAULTS,
  NOTIFICATION_KINDS,
} from '@fmip/contracts';
import { EN } from '@/i18n/messages';
import { MatchAlertSettings } from './match-alert-settings';

/**
 * The match-alert controls (T-831, D-096): a section of their own in
 * Settings → Notifications, one switch per kind with the value the API says
 * is in force, worded through the catalogues, and silenced as a whole or per
 * team or competition by the mutes T-331 built.
 */
const HERE = __dirname;
const PAGE = readFileSync(
  join(HERE, '..', 'app', '[locale]', 'settings', 'notifications', 'page.tsx'),
  'utf8',
);
const FORM = readFileSync(join(HERE, 'notification-settings.tsx'), 'utf8');

/** What the API sends: every kind, the defaults unless the member chose. */
function settings(chosen: Partial<Record<string, boolean>> = {}): NotificationSettings {
  return {
    preferences: NOTIFICATION_KINDS.map((kind) => ({
      kind,
      in_product: chosen[kind] ?? NOTIFICATION_DEFAULTS[kind],
      chosen: kind in chosen,
    })),
    quiet_hours: null,
    timezone: 'Europe/London',
    mutes: [],
  };
}

/** The switch for one kind in rendered markup: its label's row and its pressed state. */
function switchOf(html: string, kind: string): { pressed: string; row: string } {
  const at = html.indexOf(`data-testid="notification-kind-${kind}"`);
  expect(at, `no switch for ${kind}`).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<li', at);
  const row = html.slice(start, html.indexOf('</li>', at));
  const pressed = /aria-pressed="(true|false)"/.exec(row)?.[1] ?? '';
  return { pressed, row };
}

describe('the match-alert section', () => {
  it('offers a switch for each kind, in the order a match happens', () => {
    const html = renderToStaticMarkup(<MatchAlertSettings locale="en" settings={settings()} />);
    const positions = MATCH_ALERT_KINDS.map((kind) => html.indexOf(`notification-kind-${kind}"`));
    expect(positions.every((p) => p > -1)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(html).toContain(EN['notifications.match.heading']);
    expect(html).toContain(EN['notifications.match.goal']);
  });

  it('shows the defaults as defaults: kick-off, goals and full-time on; red cards and half-time off', () => {
    const html = renderToStaticMarkup(<MatchAlertSettings locale="en" settings={settings()} />);
    expect(switchOf(html, 'match_kickoff').pressed).toBe('true');
    expect(switchOf(html, 'match_goal').pressed).toBe('true');
    expect(switchOf(html, 'match_full_time').pressed).toBe('true');
    expect(switchOf(html, 'match_red_card').pressed).toBe('false');
    expect(switchOf(html, 'match_half_time').pressed).toBe('false');
    expect(switchOf(html, 'match_goal').row).toContain('Default');
  });

  it("shows the member's own choice, and says it is theirs", () => {
    const html = renderToStaticMarkup(
      <MatchAlertSettings
        locale="en"
        settings={settings({ match_red_card: true, match_goal: false })}
      />,
    );
    expect(switchOf(html, 'match_red_card').pressed).toBe('true');
    expect(switchOf(html, 'match_red_card').row).toContain('Your choice');
    expect(switchOf(html, 'match_goal').pressed).toBe('false');
  });

  it('marks its words untranslated where no translator has reached them', () => {
    const html = renderToStaticMarkup(<MatchAlertSettings locale="de" settings={settings()} />);
    expect(html).toContain('data-translation="untranslated"');
    expect(html).toContain(EN['notifications.match.kickoff']);
  });

  it('leaves out a kind the API did not send rather than guessing its value', () => {
    const partial = settings();
    partial.preferences = partial.preferences.filter((p) => p.kind !== 'match_half_time');
    const html = renderToStaticMarkup(<MatchAlertSettings locale="en" settings={partial} />);
    expect(html).not.toContain('notification-kind-match_half_time');
  });
});

describe('on the settings page', () => {
  it('is rendered by the page and not repeated in the general list', () => {
    expect(PAGE).toContain('<MatchAlertSettings');
    expect(FORM).toContain('isMatchAlertKind(preference.kind)');
    expect(FORM).toContain('{matchAlerts}');
  });

  it('can be silenced as a whole, with its own category', () => {
    for (const kind of MATCH_ALERT_KINDS) expect(NOTIFICATION_CATEGORY_OF[kind]).toBe('match');
    expect(FORM).toMatch(/match: '[^']+'/);
  });
});
