'use server';

import { redirect } from 'next/navigation';
import type { PredictionShareResponse } from '@fmip/contracts';
import { isLocale, DEFAULT_LOCALE } from '@/i18n/locales';
import { apiRequest } from '@/lib/api';
import { sessionCookieHeader } from '@/lib/session';

/**
 * Making and withdrawing the public link to one correct pick's card
 * (T-1723, D-351). Server actions behind plain forms, so both work without
 * JavaScript and the session never leaves the server. The link exists only
 * because its owner pressed the button; the API refuses anyone else's
 * prediction and any pick that is not correct and settled, and counts the
 * making against the member's hourly ceiling.
 *
 * Each answers by going back to the owner's page, which reads the link's
 * state afresh; a refusal travels as `?share=<reason>`, never as a message
 * built here.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function page(locale: string, id: string, outcome?: string): string {
  const where = `/${isLocale(locale) ? locale : DEFAULT_LOCALE}/predictions/${id}/share`;
  return outcome === undefined ? where : `${where}?share=${outcome}`;
}

function refusal(status: number): string {
  if (status === 429) return 'rate_limited';
  if (status === 409) return 'not_called';
  if (status === 401) return 'signed_out';
  return 'failed';
}

export async function createShareAction(locale: string, predictionId: string): Promise<void> {
  if (!UUID.test(predictionId)) redirect(page(locale, predictionId, 'failed'));
  const result = await apiRequest<PredictionShareResponse>(
    `/me/predictions/${encodeURIComponent(predictionId)}/share`,
    { method: 'POST', cookie: await sessionCookieHeader() },
  );
  redirect(page(locale, predictionId, result.ok ? 'made' : refusal(result.status)));
}

export async function revokeShareAction(locale: string, predictionId: string): Promise<void> {
  if (!UUID.test(predictionId)) redirect(page(locale, predictionId, 'failed'));
  const result = await apiRequest<null>(
    `/me/predictions/${encodeURIComponent(predictionId)}/share`,
    { method: 'DELETE', cookie: await sessionCookieHeader() },
  );
  redirect(page(locale, predictionId, result.ok ? 'stopped' : refusal(result.status)));
}
