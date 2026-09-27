import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Contributors on the web (T-612): the same four actions as the API -- grant,
 * pause, resume, withdraw -- each with a reason, and eligibility kept apart
 * from the grant as the contract keeps them apart.
 */
const HERE = __dirname;
const VIEW = readFileSync(join(HERE, 'contributors-admin.tsx'), 'utf8');
const ACTIONS = readFileSync(join(HERE, '..', 'lib', 'contributor-actions.ts'), 'utf8');
const PAGE = readFileSync(
  join(HERE, '..', 'app', '[locale]', 'admin', 'contributors', 'page.tsx'),
  'utf8',
);
const ADMIN = readFileSync(join(HERE, '..', 'app', '[locale]', 'admin', 'page.tsx'), 'utf8');

describe('the contributors page', () => {
  it('offers the four actions the API has', () => {
    expect(ACTIONS).toContain("'/admin/contributors'");
    for (const event of ['pause', 'resume', 'withdraw']) {
      expect(ACTIONS).toContain(`${event}: `);
    }
    expect(ACTIONS).toContain('/${event}`');
  });

  it('requires a reason for every one of them', () => {
    expect(VIEW).toContain('name="reason"');
    expect(ACTIONS.match(/if \(reason === ''\) return NO_REASON;/g)).toHaveLength(2);
  });

  it('keeps what was computed apart from what was decided', () => {
    expect(VIEW).toContain('data-testid="contributor-eligibility"');
    expect(VIEW).toContain('data-testid="contributor-grant"');
    expect(VIEW).toContain('Decided: never granted');
    expect(VIEW).not.toMatch(/eligible_and_approved|qualifies && grant/);
  });

  it('says a refusal and an outage, never an empty list in their place', () => {
    expect(PAGE).toContain('data-testid="contributors-forbidden"');
    expect(VIEW).toContain('data-testid="contributors-unreachable"');
    expect(PAGE).not.toMatch(/hasRole|'moderator'/);
  });

  it('is linked from the administration area', () => {
    expect(ADMIN).toContain('/admin/contributors`');
  });
});
