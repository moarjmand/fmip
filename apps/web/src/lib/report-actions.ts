'use server';

import { revalidatePath } from 'next/cache';
import type { SubmitReportRequest } from '@fmip/contracts';
import { apiRequest } from '@/lib/api';
import type { ActionState } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';
import { formatNumber } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { interpolate, t } from '@/i18n/messages';
import { failureState } from './action-failure';
import { type ReportedMessage, isReportReason, reportDetail, reportNoteLimit } from './report';

/**
 * A member's report of another member, and their appeal of a restriction on
 * themselves (T-1973; the platform rules' "Reports and decisions" and
 * "Appeals").
 *
 * Server actions, like the friend controls beside them, so the session cookie
 * never leaves the server and both work without JavaScript. Every rule is the
 * API's -- who can be reported, the reasons, the lengths, that an appeal is
 * written once -- and the checks here only spare a round trip for what the
 * form itself can get wrong, in the reader's language.
 */

function lang(locale: string): Locale {
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}

/**
 * Report `username`, from their profile or from one of their messages.
 *
 * Reporting is never gated by a clock (T-213): the API holds it to one open
 * report per reporter and subject, and a second while one is open is still
 * answered as sent, because the member has reported them, which is what they
 * wanted.
 */
export async function reportMemberAction(
  locale: string,
  username: string,
  message: ReportedMessage | null,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const l = lang(locale);
  const reason = formData.get('reason');
  if (!isReportReason(reason)) return { ok: false, message: t(l, 'report.chooseReason') };

  const note = String(formData.get('detail') ?? '').trim();
  const limit = reportNoteLimit(message);
  if (note.length > limit) {
    return {
      ok: false,
      message: interpolate(t(l, 'report.tooLong'), { max: formatNumber(l, limit) }),
    };
  }
  // The API refuses "other" with nothing said; a message's reference alone is
  // not saying what happened, so the note is asked for here as well.
  if (reason === 'other' && note === '') return { ok: false, message: t(l, 'report.needsDetail') };

  const body: SubmitReportRequest = {
    subject_type: 'member',
    subject: username,
    reason,
    detail: reportDetail(note, message),
  };
  const result = await apiRequest<null>('/reports', {
    method: 'POST',
    cookie: await sessionCookieHeader(),
    body,
  });
  if (!result.ok) {
    if (result.status === 404) return { ok: false, message: t(l, 'report.unknown') };
    return failureState(result, locale);
  }
  return { ok: true, message: t(l, 'report.sent') };
}

/** Appeal one restriction on the member's own account: once, in writing. */
export async function appealSanctionAction(
  locale: string,
  sanctionId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const l = lang(locale);
  const text = String(formData.get('body') ?? '').trim();
  if (text === '') return { ok: false, message: t(l, 'restrictions.appeal.empty') };
  const result = await apiRequest<null>(`/me/sanctions/${encodeURIComponent(sanctionId)}/appeal`, {
    method: 'POST',
    cookie: await sessionCookieHeader(),
    body: { body: text },
  });
  if (!result.ok) {
    if (result.status === 409) return { ok: false, message: t(l, 'restrictions.appeal.already') };
    if (result.status === 404) return { ok: false, message: t(l, 'restrictions.appeal.unknown') };
    return failureState(result, locale);
  }
  // The page reads the standing again, and the sanction now says when it was
  // appealed instead of offering the form.
  revalidatePath(`/${locale}/settings`);
  return { ok: true, message: t(l, 'restrictions.appeal.sent') };
}
