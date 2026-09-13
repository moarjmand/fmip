'use server';

import { revalidatePath } from 'next/cache';
import type { FounderAnalysisVersion } from '@fmip/contracts';
import { apiRequest } from '@/lib/api';
import type { ActionState } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';

/**
 * Publishing the founder's analysis (T-131).
 *
 * A server action, so the session cookie never leaves the server and the page
 * works without JavaScript. Field errors come straight from the API's
 * `ApiError.fields`, so the web app never re-implements a validation rule — and
 * in particular never re-implements the kick-off wall, which belongs to the
 * database.
 */

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/** An empty optional section is absent, not an empty string (rule 3). */
function optional(formData: FormData, name: string): string | null {
  const value = text(formData, name);
  return value === '' ? null : value;
}

export async function publishAnalysisAction(
  locale: string,
  fixtureId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const home = text(formData, 'predicted_home');
  const away = text(formData, 'predicted_away');
  // Both or neither: half a score is not a prediction of a score, and the API
  // says so rather than guessing at the missing half.
  const score =
    home === '' && away === ''
      ? null
      : { home: Number.parseInt(home, 10), away: Number.parseInt(away, 10) };

  const result = await apiRequest<FounderAnalysisVersion>(
    `/fixtures/${encodeURIComponent(fixtureId)}/founder-analysis`,
    {
      method: 'POST',
      cookie: await sessionCookieHeader(),
      body: {
        predicted_outcome: text(formData, 'predicted_outcome'),
        predicted_score: score,
        confidence: Number.parseInt(text(formData, 'confidence'), 10),
        reasoning: text(formData, 'reasoning'),
        lineup_impact: optional(formData, 'lineup_impact'),
        key_players: optional(formData, 'key_players'),
        form_and_context: optional(formData, 'form_and_context'),
      },
    },
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

  revalidatePath(`/${locale}/founder/${fixtureId}`);
  revalidatePath(`/${locale}/match/${fixtureId}`);
  return {
    ok: true,
    message: `Published as version ${result.data.version_number}. The previous versions stay readable.`,
  };
}
