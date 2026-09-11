'use server';

import type { PredictionResponse } from '@fmip/contracts';
import { revalidatePath } from 'next/cache';
import { apiRequest } from './api';
import type { ActionState } from './auth-actions';
import { formToSubmission } from './prediction-form';
import { sessionCookieHeader } from './session';

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
    return { ok: false, message: 'Sign in to predict.' };
  }
  const result = await apiRequest<PredictionResponse>(
    `/fixtures/${encodeURIComponent(fixtureId)}/prediction`,
    { method: 'PUT', body: formToSubmission(formData), cookie },
  );
  if (!result.ok) {
    if (result.status === 0) {
      return {
        ok: false,
        message: 'The service is unreachable right now. Please try again shortly.',
      };
    }
    return {
      ok: false,
      message: result.error?.message ?? `The request failed (HTTP ${result.status}).`,
      ...(result.error?.fields ? { fields: result.error.fields } : {}),
    };
  }
  revalidatePath(`/${locale}/match/${fixtureId}`);
  const v = result.data.prediction.latest;
  return {
    ok: true,
    message: `Saved as version ${v.version_number}. You can change it until kick-off.`,
  };
}
