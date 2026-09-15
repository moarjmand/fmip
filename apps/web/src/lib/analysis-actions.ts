'use server';

import { revalidatePath } from 'next/cache';
import { apiRequest } from '@/lib/api';
import type { ActionState } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';

/**
 * Writing, submitting and reviewing analysis (T-262).
 *
 * **Nothing here decides anything.** Whether the author holds a contributor
 * grant, whether the match has kicked off, whether a submission already has a
 * decision -- all of it is settled by the database and worded by the API. The
 * browser sends the request and shows the sentence that came back.
 *
 * A check in this file would be a third copy of a rule with two homes, and the
 * copy in the browser is the one that goes stale first: an analyst whose grant
 * was withdrawn a second ago would still see the submit button work.
 */

/** Never null, unlike `ActionState`: a request always has an outcome. */
type Sent = { ok: true } | { ok: false; message: string; fields?: Record<string, string> };

async function send(path: string, method: 'POST' | 'PUT', body?: unknown): Promise<Sent> {
  const result = await apiRequest(path, { method, cookie: await sessionCookieHeader(), body });
  if (!result.ok) {
    if (result.status === 0) {
      return {
        ok: false,
        message: 'The service is unreachable right now. Please try again shortly.',
      };
    }
    const fields = (result.error as { fields?: Record<string, string> } | undefined)?.fields;
    return {
      ok: false,
      message: result.error?.message ?? `The request failed (HTTP ${result.status}).`,
      // Every bad field at once, the way the API named them, so an analyst
      // fixes one thing and not four.
      ...(fields === undefined ? {} : { fields }),
    };
  }
  return { ok: true };
}

function number(formData: FormData, name: string): number | null {
  const raw = String(formData.get(name) ?? '').trim();
  if (raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function prose(formData: FormData, name: string): string | null {
  const raw = String(formData.get(name) ?? '').trim();
  // Absent means absent, never an empty string pretending to be prose.
  return raw === '' ? null : raw;
}

export async function saveAnalysisDraftAction(
  locale: string,
  fixtureId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const outcome = await send(`/me/analyses/${encodeURIComponent(fixtureId)}`, 'PUT', {
    predicted_outcome: String(formData.get('predicted_outcome') ?? ''),
    predicted_home: number(formData, 'predicted_home'),
    predicted_away: number(formData, 'predicted_away'),
    confidence: Number(formData.get('confidence') ?? 0),
    reasoning: String(formData.get('reasoning') ?? ''),
    lineup_impact: prose(formData, 'lineup_impact'),
    key_players: prose(formData, 'key_players'),
    form_and_context: prose(formData, 'form_and_context'),
  });
  if (!outcome.ok) return outcome;
  revalidatePath(`/${locale}/analyses/${fixtureId}`);
  return { ok: true, message: 'Draft saved.' };
}

export async function submitAnalysisAction(
  locale: string,
  fixtureId: string,
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const outcome = await send(`/me/analyses/${encodeURIComponent(fixtureId)}/submit`, 'POST');
  if (!outcome.ok) return outcome;
  revalidatePath(`/${locale}/analyses/${fixtureId}`);
  return { ok: true, message: 'Sent for review.' };
}

export async function reviewAnalysisAction(
  locale: string,
  submissionId: string,
  decision: 'approved' | 'changes_requested' | 'rejected',
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const reason = String(formData.get('reason') ?? '').trim();
  if (reason === '') {
    // Said here as well as by the API, because this is the one field a reviewer
    // is most likely to skip and a round trip to be told so is a round trip
    // wasted. The API refuses it too, which is the copy that counts.
    return { ok: false, message: 'Say why. A decision with no reason cannot be reviewed.' };
  }
  const outcome = await send(
    `/admin/analysis-reviews/${encodeURIComponent(submissionId)}`,
    'POST',
    {
      decision,
      reason,
    },
  );
  if (!outcome.ok) return outcome;
  revalidatePath(`/${locale}/admin/analysis-reviews`);
  return { ok: true, message: 'Decision recorded.' };
}
