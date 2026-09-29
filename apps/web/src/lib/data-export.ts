import type { ApiError } from '@fmip/contracts';
import type { MessageKey } from '@/i18n/messages';

/**
 * Settings -> Download my data (T-846, D-158): the route handler at
 * `app/[locale]/settings/data-export/route.ts` sends a refused member back to
 * Settings with one of these in `?export=`, and the page says why.
 */
export const DATA_EXPORT_REFUSALS = [
  'password',
  'daily',
  'limited',
  'signed_out',
  'unavailable',
] as const;

/** Why no file came back, as the Settings page reads it from `?export=`. */
export type DataExportRefusal = (typeof DATA_EXPORT_REFUSALS)[number];

/** The API's answer, as the one word the Settings page shows a sentence for. */
export function refusalOf(status: number, error: ApiError | null): DataExportRefusal {
  if (status === 400) return 'password';
  if (status === 401) return 'signed_out';
  // The daily rule names itself in `fields.export`; the password ceilings do not.
  if (status === 429) return error?.fields?.export !== undefined ? 'daily' : 'limited';
  return 'unavailable';
}

/** `?export=` as the page received it, or null when it is not one of ours. */
export function refusalFromQuery(value: string | string[] | undefined): DataExportRefusal | null {
  return typeof value === 'string' && (DATA_EXPORT_REFUSALS as readonly string[]).includes(value)
    ? (value as DataExportRefusal)
    : null;
}

/** The sentence for each refusal; the password's is said on the password field. */
export const REFUSAL_MESSAGES: Record<DataExportRefusal, MessageKey> = {
  password: 'account.export.refused.password',
  daily: 'account.export.refused.daily',
  limited: 'account.export.refused.limited',
  signed_out: 'account.export.refused.signed_out',
  unavailable: 'account.export.refused.unavailable',
};
