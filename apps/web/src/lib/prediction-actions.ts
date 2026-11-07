'use server';

import type { PredictionResponse } from '@fmip/contracts';
import { revalidatePath } from 'next/cache';
import { apiRequest, savePendingPick } from './api';
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
    return failureState(result, locale);
  }
  revalidatePath(`/${locale}/match/${fixtureId}`);
  // The matches page's row turns to "Picked" and its view to what is left (T-1496).
  revalidatePath(`/${locale}/scores`);
  const v = result.data.prediction.latest;
  return {
    ok: true,
    message: interpolate(t(asLocale(locale), 'predictions.action.saved'), {
      version: plainNumber(locale, v.version_number),
    }),
  };
}

/**
 * Saves the outcome a member tapped before their email address is confirmed
 * (T-1740, D-361): a pending pick, in place of one already waiting. Not a
 * prediction -- it becomes one when they confirm the address before kick-off.
 * The API decides who may leave one and until when.
 *
 * A page drawn before the member confirmed can still post here afterwards.
 * The API then answers 409 `conflict` (they predict, there is nothing to wait
 * for), and the same form is handed to `submitPredictionAction`, so the tap
 * is their prediction rather than an error to read.
 */
export async function savePendingPickAction(
  locale: string,
  fixtureId: string,
  previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const cookie = await sessionCookieHeader();
  if (cookie === undefined) {
    return { ok: false, message: t(asLocale(locale), 'predictions.action.signIn') };
  }
  const outcome = formData.get('outcome');
  const result = await savePendingPick(
    fixtureId,
    typeof outcome === 'string' ? outcome : '',
    cookie,
  );
  if (!result.ok) {
    if (result.status === 409 && result.error?.error === 'conflict') {
      return submitPredictionAction(locale, fixtureId, previous, formData);
    }
    return failureState(result, locale);
  }
  revalidatePath(`/${locale}/match/${fixtureId}`);
  revalidatePath(`/${locale}/scores`);
  return { ok: true, message: t(asLocale(locale), 'pick.pending.announce') };
}
