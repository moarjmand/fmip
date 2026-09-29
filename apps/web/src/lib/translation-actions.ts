'use server';

import { revalidatePath } from 'next/cache';
import type { TranslationCheckOverride, TranslationCheckResult } from '@fmip/contracts';
import { TRANSLATION_CHECKS, TRANSLATION_FIELDS } from '@fmip/contracts/translation-checks';
import { apiRequest } from '@/lib/api';
import { sessionCookieHeader } from '@/lib/session';

/**
 * Writing and reviewing a translation at the desk (T-1013), over T-304's two
 * routes. **Nothing here decides anything**: who may write, who may review
 * (never the author), what the source's rights allow and which checks fail
 * are the API's, and the browser shows the sentence that came back.
 *
 * **Nothing here writes a word either.** The form carries what the translator
 * typed and nothing else; no field is filled from anywhere (D-066).
 */

export type DeskState =
  | null
  | { ok: true; message: string }
  | {
      ok: false;
      message: string;
      /** `<field>` or `<field>.<check>`, as the API named them. */
      fields?: Record<string, string>;
      /** The failing checks, when a review was refused for them. */
      checks?: TranslationCheckResult[];
    };

async function send(path: string, body: unknown, success: string): Promise<DeskState> {
  const result = await apiRequest(path, {
    method: 'POST',
    cookie: await sessionCookieHeader(),
    body,
  });
  if (result.ok) return { ok: true, message: success };
  if (result.status === 0) {
    return {
      ok: false,
      message: 'The service is unreachable right now. Please try again shortly.',
    };
  }
  const error = result.error as {
    message?: string;
    fields?: Record<string, string>;
    checks?: TranslationCheckResult[];
  } | null;
  return {
    ok: false,
    message: error?.message ?? `The request failed (HTTP ${result.status}).`,
    ...(error?.fields === undefined ? {} : { fields: error.fields }),
    ...(error?.checks === undefined ? {} : { checks: error.checks }),
  };
}

const deskPath = (locale: string, articleId: string, language: string) =>
  `/${locale}/admin/translations/${articleId}/${language}`;

/** Absent means absent: an empty field is not sent as an empty string. */
function words(formData: FormData, name: string): string | null {
  const raw = formData.get(name);
  const text = typeof raw === 'string' ? raw.trim() : '';
  return text === '' ? null : text;
}

export async function writeTranslationAction(
  locale: string,
  articleId: string,
  language: string,
  _previous: DeskState,
  formData: FormData,
): Promise<DeskState> {
  const outcome = await send(
    `/admin/articles/${encodeURIComponent(articleId)}/translations`,
    {
      language,
      headline: words(formData, 'headline') ?? '',
      summary: words(formData, 'summary'),
      byline: words(formData, 'byline'),
    },
    'Saved as a new version. A second fluent speaker reviews it.',
  );
  if (outcome?.ok) revalidatePath(deskPath(locale, articleId, language));
  return outcome;
}

export async function reviewTranslationAction(
  locale: string,
  articleId: string,
  language: string,
  _previous: DeskState,
  formData: FormData,
): Promise<DeskState> {
  // One reason per failing check the reviewer chose to pass, named
  // `reason:<field>.<check>`; a blank one is not a reason and is not sent.
  const overrides: TranslationCheckOverride[] = [];
  for (const field of TRANSLATION_FIELDS) {
    for (const check of TRANSLATION_CHECKS) {
      const reason = words(formData, `reason:${field}.${check}`);
      if (reason !== null) overrides.push({ check, field, reason });
    }
  }
  const outcome = await send(
    `/admin/articles/${encodeURIComponent(articleId)}/translations/${encodeURIComponent(language)}/review`,
    overrides.length === 0 ? {} : { overrides },
    'Reviewed. The translation is published as reviewed.',
  );
  if (outcome?.ok) revalidatePath(deskPath(locale, articleId, language));
  return outcome;
}
