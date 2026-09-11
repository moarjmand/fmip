import { SEARCH_ENTITY_TYPES, type SearchEntityType } from '@fmip/contracts';

/**
 * Parsing of `GET /search` parameters (T-038). Pure, so the limits are
 * unit-tested without a server.
 */
export const QUERY_MIN_LENGTH = 2;
export const QUERY_MAX_LENGTH = 64;
export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 25;

export interface SearchQuery {
  q: string;
  types: SearchEntityType[];
  limit: number;
}

export type ParsedSearchQuery =
  { ok: true; query: SearchQuery } | { ok: false; fields: Record<string, string> };

/** Fastify hands a repeated parameter over as an array; the first one counts. */
function first(value: unknown): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

/** Collapses runs of whitespace; the store folds accents and case itself. */
export function normaliseQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export function parseSearchQuery(raw: Record<string, unknown>): ParsedSearchQuery {
  const fields: Record<string, string> = {};
  const q = normaliseQuery(first(raw.q) ?? '');
  if (q.length < QUERY_MIN_LENGTH) fields.q = `Type at least ${QUERY_MIN_LENGTH} characters.`;
  else if (q.length > QUERY_MAX_LENGTH) fields.q = `At most ${QUERY_MAX_LENGTH} characters.`;

  let types: SearchEntityType[] = [...SEARCH_ENTITY_TYPES];
  const rawTypes = first(raw.types);
  if (rawTypes !== undefined) {
    const wanted = rawTypes
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t !== '');
    const unknown = wanted.filter((t) => !(SEARCH_ENTITY_TYPES as readonly string[]).includes(t));
    if (unknown.length > 0 || wanted.length === 0)
      fields.types = `Must be a comma-separated subset of ${SEARCH_ENTITY_TYPES.join(', ')}.`;
    else types = SEARCH_ENTITY_TYPES.filter((t) => wanted.includes(t));
  }

  let limit = DEFAULT_LIMIT;
  const rawLimit = first(raw.limit);
  if (rawLimit !== undefined) {
    const n = /^\d{1,3}$/.test(rawLimit) ? Number(rawLimit) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT)
      fields.limit = `Must be a whole number from 1 to ${MAX_LIMIT}.`;
    else limit = n;
  }

  return Object.keys(fields).length > 0
    ? { ok: false, fields }
    : { ok: true, query: { q, types, limit } };
}
