import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../database/database.module';
import { namedIds, withNames } from './internal/name-walk';

/**
 * A locale tag for `?locale=`, validated as T-303 does it: anything that is
 * not a plausible BCP 47 tag is `null` rather than 400 -- a locale is a
 * preference, not an address, and a page must not fail because its reader's
 * language was spelled oddly. Fastify hands a repeated parameter over as an
 * array; the first one counts.
 */
const LOCALE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
export function localeOf(value: unknown): string | null {
  const v: unknown = Array.isArray(value) ? (value as unknown[])[0] : value;
  return typeof v === 'string' && LOCALE.test(v) ? v : null;
}

/**
 * Localised names on every surface (T-1312): the public service the global
 * interceptor and the live streams call with an answer and the reader's
 * locale, and get back a copy with the reader's names in the `name` fields
 * the pages already render.
 *
 * Teams, competitions and people: their `entity_alias` name row in that
 * language (kind `name`, T-303 -- the same rows `localised_name()` reads).
 * Countries have no alias rows; their name is the CLDR region name for the
 * country's ISO code, from `Intl`, which is where every other word the page
 * formats comes from.
 *
 * A national team without a name row of its own is called what its country is
 * called in that language (T-1334, D-179): "Iran" reads «ایران» on a Persian
 * page. A country without an ISO code (England, Scotland) has no CLDR name;
 * it takes its national team's name row in that language instead (T-1346), so
 * the scores list's English heading reads «انگلیس», not "ENGLAND". Without
 * one it keeps its own name.
 *
 * A missing name falls back to the canonical one. That is what a reader
 * expects for a proper noun nobody has spelled in their language yet, and it
 * is not faking coverage (rule 3): the name shown is the entity's real name,
 * not an invented value or an empty module.
 *
 * One query per answer, whatever its size: set-based, never one per row.
 */
@Injectable()
export class LocalisedNamesService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async localise<T>(payload: T, locale: string | null): Promise<T> {
    if (locale === null) return payload;
    const ids = namedIds(payload);
    if (ids.length === 0) return payload;

    const { rows } = await this.pool.query<{
      id: string;
      name: string | null;
      iso2: string | null;
    }>(
      `SELECT entity_id::text AS id, alias AS name, NULL::text AS iso2
         FROM entity_alias
        WHERE kind = 'name'
          AND language = $1
          AND entity_type IN ('team', 'competition', 'person')
          AND entity_id = ANY($2::uuid[])
       UNION ALL
       SELECT id::text, NULL, iso2
         FROM country
        WHERE id = ANY($2::uuid[]) AND iso2 IS NOT NULL
       UNION ALL
       SELECT c.id::text, a.alias, NULL
         FROM country c
         JOIN team t ON t.country_id = c.id AND t.kind = 'national' AND t.gender = 'men'
         JOIN entity_alias a ON a.entity_type = 'team' AND a.entity_id = t.id
                            AND a.kind = 'name' AND a.language = $1
        WHERE c.id = ANY($2::uuid[]) AND c.iso2 IS NULL
       UNION ALL
       SELECT t.id::text, NULL, c.iso2
         FROM team t
         JOIN country c ON c.id = t.country_id
        WHERE t.kind = 'national'
          AND t.id = ANY($2::uuid[])
          AND c.iso2 IS NOT NULL
          AND NOT EXISTS (
                SELECT 1 FROM entity_alias a
                 WHERE a.kind = 'name' AND a.language = $1
                   AND a.entity_type = 'team' AND a.entity_id = t.id)`,
      [locale, ids],
    );

    const regions = regionNames(locale);
    const names = new Map<string, string>();
    for (const row of rows) {
      const name = row.name ?? (row.iso2 !== null ? regions?.(row.iso2) : undefined);
      if (name !== undefined && name !== null && name !== '') names.set(row.id, name);
    }
    return withNames(payload, names);
  }
}

/**
 * The region-name lookup for a locale, or `null` for English (the canonical
 * country names are already English, and "USA" should not turn into "United
 * States" because a caller said `en`) and for a tag `Intl` refuses.
 */
function regionNames(locale: string): ((iso2: string) => string | undefined) | null {
  if (locale === 'en' || locale.startsWith('en-')) return null;
  try {
    // A tag ICU has no data for would be answered in the default language.
    if (Intl.DisplayNames.supportedLocalesOf([locale]).length === 0) return null;
    const display = new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' });
    return (iso2) => {
      try {
        return display.of(iso2);
      } catch {
        return undefined;
      }
    };
  } catch {
    return null;
  }
}
