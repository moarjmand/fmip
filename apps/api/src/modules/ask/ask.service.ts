import { Injectable } from '@nestjs/common';
import type {
  AskReason,
  AskResponse,
  SearchEntityType,
  SearchIntent,
  SearchResult,
} from '@fmip/contracts';
import { SEARCH_ENTITY_TYPES } from '@fmip/contracts';
import { IntelligenceService } from '../intelligence/intelligence.service';
import { SearchService } from '../search/search.service';

/** The standing instruction: stable across every question, so the provider can cache it. */
export const INTENT_SYSTEM = [
  'You read one question about football and return what it asks about, as JSON and nothing else.',
  'The JSON has two fields: "names", the names of teams, competitions or people the question mentions, spelled as the question spells them (at most five); and "types", which of "team", "competition", "person" the question asks for (an empty list when it does not say).',
  'Do not answer the question. Do not add names the question does not contain. Do not add any other field or any text outside the JSON.',
].join(' ');

const MAX_TOKENS = 300;
const MAX_NAMES = 5;
const MAX_NAME_LENGTH = 80;
const MIN_NAME_LENGTH = 2;
const PER_NAME = 10;
const FALLBACK_LIMIT = 20;

/**
 * The search's score at or above which the whole question is a name the
 * search already knows (T-1859, D-444). The score is `word_similarity` of the
 * question within a name or alias, or 1 for a prefix, an exact alias, short
 * name or code: at 0.9 nearly every trigram of the question sits in one name,
 * so there is nothing left for the model to read ("Salah", "Man Utd",
 * "پرسپولیس"), while a word beside the name ("liverpool players", 0.56) or two
 * names ("Barca vs Real Madrid", 0.57) still goes to the model.
 */
export const KNOWN_NAME_SCORE = 0.9;

/** What the caller runs just before the model is asked: its ceilings (T-838). It may throw. */
export type BeforeModel = () => Promise<void>;

/**
 * Natural-language search (E42, T-420 to T-422). The question is searched as
 * keywords first; when the whole of it is a name the search knows, those rows
 * are the answer and no model is asked (T-1859, D-444). Otherwise the model
 * reads the question into a structured intent and the search that exists
 * answers it. Every way the reading can fail -- no model, an unreadable
 * answer, no name found, a failed call -- ends in the same place: the
 * question's keyword rows, with the reason beside them. Nothing here is on
 * the critical path and nothing here invents an entity: a result is a row the
 * search found by id.
 */
@Injectable()
export class AskService {
  constructor(
    private readonly search: SearchService,
    private readonly intelligence: IntelligenceService,
  ) {}

  /**
   * `beforeModel` runs only when the model is about to be asked -- never for
   * a known name or without a model -- so a name searched costs no ceiling.
   */
  async ask(question: string, beforeModel: BeforeModel = async () => {}): Promise<AskResponse> {
    const plain = await this.search.search({
      q: question,
      types: [...SEARCH_ENTITY_TYPES],
      limit: FALLBACK_LIMIT,
    });
    const keywords = (reason: AskReason): AskResponse => ({
      question,
      interpretation: { coverage: 'not_supplied', last_updated_at: null, data: null },
      reason,
      results: plain.results,
    });
    const top = plain.results[0];
    if (top !== undefined && top.score >= KNOWN_NAME_SCORE) return keywords('known_name');
    if (this.intelligence.describe().absent) return keywords('no_model');

    await beforeModel();
    const answer = await this.intelligence.complete({
      system: INTENT_SYSTEM,
      prompt: question,
      maxTokens: MAX_TOKENS,
      // A reader is waiting: a busy model is the keyword rows at once, not a
      // second try a second later (T-1859).
      retryWhenBusy: false,
    });
    if (answer.outcome === 'absent') return keywords('no_model');
    if (answer.outcome === 'failed') return keywords('failed');
    if (answer.completion.stop !== 'end_turn') return keywords('unreadable');
    const intent = readIntent(answer.completion.text);
    if (intent === null) return keywords('unreadable');
    if (intent.names.length === 0) return keywords('nothing_named');

    const types = intent.types.length === 0 ? [...SEARCH_ENTITY_TYPES] : intent.types;
    const found = new Map<string, SearchResult>();
    for (const name of intent.names) {
      const page = await this.search.search({ q: name, types, limit: PER_NAME });
      for (const hit of page.results) {
        const key = `${hit.type}:${hit.id}`;
        const known = found.get(key);
        if (known === undefined || known.score < hit.score) found.set(key, hit);
      }
    }
    const results = [...found.values()].sort((a, b) => b.score - a.score);
    return {
      question,
      interpretation: {
        coverage: 'available',
        last_updated_at: new Date().toISOString(),
        data: intent,
      },
      reason: null,
      results,
    };
  }
}

/**
 * The model's answer as an intent, or `null` when it is not one. Strict on
 * purpose: a field the schema does not name, a type the search does not
 * know, a name too short to search or too long to be one, and the answer is
 * unreadable -- searched as keywords, never trusted halfway.
 */
export function readIntent(text: string): SearchIntent | null {
  const body = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join(',') !== 'names,types') return null;
  const { names, types } = record;
  if (!Array.isArray(names) || !Array.isArray(types)) return null;
  if (names.length > MAX_NAMES) return null;
  const cleanNames: string[] = [];
  for (const name of names) {
    if (typeof name !== 'string') return null;
    const clean = name.trim();
    if (clean.length < MIN_NAME_LENGTH || clean.length > MAX_NAME_LENGTH) return null;
    cleanNames.push(clean);
  }
  const cleanTypes: SearchEntityType[] = [];
  for (const type of types) {
    if (typeof type !== 'string' || !(SEARCH_ENTITY_TYPES as readonly string[]).includes(type)) {
      return null;
    }
    if (!cleanTypes.includes(type as SearchEntityType)) cleanTypes.push(type as SearchEntityType);
  }
  return { names: [...new Set(cleanNames)], types: cleanTypes };
}
