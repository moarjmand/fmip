import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The Activity page keeps four promises (T-807).
 *
 * **Aggregates only, and it says so** (blueprint 19, E80's "counts, not
 * tracking"): it receives numbers and shows numbers; no member's name or id
 * reaches it, and the page states it in words.
 *
 * **"Cannot be shown" is not "nothing happened"** (rule 3): an API that did
 * not answer is said, never drawn as a quiet month.
 *
 * **Refused is said in words**, not a 404.
 *
 * **The bars are drawn by hand**, inline SVG, with no chart library, and time
 * runs with the reading direction.
 */

const HERE = __dirname;
const REPORT = readFileSync(join(HERE, 'activity-report.tsx'), 'utf8');
const PAGE = readFileSync(
  join(HERE, '..', 'app', '[locale]', 'admin', 'activity', 'page.tsx'),
  'utf8',
);
const ADMIN = readFileSync(join(HERE, '..', 'app', '[locale]', 'admin', 'page.tsx'), 'utf8');
const API = readFileSync(join(HERE, '..', 'lib', 'api.ts'), 'utf8');

describe('the Activity page', () => {
  it('is linked from the administration index and reads the admin endpoint', () => {
    expect(ADMIN).toContain('/admin/activity');
    expect(PAGE).toContain('fetchActivity');
    expect(API).toContain('/admin/activity?days=');
  });

  it('states that the counts are aggregates only, in UTC days', () => {
    expect(PAGE).toContain('data-testid="activity-aggregates-note"');
    expect(PAGE).toMatch(/aggregates only/);
    expect(PAGE).toMatch(/No member is named/);
    expect(REPORT).toMatch(/UTC days/);
  });

  it('says "cannot be shown" and "nothing recorded" separately', () => {
    expect(REPORT).toContain('activity-unavailable');
    expect(REPORT).toContain('activity-none');
    expect(REPORT).toMatch(/not the same as nothing/);
  });

  it('tells a member without the role, and sends a guest to sign in', () => {
    expect(PAGE).toContain('activity-forbidden');
    expect(PAGE).toContain('status === 403');
    expect(PAGE).toContain('/login?next=');
  });

  it('draws its bars as inline SVG in the reading direction, with no chart library', () => {
    expect(REPORT).toContain('<svg');
    expect(REPORT).toContain('sparkBars(series.counts, BARS.width, BARS.height, direction)');
    expect(PAGE).toContain('directionOf(locale)');
    for (const source of [REPORT, PAGE]) {
      expect(source).not.toMatch(/from '(recharts|chart\.js|d3|victory|nivo)/);
    }
  });

  it('never reads a name, an e-mail or an id to show', () => {
    for (const source of [REPORT, PAGE]) {
      expect(source).not.toMatch(/username|display_name|email_address|user_id/);
    }
  });
});
