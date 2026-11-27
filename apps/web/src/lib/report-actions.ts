'use server';

import { revalidatePath } from 'next/cache';
import {
  MAX_REPORT_DETAIL,
  type SubmitReportRequest,
  type SubmitReportResponse,
} from '@fmip/contracts';
import { apiRequest } from '@/lib/api';
import type { ActionState } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';
import { formatNumber } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { interpolate, t } from '@/i18n/messages';
import { failureState } from './action-failure';
import { handleText, isReportReason } from './report';

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
 * Report `username`, from their profile or from one of their messages (the
 * same report: see `lib/report.ts` for why no message id is sent).
 *
 * Reporting is never gated by a clock (T-213): the API holds it to one open
 * report per reporter and subject. A second while one is open is not stored,
 * and the API says so (`filed: false`); the member is told that rather than
 * "sent", because what they wrote this time was not kept.
 */
export async function reportMemberAction(
  locale: string,
  username: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const l = lang(locale);
  const reason = formData.get('reason');
  if (!isReportReason(reason)) return { ok: false, message: t(l, 'report.chooseReason') };

  const note = String(formData.get('detail') ?? '').trim();
  if (note.length > MAX_REPORT_DETAIL) {
    return {
      ok: false,
      message: interpolate(t(l, 'report.tooLong'), { max: formatNumber(l, MAX_REPORT_DETAIL) }),
    };
  }
  // The API refuses "other" with nothing said; asked here first, in words.
  if (reason === 'other' && note === '') return { ok: false, message: t(l, 'report.needsDetail') };

  const body: SubmitReportRequest = {
    subject_type: 'member',
    subject: username,
    reason,
    detail: note === '' ? null : note,
  };
  const result = await apiRequest<SubmitReportResponse>('/reports', {
    method: 'POST',
    cookie: await sessionCookieHeader(),
    body,
  });
  if (!result.ok) {
    if (result.status === 404) return { ok: false, message: t(l, 'report.unknown') };
    return failureState(result, locale);
  }
  if (result.data?.filed === false) {
    return {
      ok: true,
      message: interpolate(t(l, 'report.alreadyOpen'), { handle: handleText(username) }),
    };
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
  return appeal(locale, `/me/sanctions/${encodeURIComponent(sanctionId)}/appeal`, formData);
}

/** Appeal a warning or a content removal on the member's own account: once, in writing (T-1973). */
export async function appealDecisionAction(
  locale: string,
  decisionId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return appeal(locale, `/me/decisions/${encodeURIComponent(decisionId)}/appeal`, formData);
}

async function appeal(locale: string, path: string, formData: FormData): Promise<ActionState> {
  const l = lang(locale);
  const text = String(formData.get('body') ?? '').trim();
  if (text === '') return { ok: false, message: t(l, 'restrictions.appeal.empty') };
  const result = await apiRequest<null>(path, {
    method: 'POST',
    cookie: await sessionCookieHeader(),
    body: { body: text },
  });
  if (!result.ok) {
    if (result.status === 409) return { ok: false, message: t(l, 'restrictions.appeal.already') };
    if (result.status === 404) return { ok: false, message: t(l, 'restrictions.appeal.unknown') };
    return failureState(result, locale);
  }
  // The page reads the standing again, and the decision now says when it was
  // appealed instead of offering the form.
  revalidatePath(`/${locale}/settings`);
  return { ok: true, message: t(l, 'restrictions.appeal.sent') };
}
