/**
 * Paging for a member's prediction history (T-056). Pure, so the limits are
 * unit-tested without a server.
 */
export const HISTORY_DEFAULT_LIMIT = 20;
export const HISTORY_MAX_LIMIT = 50;

export interface HistoryQuery {
  limit: number;
  offset: number;
}

export type ParsedHistoryQuery =
  { ok: true; query: HistoryQuery } | { ok: false; fields: Record<string, string> };

/** Fastify hands a repeated parameter over as an array; the first one counts. */
function first(value: unknown): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

function integer(value: string): number | null {
  return /^\d{1,9}$/.test(value) ? Number(value) : null;
}

export function parseHistoryQuery(raw: Record<string, unknown>): ParsedHistoryQuery {
  const fields: Record<string, string> = {};
  let limit = HISTORY_DEFAULT_LIMIT;
  let offset = 0;

  const lim = first(raw.limit);
  if (lim !== undefined) {
    const n = integer(lim);
    if (n === null || n < 1 || n > HISTORY_MAX_LIMIT)
      fields.limit = `Must be a whole number from 1 to ${HISTORY_MAX_LIMIT}.`;
    else limit = n;
  }

  const off = first(raw.offset);
  if (off !== undefined) {
    const n = integer(off);
    if (n === null) fields.offset = 'Must be a whole number.';
    else offset = n;
  }

  return Object.keys(fields).length > 0
    ? { ok: false, fields }
    : { ok: true, query: { limit, offset } };
}
