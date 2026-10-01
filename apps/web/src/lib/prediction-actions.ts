'use server';

import type { PredictionResponse } from '@fmip/contracts';
import { revalidatePath } from 'next/cache';
import { apiRequest } from './api';
import type { ActionState } from './auth-actions';
import { formToSubmission } from './prediction-form';
import { sessionCookieHeader } from './session';
import { failureState } from './action-failure';
import { interpolate, t } from '@/i18n/messages';
import { asLocale, plainNumber } from './prediction-text';

/**
 * Submits (or resubmits) the member's prediction for a fixture (T-050). The
 * API decides everything: who may predict, whether the match is still open,
 * and which fields are wrong; the form shows what came back.
 */
export async function submitPredictionAction(
  locale: string,
  fixtureId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const cookie = await sessionCookieHeader();
  if (cookie === undefined) {
    return { ok: false, message: t(asLocale(locale), 'predictions.action.signIn') };
  }
  const result = await apiRequest<PredictionResponse>(
    `/fixtures/${encodeURIComponent(fixtureId)}/prediction`,
    { method: 'PUT', body: formToSubmission(formData), cookie },
  );
  if (!result.ok) {
    return failureState(result);
  }
  revalidatePath(`/${locale}/match/${fixtureId}`);
  const v = result.data.prediction.latest;
  return {
    ok: true,
    message: interpolate(t(asLocale(locale), 'predictions.action.saved'), {
      version: plainNumber(locale, v.version_number),
    }),
  };
}
