import {
  containsPhrase,
  type Glossary,
  type GlossaryEntry,
  type TranslationGlossaryHit,
  type TranslationName,
} from '@fmip/contracts';
import ar from '@fmip/contracts/glossary/ar.json';
import de from '@fmip/contracts/glossary/de.json';
import es from '@fmip/contracts/glossary/es.json';
import fr from '@fmip/contracts/glossary/fr.json';
import it from '@fmip/contracts/glossary/it.json';
import pt from '@fmip/contracts/glossary/pt.json';
import tr from '@fmip/contracts/glossary/tr.json';

/**
 * The translators' glossary (T-1011, D-130) as the API reads it, and the names
 * a translation must carry (T-1012, D-131): the entities the article links,
 * as their localised name or the glossary's term, and every locked glossary
 * term. Nothing here writes a word in another language; it only reads the
 * ones people wrote.
 */
const GLOSSARIES: Record<string, Glossary> = {
  ar: ar as Glossary,
  de: de as Glossary,
  es: es as Glossary,
  fr: fr as Glossary,
  it: it as Glossary,
  pt: pt as Glossary,
  tr: tr as Glossary,
};

/** The glossary for a BCP 47 tag, by its primary subtag (`pt-BR` is `pt`), or null. */
export function glossaryFor(language: string): Glossary | null {
  return GLOSSARIES[language.split('-')[0]!.toLowerCase()] ?? null;
}

/** A target term a person wrote and set a status on; `untranslated` is none. */
export const written = (entry: GlossaryEntry | undefined): string | null =>
  entry !== undefined && entry.status !== 'untranslated' && entry.text.trim() !== ''
    ? entry.text.trim()
    : null;

/** One entity the article links, with the names the source may call it and its localised name. */
export interface LinkedName {
  entityType: 'team' | 'competition' | 'person';
  entityId: string;
  /** The canonical name, the name it is known by, and its aliases in the source's language. */
  sourceNames: string[];
  /** `localised_name(type, id, target language)`, or null when nobody wrote one (T-303). */
  localised: string | null;
}

/**
 * The names `checkTranslation` enforces. A linked entity's accepted forms are
 * its localised name and its glossary term; a locked glossary term's is its
 * target term. Either with none is kept with no targets, so the check says it
 * could not check it rather than passing it.
 */
export function namesToCarry(linked: LinkedName[], glossary: Glossary | null): TranslationName[] {
  const names = new Map<string, TranslationName>();
  for (const entity of linked) {
    const key = `${entity.entityType}.${entity.entityId}`;
    const targets = [entity.localised, written(glossary?.[key])].filter(
      (target): target is string => target !== null && target.trim() !== '',
    );
    names.set(key, {
      key,
      sources: [...new Set(entity.sourceNames.filter((name) => name.trim() !== ''))],
      targets: [...new Set(targets)],
    });
  }
  for (const [key, entry] of Object.entries(glossary ?? {})) {
    if (!entry.locked) continue;
    const target = written(entry);
    const known = names.get(key);
    if (known !== undefined) {
      if (target !== null && !known.targets.includes(target)) known.targets.push(target);
      if (!known.sources.includes(entry.source)) known.sources.push(entry.source);
      continue;
    }
    names.set(key, { key, sources: [entry.source], targets: target === null ? [] : [target] });
  }
  return [...names.values()];
}

/**
 * The glossary terms the source uses (T-1013): every entry, locked or not,
 * whose English appears in one of the texts as whole words, with the target
 * term a person wrote or an empty one. Shown beside the form; never inserted.
 */
export function glossaryHits(texts: string[], glossary: Glossary | null): TranslationGlossaryHit[] {
  const hits: TranslationGlossaryHit[] = [];
  for (const [key, entry] of Object.entries(glossary ?? {})) {
    // "goal" is used in "goals" too: the English plural, as the glossary script counts it.
    const forms = [entry.source, `${entry.source}s`];
    if (!texts.some((text) => forms.some((form) => containsPhrase(text, form, true)))) continue;
    hits.push({
      key,
      source: entry.source,
      locked: entry.locked,
      text: written(entry) ?? '',
      status: written(entry) === null ? 'untranslated' : entry.status,
    });
  }
  return hits.sort((a, b) => a.source.localeCompare(b.source, 'en'));
}
