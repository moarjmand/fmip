import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EN } from '@/i18n/messages';

/**
 * Following with nothing followed (T-622) keeps three promises.
 *
 * **Never an empty page that looks broken**: a member who follows nothing
 * gets a sentence and concrete next steps, and every way the suggestions can
 * fail is a sentence too. **Nothing invented**: every name on the list is the
 * API's, from what the site holds, and a competition with no team yet says
 * so. **The same follow the settings page posts**: one server action, plain
 * forms, so it works without JavaScript and needs no second way to follow.
 */

const HERE = __dirname;
const STEPS = readFileSync(join(HERE, 'follow-next-steps.tsx'), 'utf8');
const PAGE = readFileSync(join(HERE, '..', 'app', '[locale]', 'following', 'page.tsx'), 'utf8');
const ACTIONS = readFileSync(join(HERE, '..', 'lib', 'auth-actions.ts'), 'utf8');

describe('the Following page when nothing is followed', () => {
  it('asks for suggestions only when the feed says nothing is followed, and shows them', () => {
    expect(PAGE).toContain("result.data.reason === 'nothing_followed'");
    expect(PAGE).toContain('await fetchFollowSuggestions()');
    expect(PAGE).toContain('<FollowNextSteps locale={locale} suggestions={suggestions} />');
    // The sentence that says why the list is empty stays above the next steps.
    expect(PAGE.indexOf('feed-reason')).toBeLessThan(PAGE.indexOf('<FollowNextSteps'));
  });

  it('says so in words when the suggestions cannot be loaded or there are none', () => {
    for (const testId of [
      'next-steps-unreachable',
      'next-steps-nothing-held',
      'next-steps-no-teams',
    ]) {
      expect(STEPS, `no stated state for ${testId}`).toContain(`data-testid="${testId}"`);
    }
    // A danger notice is an alert (components/ui/notice.tsx, T-603).
    expect(STEPS).toContain('<Notice tone="danger" data-testid="next-steps-unreachable"');
  });

  it('follows through the existing action, and the page it is on refreshes', () => {
    expect(STEPS).toContain('followAction.bind(null, locale)');
    expect(STEPS).toContain('name="entity_type" value={type}');
    expect(STEPS).toContain('name="entity_id" value={id}');
    expect(ACTIONS).toContain('revalidatePath(`/${locale}/following`)');
  });

  it('names what each button follows, links by id, and offers two ways further', () => {
    expect(STEPS).toContain('<span className="sr-only"> {name}</span>');
    expect(STEPS).toContain('`/${locale}/competition/${competition.id}`');
    expect(STEPS).toContain('`/${locale}/team/${team.id}`');
    expect(STEPS).toContain('`/${locale}/search`');
    expect(STEPS).toContain('`/${locale}/settings`');
  });

  it('shows every word through the catalogue, with the ranking rule stated', () => {
    const keys = [...STEPS.matchAll(/message="([^"]+)"/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(8);
    for (const key of keys) expect(Object.keys(EN), key).toContain(key);
    expect(EN['feed.nextSteps.ranked']).toMatch(/most followed first/);
  });

  it('uses no physical sides', () => {
    expect(STEPS).not.toMatch(/\b(?:ml|mr|pl|pr|left|right)-\S/);
    expect(STEPS).not.toMatch(/text-(?:left|right)\b/);
  });
});
