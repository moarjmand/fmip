'use server';

import { revalidatePath } from 'next/cache';
import type { BriefingNotice, BriefingOutcome } from '@fmip/contracts';
import { apiRequest } from '@/lib/api';
import type { ActionState } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';

/** What became of the inbox notification (T-432), as the second sentence of a published outcome. */
const NOTICE_TEXT: Record<BriefingNotice, string> = {
  sent: 'It is in your inbox.',
  delayed: 'It reaches your inbox when your quiet hours end.',
  duplicate: 'Your inbox already has one for today.',
  muted: 'You have briefing notifications turned off, so your inbox was not told.',
  failed: 'Your inbox could not be told.',
};

/** The member asks for a briefing over their feed as it is now (T-431); the outcome comes back as a sentence. */
export async function writeBriefingAction(
  locale: string,
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const result = await apiRequest<BriefingOutcome>('/me/briefing', {
    method: 'POST',
    cookie: await sessionCookieHeader(),
  });
  if (!result.ok) {
    return {
      ok: false,
      message:
        result.status === 0
          ? 'The service is unreachable right now. Please try again shortly.'
          : (result.error?.message ?? `The request failed (HTTP ${result.status}).`),
    };
  }
  revalidatePath(`/${locale}/following`);
  const outcome = result.data;
  switch (outcome.outcome) {
    case 'published':
      return {
        ok: true,
        message: `Briefing ${outcome.version_number} written. ${NOTICE_TEXT[outcome.notification]}`,
      };
    case 'rejected':
      return {
        ok: false,
        message: `Attempt ${outcome.version_number} was turned down: ${outcome.rejection}.`,
      };
    case 'absent':
      return { ok: false, message: 'No language model is configured on this deployment.' };
    case 'nothing_to_brief':
      return { ok: false, message: 'Nothing happened around what you follow in this window.' };
    case 'failed':
      return { ok: false, message: 'The model could not be reached; nothing was written.' };
  }
}
