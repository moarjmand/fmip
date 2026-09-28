import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { NotificationSettings } from '@fmip/contracts';
import { NOTIFICATION_DEFAULTS, NOTIFICATION_KINDS } from '@fmip/contracts';
import { EN } from '@/i18n/messages';
import { SECTIONED_KINDS } from '@/lib/notification-sections';
import { FriendAlertSettings, SECTION_LABEL } from './kind-section';

/**
 * The sections of Settings → Notifications with catalogue words (T-832):
 * friends' predictions, opt-in, with the value the API says is in force.
 */
const HERE = __dirname;
const PAGE = readFileSync(
  join(HERE, '..', 'app', '[locale]', 'settings', 'notifications', 'page.tsx'),
  'utf8',
);
const FORM = readFileSync(join(HERE, 'notification-settings.tsx'), 'utf8');

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

function pressedOf(html: string, kind: string): string {
  const at = html.indexOf(`data-testid="notification-kind-${kind}"`);
  expect(at, `no switch for ${kind}`).toBeGreaterThan(-1);
  const row = html.slice(html.lastIndexOf('<li', at), html.indexOf('</li>', at));
  return /aria-pressed="(true|false)"/.exec(row)?.[1] ?? '';
}

describe("the friends' predictions section", () => {
  it('offers the switch off by default, in catalogue words', () => {
    const html = renderToStaticMarkup(
      <FriendAlertSettings locale="en" settings={settings()} />,
    ).replaceAll('&#x27;', "'");
    expect(html).toContain('data-testid="friend-alerts"');
    expect(html).toContain(EN['notifications.friends.heading']);
    expect(html).toContain(EN['notifications.friends.predicted']);
    expect(pressedOf(html, 'friend_predicted')).toBe('false');
    expect(html).toContain('Default');
  });

  it("shows the member's own choice", () => {
    const html = renderToStaticMarkup(
      <FriendAlertSettings locale="en" settings={settings({ friend_predicted: true })} />,
    );
    expect(pressedOf(html, 'friend_predicted')).toBe('true');
    expect(html).toContain('Your choice');
  });

  it('says it never tells what the friend predicted', () => {
    expect(EN['notifications.friends.intro']).toMatch(/never what/);
  });

  it('marks its words untranslated where no translator has reached them', () => {
    const html = renderToStaticMarkup(<FriendAlertSettings locale="de" settings={settings()} />);
    expect(html).toContain('data-translation="untranslated"');
  });

  it('renders nothing when the API sent none of its kinds', () => {
    const none = settings();
    none.preferences = none.preferences.filter((p) => p.kind !== 'friend_predicted');
    expect(renderToStaticMarkup(<FriendAlertSettings locale="en" settings={none} />)).toBe('');
  });
});

describe('on the settings page', () => {
  it('is rendered by the page, and the general list leaves its kinds out', () => {
    expect(PAGE).toContain('<FriendAlertSettings');
    expect(FORM).toContain('{sections}');
    expect(FORM).toContain('!isSectionedKind(preference.kind)');
    for (const kind of SECTIONED_KINDS) expect(SECTION_LABEL[kind]).toBeTruthy();
  });
});
