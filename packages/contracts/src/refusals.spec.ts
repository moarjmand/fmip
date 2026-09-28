import { describe, expect, it } from 'vitest';
import { ROLE_REFUSALS, forbidden } from './index';

/** T-904 (D-108): one refusal body per role, each a `forbidden` and nothing else. */
describe('role refusals', () => {
  it('name exactly the four roles a console refuses for', () => {
    expect(Object.keys(ROLE_REFUSALS).sort()).toEqual([
      'administrator',
      'editor',
      'moderator',
      'operator',
    ]);
  });

  it('are each a forbidden with a sentence, and carry no fields or data', () => {
    for (const refusal of Object.values(ROLE_REFUSALS)) {
      expect(refusal.error).toBe('forbidden');
      expect(Object.keys(refusal).sort()).toEqual(['error', 'message']);
      expect(refusal.message).toMatch(/administrator role\.$/);
    }
  });

  it('forbidden builds the same shape for a member-facing refusal', () => {
    expect(forbidden('Only the founder writes this.')).toEqual({
      error: 'forbidden',
      message: 'Only the founder writes this.',
    });
  });
});
