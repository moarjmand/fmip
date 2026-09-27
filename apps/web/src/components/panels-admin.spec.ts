import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Featured matches on the web (T-613): open and close a discussion with a reason, over T-253's API. */
const HERE = __dirname;
const VIEW = readFileSync(join(HERE, 'panels-admin.tsx'), 'utf8');
const ACTIONS = readFileSync(join(HERE, '..', 'lib', 'panel-admin-actions.ts'), 'utf8');
const PAGE = readFileSync(
  join(HERE, '..', 'app', '[locale]', 'admin', 'panels', 'page.tsx'),
  'utf8',
);
const ADMIN = readFileSync(join(HERE, '..', 'app', '[locale]', 'admin', 'page.tsx'), 'utf8');

describe('the featured matches page', () => {
  it('opens and closes over the audited API, each with a reason', () => {
    expect(ACTIONS).toContain('/panel`');
    expect(ACTIONS).toContain('/panel/close`');
    expect(ACTIONS.match(/reason === ''/g)).toHaveLength(2);
    expect(VIEW).toContain('name="reason"');
  });

  it('takes the match page address as readily as the id', () => {
    expect(ACTIONS).toContain('UUID.exec(');
    expect(VIEW).toContain('name="match"');
  });

  it('shows open and closed apart, and says a refusal or an outage', () => {
    expect(VIEW).toContain('data-testid="panels-open"');
    expect(VIEW).toContain('data-testid="panels-closed"');
    expect(VIEW).toContain('data-testid="panels-unreachable"');
    expect(PAGE).toContain('data-testid="panels-forbidden"');
    expect(PAGE).not.toMatch(/hasRole|'moderator'/);
  });

  it('is linked from the administration area', () => {
    expect(ADMIN).toContain('/admin/panels`');
  });
});
