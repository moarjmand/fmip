import type { ApiResult } from './api';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';

/**
 * What a refused action tells the member (T-907, D-108). The web reads the
 * API's code, never its wording: a `forbidden` is "you may not do this",
 * followed by the API's sentence saying why, and is not shown as a form
 * error to fix. Every other failure passes the API's sentence through.
 *
 * Our own words -- the service unreachable, a request that failed with no
 * sentence of the API's, the refusal -- are in the reader's language
 * (T-1309). The catalogues are loaded on demand rather than imported: the
 * action modules that use this are imported by client components for their
 * actions, and a static import here would be a path from a client module to
 * every catalogue (`client-catalogues.spec.ts`). These run only on the
 * server, so the import costs nothing there.
 */

type Failed = Extract<ApiResult<unknown>, { ok: false }>;

/** True when the API answered "signed in, but not allowed". */
export function isRefused(result: Failed): boolean {
  return result.error?.error === 'forbidden';
}

/**
 * The sentence a failure shows, with no refusal wording: "unreachable" when
 * the API did not answer, else its own sentence, else the status it answered.
 */
export async function failureSentence(result: Failed, locale = 'en'): Promise<string> {
  const { interpolate, t } = await import('@/i18n/messages');
  const l = isLocale(locale) ? locale : DEFAULT_LOCALE;
  if (result.status === 0) return t(l, 'auth.unreachable');
  return (
    result.error?.message ?? interpolate(t(l, 'auth.failed'), { status: String(result.status) })
  );
}

/** The sentence a failed action shows: a refusal says so before the API's reason. */
export async function failureMessage(result: Failed, locale = 'en'): Promise<string> {
  const sentence = await failureSentence(result, locale);
  if (!isRefused(result)) return sentence;
  const { interpolate, t } = await import('@/i18n/messages');
  const l = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return interpolate(t(l, 'shared.action.refused'), { reason: sentence });
}

/**
 * A failed action's state: the sentence, `refused` for a `forbidden`, and the
 * API's field errors only when it is not one (a refusal names no field).
 */
export async function failureState(
  result: Failed,
  locale = 'en',
): Promise<{
  ok: false;
  message: string;
  refused?: true;
  fields?: Record<string, string>;
}> {
  const message = await failureMessage(result, locale);
  if (isRefused(result)) return { ok: false, message, refused: true };
  return {
    ok: false,
    message,
    ...(result.error?.fields ? { fields: result.error.fields } : {}),
  };
}
