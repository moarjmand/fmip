// ---------------------------------------------------------------------------
// Holding back a language that is ready (T-1163, D-155): an administrator
// may hold back a locale that the catalogues would offer, with a reason, and
// release it with another. A held locale is not offered by the picker or the
// first run; its URLs answer as an unoffered locale does. The catalogue files
// are the translators' and are never touched (D-066).
// ---------------------------------------------------------------------------

/**
 * The locales a hold may name: every real interface language but English,
 * the source language (D-003) a held one falls back to. The web's
 * `i18n/locales.ts` is the registry; its spec keeps this list equal to it.
 */
export const HOLDABLE_LOCALES = ['ar', 'de', 'es', 'fr', 'it', 'pt', 'tr'] as const;
export type HoldableLocale = (typeof HOLDABLE_LOCALES)[number];

/** `POST /admin/locales/:locale/hold` and `.../release`: the reason is audited. */
export interface LocaleHoldRequest {
  reason: string;
}

/** One hold as the console shows it: in force, or released and by whom. */
export interface LocaleHoldRecord {
  locale: string;
  held_by: string;
  reason: string;
  held_at: string;
  released_by: string | null;
  release_reason: string | null;
  released_at: string | null;
}

/** `GET /admin/locale-holds`: every hold, newest first. Administrators only. */
export interface LocaleHoldListResponse {
  holds: LocaleHoldRecord[];
}

/**
 * `GET /locale-holds`: the locales held now, and since when. Public: the web
 * reads it to decide what to offer, for a guest too. The reason is the
 * administrators'; a reader is told only that the language is held back.
 */
export interface HeldLocalesResponse {
  generated_at: string;
  held: { locale: string; held_at: string }[];
}
