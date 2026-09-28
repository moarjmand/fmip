import type { ApiError } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { REFUSED, UNREACHABLE, failureMessage, failureState, isRefused } from './action-failure';

const failed = (status: number, error: ApiError | null) =>
  ({ ok: false, status, error, setCookie: null }) as const;

describe('a failed action (T-907, D-108)', () => {
  it('reads the code: a forbidden is "you may not do this", then the reason', () => {
    const result = failed(403, { error: 'forbidden', message: 'You are not in this group.' });
    expect(isRefused(result)).toBe(true);
    expect(failureState(result)).toEqual({
      ok: false,
      message: `${REFUSED} You are not in this group.`,
      refused: true,
    });
  });

  it('never shows a refusal as a form error, even if fields came with it', () => {
    const result = failed(403, { error: 'forbidden', message: 'No.', fields: { name: 'x' } });
    expect(failureState(result)).not.toHaveProperty('fields');
  });

  it('does not read the wording: a validation error is not a refusal', () => {
    const result = failed(400, {
      error: 'validation',
      message: 'Some of this needs fixing.',
      fields: { title: 'Too long.' },
    });
    expect(isRefused(result)).toBe(false);
    expect(failureState(result)).toEqual({
      ok: false,
      message: 'Some of this needs fixing.',
      fields: { title: 'Too long.' },
    });
  });

  it('keeps an unverified account and an unreachable API apart', () => {
    const unverified = failed(403, { error: 'email_unverified', message: 'Verify first.' });
    expect(isRefused(unverified)).toBe(false);
    expect(failureMessage(unverified)).toBe('Verify first.');
    expect(failureMessage(failed(0, null))).toBe(UNREACHABLE);
    expect(failureMessage(failed(502, null))).toBe('The request failed (HTTP 502).');
  });
});
