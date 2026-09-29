/**
 * The shared football glossary (T-1011, D-130): `glossary/en.json` is the
 * English side, one entry per term keyed by a stable id (`term.<slug>`, or
 * `team.<uuid>`, `competition.<uuid>`, `person.<uuid>` for a name -- rule 1);
 * `glossary/<locale>.json` carries every key with the target term a person
 * wrote and the status they set, in the catalogue's shape (D-066).
 *
 * Nothing in the product writes a target term. `i18n:glossary` adds source
 * terms as `untranslated` with an empty `text`; the rest is the translators'.
 */
export const GLOSSARY_STATUSES = ['untranslated', 'translated', 'reviewed'] as const;
export type GlossaryStatus = (typeof GLOSSARY_STATUSES)[number];

export const GLOSSARY_KINDS = ['term', 'team', 'competition', 'person'] as const;
export type GlossaryKind = (typeof GLOSSARY_KINDS)[number];

/** One term on the English side (`glossary/en.json`). */
export interface GlossarySourceEntry {
  kind: GlossaryKind;
  source: string;
  /** The translation must carry the target term exactly (T-1012). Names are locked. */
  locked: boolean;
}

/** One term in a locale's file (`glossary/<locale>.json`). */
export interface GlossaryEntry {
  source: string;
  locked: boolean;
  /** The target term a person wrote; empty while `untranslated`. */
  text: string;
  status: GlossaryStatus;
  note?: string;
}

export type Glossary = Record<string, GlossaryEntry>;
