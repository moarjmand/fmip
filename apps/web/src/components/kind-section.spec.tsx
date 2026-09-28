import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { NotificationSettings } from '@fmip/contracts';
import {
  ADMIN_ONLY_NOTIFICATION_KINDS,
  NOTIFICATION_DEFAULTS,
  NOTIFICATION_KINDS,
  notificationPath,
} from '@fmip/contracts';
import { EN } from '@/i18n/messages';
import { SECTIONED_KINDS } from '@/lib/notification-sections';
import { EditorialSettings, FriendAlertSettings, SECTION_LABEL } from './kind-section';

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

describe('the editorial section', () => {
  /** What a member is sent: every kind but an administrator's (T-802). */
  const forMember = (): NotificationSettings => {
    const all = settings();
    all.preferences = all.preferences.filter(
      (p) => !ADMIN_ONLY_NOTIFICATION_KINDS.includes(p.kind),
    );
    return all;
  };

  it("offers the founder's analysis and the review, on by default", () => {
    const html = renderToStaticMarkup(<EditorialSettings locale="en" settings={forMember()} />);
    expect(html).toContain('data-testid="editorial-alerts"');
    expect(pressedOf(html, 'founder_analysis_published')).toBe('true');
    expect(pressedOf(html, 'analysis_reviewed')).toBe('true');
    expect(html).toContain(EN['notifications.editorial.reviewed']);
  });

  it('offers the contributor queue to an administrator only', () => {
    const member = renderToStaticMarkup(<EditorialSettings locale="en" settings={forMember()} />);
    expect(member).not.toContain('notification-kind-contributor_eligible');
    const admin = renderToStaticMarkup(<EditorialSettings locale="en" settings={settings()} />);
    expect(pressedOf(admin, 'contributor_eligible')).toBe('true');
  });

  it('deep-links each to the analysis, the draft or the contributors page', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(
      notificationPath('en', {
        kind: 'founder_analysis_published',
        subject_type: 'fixture',
        subject_id: id,
        subject_label: null,
      }),
    ).toBe(`/en/match/${id}#analysis`);
    expect(
      notificationPath('en', {
        kind: 'analysis_reviewed',
        subject_type: 'analysis_draft',
        subject_id: id,
        subject_label: null,
      }),
    ).toBe(`/en/analyses/${id}`);
    expect(
      notificationPath('en', {
        kind: 'contributor_eligible',
        subject_type: 'member',
        subject_id: id,
        subject_label: 'alice',
      }),
    ).toBe('/en/admin/contributors');
  });
});

describe('on the settings page', () => {
  it('is rendered by the page, and the general list leaves its kinds out', () => {
    expect(PAGE).toContain('<FriendAlertSettings');
    expect(PAGE).toContain('<EditorialSettings');
    expect(FORM).toContain('{sections}');
    expect(FORM).toContain('!isSectionedKind(preference.kind)');
    for (const kind of SECTIONED_KINDS) expect(SECTION_LABEL[kind]).toBeTruthy();
  });
});
