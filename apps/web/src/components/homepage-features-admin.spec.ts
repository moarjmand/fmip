import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Featured matches on the homepage (T-1161, D-153): feature and clear over the audited API. */
const HERE = __dirname;
const VIEW = readFileSync(join(HERE, 'homepage-features-admin.tsx'), 'utf8');
const ACTIONS = readFileSync(join(HERE, '..', 'lib', 'homepage-feature-actions.ts'), 'utf8');
const PAGE = readFileSync(
  join(HERE, '..', 'app', '[locale]', 'admin', 'homepage', 'page.tsx'),
  'utf8',
);
const ADMIN = readFileSync(join(HERE, '..', 'app', '[locale]', 'admin', 'page.tsx'), 'utf8');
const HOME = readFileSync(join(HERE, '..', 'app', '[locale]', 'page.tsx'), 'utf8');

describe('the homepage features page', () => {
  it('features with a note and a window, and clears with a reason', () => {
    expect(ACTIONS).toContain('/feature`');
    expect(ACTIONS).toContain('/feature/clear`');
    expect(ACTIONS).toContain("note === ''");
    expect(ACTIONS).toContain("reason === ''");
    expect(VIEW).toContain('name="note"');
    expect(VIEW).toContain('name="hours"');
    expect(VIEW).toContain('name="reason"');
  });

  it('takes the match page address as readily as the id', () => {
    expect(ACTIONS).toContain('UUID.exec(');
    expect(VIEW).toContain('name="match"');
  });

  it('shows live and ended apart, and says a refusal or an outage', () => {
    expect(VIEW).toContain('data-testid="homepage-features-live"');
    expect(VIEW).toContain('data-testid="homepage-features-past"');
    expect(VIEW).toContain('data-testid="homepage-features-unreachable"');
    expect(PAGE).toContain('data-testid="homepage-features-forbidden"');
    expect(PAGE).not.toMatch(/hasRole|'editor'/);
  });

  it('is linked from the administration area, and read by the homepage at render', () => {
    expect(ADMIN).toContain('/admin/homepage`');
    expect(HOME).toContain('fetchFeaturedMatches()');
    expect(HOME).toContain('data-testid="home-featured-note"');
  });

  it('uses no physical side', () => {
    expect(VIEW).not.toMatch(/\b(ml|mr|pl|pr|left|right)-/);
  });
});
