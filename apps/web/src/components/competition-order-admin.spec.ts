import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** The competitions' order in the console (T-1162, D-154), over the audited API. */
const HERE = __dirname;
const VIEW = readFileSync(join(HERE, 'competition-order-admin.tsx'), 'utf8');
const ACTIONS = readFileSync(join(HERE, '..', 'lib', 'competition-order-actions.ts'), 'utf8');
const PAGE = readFileSync(
  join(HERE, '..', 'app', '[locale]', 'admin', 'competitions', 'page.tsx'),
  'utf8',
);
const ADMIN = readFileSync(join(HERE, '..', 'app', '[locale]', 'admin', 'page.tsx'), 'utf8');

describe('the competition order page', () => {
  it('sets a place with a reason over the audited API, an empty place clearing it', () => {
    expect(ACTIONS).toContain("method: 'PUT'");
    expect(ACTIONS).toContain('/order`');
    expect(ACTIONS).toContain("reason === ''");
    expect(ACTIONS).toContain("place === '' ? null");
    expect(VIEW).toContain('name="order"');
    expect(VIEW).toContain('name="reason"');
  });

  it('shows the next render of the scores page and the homepage the new order', () => {
    expect(ACTIONS).toContain('revalidatePath(`/${locale}/scores`)');
    expect(ACTIONS).toContain('revalidatePath(`/${locale}`)');
  });

  it('says a refusal, an outage and an empty catalogue, each in words', () => {
    expect(VIEW).toContain('data-testid="competition-order-unreachable"');
    expect(VIEW).toContain('data-testid="competition-order-empty"');
    expect(PAGE).toContain('data-testid="competition-order-forbidden"');
    expect(PAGE).not.toMatch(/hasRole|'admin'/);
  });

  it('is linked from the administration area', () => {
    expect(ADMIN).toContain('/admin/competitions`');
  });

  it('uses no physical side', () => {
    expect(VIEW).not.toMatch(/\b(ml|mr|pl|pr|left|right)-/);
  });
});
