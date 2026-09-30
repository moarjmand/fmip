import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOTIFICATION_HOURLY_CAP, NOTIFICATION_KINDS, isMatchAlertKind } from '@fmip/contracts';
import { EN } from '@/i18n/messages';
import { isSectionedKind } from '@/lib/notification-sections';

/**
 * Choosing what arrives, and when (T-273).
 *
 * The criterion is that a held notification **says which** rule held it, and the
 * settings page is where a member goes to understand why. So the guard is about
 * honesty rather than mechanics: every kind is offered, the page does not carry
 * its own copy of the defaults, and the quiet-hours explainer says what quiet
 * hours actually do.
 */
const HERE = __dirname;
const FORM = readFileSync(join(HERE, 'notification-settings.tsx'), 'utf8');
const MATCH = readFileSync(join(HERE, 'match-alert-settings.tsx'), 'utf8');
const SECTIONS = readFileSync(join(HERE, 'kind-section.tsx'), 'utf8');
const ACTIONS = readFileSync(join(HERE, '..', 'lib', 'notification-actions.ts'), 'utf8');
const PAGE = readFileSync(
  join(HERE, '..', 'app', '[locale]', 'settings', 'notifications', 'page.tsx'),
  'utf8',
);

describe('every kind is offered, and named in words', () => {
  it('has a sentence for each, so nobody chooses about a slug', () => {
    for (const kind of NOTIFICATION_KINDS) {
      // The match alerts are worded in their own section (T-831), and so are
      // the sectioned kinds (T-832).
      const source = isMatchAlertKind(kind) ? MATCH : isSectionedKind(kind) ? SECTIONS : FORM;
      expect(source, `no label for ${kind}`).toContain(`${kind}:`);
    }
    // Keyed by the contract's union, so a kind added without a label does not
    // compile.
    expect(FORM).toContain('Exclude<NotificationKind, MatchAlertKind | SectionedKind>');
    expect(FORM).toContain('Record<ListedKind, SettingsKey>');
    expect(MATCH).toContain('Record<MatchAlertKind, MessageKey>');
    expect(SECTIONS).toContain('Record<SectionedKind, MessageKey>');
  });

  it('renders what the API sent rather than a second copy of the defaults', () => {
    // The copy in the browser is the one that goes stale, and the one a member
    // is looking at.
    expect(FORM).toContain('settings.preferences.filter(isListedHere).map');
    expect(FORM).not.toContain('NOTIFICATION_DEFAULTS');
  });

  it('says whether a value is the member own choice or the default', () => {
    // "Default" and "your choice that happens to match the default" behave
    // differently the day a default changes, and only one of them should.
    // The words are the catalogue's since T-1305.
    expect(FORM).toMatch(/chosen \? 'alerts\.yourChoice' : 'alerts\.default'/);
    expect(EN['alerts.yourChoice']).toBe('Your choice');
    expect(EN['alerts.default']).toBe('Default');
  });

  it('names the hourly ceiling where there is one, from the contract', () => {
    // Resolved on the server as a plural per capped kind (T-1305), handed to the switch.
    expect(PAGE).toContain('NOTIFICATION_HOURLY_CAP');
    expect(PAGE).toContain("plural(resolved, 'alerts.cap', cap)");
    expect(FORM).toContain('cap={caps[preference.kind]}');
    expect(EN['alerts.cap']).toEqual({
      one: 'at most {count} an hour',
      other: 'at most {count} an hour',
    });
    // And the caps are few on purpose: a cap is for a thing that can happen
    // faster than somebody can care about it.
    expect(Object.keys(NOTIFICATION_HOURLY_CAP).length).toBeLessThan(NOTIFICATION_KINDS.length / 2);
  });

  it('puts the state somewhere a screen reader reaches', () => {
    expect(FORM).toContain('aria-pressed={inProduct}');
    expect(FORM).toMatch(/inProduct \? 'alerts\.on' : 'alerts\.off'/);
  });
});

describe('what stays quiet (T-331)', () => {
  it('offers a team, a competition and a category, each named in words', () => {
    // Keyed by the contract's union: a category added without a sentence does not compile.
    expect(FORM).toContain('Record<NotificationCategory, SettingsKey>');
    for (const scope of ['team', 'competition', 'category']) {
      expect(FORM, `no form to silence a ${scope}`).toContain(`scope="${scope}"`);
    }
    expect(FORM).toContain('settings.mutes.map');
    expect(FORM).toContain("messages['alerts.nothingSilenced']");
    expect(EN['alerts.nothingSilenced']).toBe('Nothing is silenced.');
  });

  it('silences and unmutes through the API, never a second copy of the rule', () => {
    expect(ACTIONS).toContain('/me/notification-mutes/');
    expect(ACTIONS).toMatch(/'PUT'/);
    expect(ACTIONS).toMatch(/'DELETE'/);
    // The page hands the lists over; the form does not fetch.
    expect(PAGE).toContain('fetchTeams()');
    expect(PAGE).toContain('fetchCompetitions()');
  });
});

describe('quiet hours explain themselves', () => {
  it('says nothing is thrown away, because that is the rule', () => {
    // The criterion asks for "delayed or dropped, and says which". Quiet hours
    // delay; the frequency cap drops. A member reading this page should not
    // have to guess which one applies to them.
    expect(FORM).toContain('data-testid="quiet-hours-explainer"');
    expect(FORM).toContain("messages['alerts.quietExplainer']");
    expect(EN['alerts.quietExplainer']).toMatch(/Nothing is thrown away/);
    expect(EN['alerts.quietExplainer']).toMatch(/waits until/);
  });

  it('names the timezone the window is read in', () => {
    // A member who moved and never updated their account would otherwise see a
    // window that behaves inexplicably.
    expect(FORM).toContain("replace('{timezone}', settings.timezone)");
    expect(EN['alerts.quietExplainer']).toContain('({timezone})');
  });

  it('clears by submitting empty rather than by a second button', () => {
    expect(FORM).toContain("messages['alerts.clearHint']");
    expect(EN['alerts.clearHint']).toBe('Leave both empty to clear them.');
    expect(ACTIONS).toContain("starts === '' && ends === ''");
    expect(ACTIONS).toContain("send('/me/quiet-hours', 'DELETE')");
  });
});

describe('the page', () => {
  it('sends a signed-out visitor to sign in rather than showing empty settings', () => {
    expect(PAGE).toContain('redirect(`/${locale}/login?next=/${locale}/settings/notifications`)');
  });

  it('says so when the settings could not be fetched', () => {
    // A form that silently showed the defaults would let a member "change"
    // something that was never saved, and they would find out weeks later by
    // not being told something.
    expect(PAGE).toContain('data-testid="settings-unreachable"');
  });

  it('works without JavaScript for the choices: a form per control', () => {
    expect(FORM).toContain('<form action={formAction}');
    expect(FORM).toContain('<form action={quietAction}');
    expect(FORM).not.toMatch(/onClick|useEffect|addEventListener/);
  });

  it('uses logical properties only (rule 7)', () => {
    expect(FORM).not.toMatch(/\b(ml|mr|pl|pr|text-left|text-right)-/);
  });
});
