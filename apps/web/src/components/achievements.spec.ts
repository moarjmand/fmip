import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACHIEVEMENT_KINDS } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { EN } from '@/i18n/messages';
import { ACHIEVEMENT_LABEL_KEY } from './achievements';

/**
 * Achievements on a profile (blueprint 9.2, T-643, D-091) keep three promises.
 *
 * **Every kind has words in the catalogue**, so a new achievement cannot reach
 * the page as a bare identifier. **None, restricted and unreachable are each a
 * sentence** (rule 3), and a restricted list stays restricted: the section
 * follows the API's shape, fetched with the viewer's session. **They are said
 * to change nothing**: the note beside the list is part of the section.
 */

const HERE = __dirname;
const SECTION = readFileSync(join(HERE, 'achievements.tsx'), 'utf8');
const PROFILE = readFileSync(
  join(HERE, '..', 'app', '[locale]', 'u', '[username]', 'page.tsx'),
  'utf8',
);

describe('achievements on a profile', () => {
  it('names every kind the API can send through the catalogue', () => {
    for (const kind of ACHIEVEMENT_KINDS) {
      const key = ACHIEVEMENT_LABEL_KEY[kind];
      expect(EN[key], `no English for ${kind}`).toEqual(expect.any(String));
    }
    expect(new Set(Object.values(ACHIEVEMENT_LABEL_KEY)).size).toBe(ACHIEVEMENT_KINDS.length);
  });

  it('is mounted on the profile with the viewer’s session', () => {
    expect(PROFILE).toContain('<AchievementsSection');
    expect(PROFILE).toContain('fetchAchievements(profile.username, cookie)');
  });

  it('says so in words when there are none, they are restricted, or cannot be fetched', () => {
    for (const testId of [
      'achievements-none',
      'achievements-restricted',
      'achievements-unreachable',
    ])
      expect(SECTION, `no stated state for ${testId}`).toContain(`data-testid="${testId}"`);
    expect(SECTION.indexOf('achievements-none')).toBeLessThan(SECTION.indexOf('achievements-list'));
    expect(SECTION).toContain('message="achievements.note"');
  });

  it('shows when each was earned and uses no physical sides', () => {
    expect(SECTION).toContain('<time dateTime={achievement.earned_at}');
    expect(SECTION).not.toMatch(/\b(?:text|ml|mr|pl|pr|left|right)-(?:left|right|\d)/);
  });
});
