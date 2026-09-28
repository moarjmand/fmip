import type { ApiResult } from './api';

/**
 * What a refused action tells the member (T-907, D-108). The web reads the
 * API's code, never its wording: a `forbidden` is "you may not do this",
 * followed by the API's sentence saying why, and is not shown as a form
 * error to fix. Every other failure passes the API's sentence through.
 */
export const REFUSED = 'You may not do this.';

export const UNREACHABLE = 'The service is unreachable right now. Please try again shortly.';

type Failed = Extract<ApiResult<unknown>, { ok: false }>;

/** True when the API answered "signed in, but not allowed". */
export function isRefused(result: Failed): boolean {
  return result.error?.error === 'forbidden';
}

/** The sentence a failed action shows. */
export function failureMessage(result: Failed): string {
  if (result.status === 0) return UNREACHABLE;
  const sentence = result.error?.message ?? `The request failed (HTTP ${result.status}).`;
  return isRefused(result) ? `${REFUSED} ${sentence}` : sentence;
}

/**
 * A failed action's state: the sentence, `refused` for a `forbidden`, and the
 * API's field errors only when it is not one (a refusal names no field).
 */
export function failureState(result: Failed): {
  ok: false;
  message: string;
  refused?: true;
  fields?: Record<string, string>;
} {
  if (isRefused(result)) return { ok: false, message: failureMessage(result), refused: true };
  return {
    ok: false,
    message: failureMessage(result),
    ...(result.error?.fields ? { fields: result.error.fields } : {}),
  };
}
