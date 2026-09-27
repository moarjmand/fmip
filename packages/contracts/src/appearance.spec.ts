import { describe, expect, it } from 'vitest';
import {
  CONTRAST_PREFERENCES,
  MOTION_PREFERENCES,
  TEXT_SIZE_PREFERENCES,
  THEME_PREFERENCES,
} from './index';

/**
 * The appearance preferences (T-602, T-621) are closed lists the API
 * validates against, the database CHECKs repeat, and the web renders on
 * <html>. The first value of each new list is what an account that never
 * chose holds -- the migration's default -- so the order is part of the
 * contract.
 */
describe('appearance preferences', () => {
  it('are exactly these values, the unchosen one first', () => {
    expect(THEME_PREFERENCES).toEqual(['light', 'dark', 'system']);
    expect(TEXT_SIZE_PREFERENCES).toEqual(['default', 'large', 'larger']);
    expect(CONTRAST_PREFERENCES).toEqual(['system', 'standard', 'more']);
    expect(MOTION_PREFERENCES).toEqual(['system', 'reduce']);
  });
});
