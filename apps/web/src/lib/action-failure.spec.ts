import type { ApiError } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { failureMessage, failureSentence, failureState, isRefused } from './action-failure';

const failed = (status: number, error: ApiError | null) =>
  ({ ok: false, status, error, setCookie: null }) as const;

describe('a failed action (T-907, D-108)', () => {
  it('reads the code: a forbidden is "you may not do this", then the reason', async () => {
    const result = failed(403, { error: 'forbidden', message: 'You are not in this group.' });
    expect(isRefused(result)).toBe(true);
    await expect(failureState(result)).resolves.toEqual({
      ok: false,
      message: 'You may not do this. You are not in this group.',
      refused: true,
    });
  });

  it('never shows a refusal as a form error, even if fields came with it', async () => {
    const result = failed(403, { error: 'forbidden', message: 'No.', fields: { name: 'x' } });
    expect(await failureState(result)).not.toHaveProperty('fields');
  });

  it('does not read the wording: a validation error is not a refusal', async () => {
    const result = failed(400, {
      error: 'validation',
      message: 'Some of this needs fixing.',
      fields: { title: 'Too long.' },
    });
    expect(isRefused(result)).toBe(false);
    await expect(failureState(result)).resolves.toEqual({
      ok: false,
      message: 'Some of this needs fixing.',
      fields: { title: 'Too long.' },
    });
  });

  it('keeps an unverified account and an unreachable API apart', async () => {
    const unverified = failed(403, { error: 'email_unverified', message: 'Verify first.' });
    expect(isRefused(unverified)).toBe(false);
    expect(await failureMessage(unverified)).toBe('Verify first.');
    expect(await failureMessage(failed(0, null))).toBe(
      'The service is unreachable right now. Please try again shortly.',
    );
    expect(await failureMessage(failed(502, null))).toBe('The request failed (HTTP 502).');
  });

  it('says our own words in the reader’s language, and the API’s as it wrote them (T-1309)', async () => {
    expect(await failureSentence(failed(0, null), 'fa')).not.toMatch(/[A-Za-z]/);
    expect(await failureSentence(failed(502, null), 'fa')).toContain('502');
    const refused = await failureMessage(
      failed(403, { error: 'forbidden', message: 'Not yours.' }),
      'fa',
    );
    expect(refused).toMatch(/Not yours\.$/);
    expect(refused.replace('Not yours.', '')).not.toMatch(/[A-Za-z]/);
  });
});
