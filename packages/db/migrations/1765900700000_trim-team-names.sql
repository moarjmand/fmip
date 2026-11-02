-- Up Migration
-- T-1711 (str-2026-11-02-02): team names stored with a provider's padding.
--
-- API-Football sent " Johnstone Burgh" and " Kahramanmaraş İstiklal Spor"
-- with a leading space; `catalog --adopt-teams` copied the queued name as it
-- was, so both team rows, and the title of both team pages, start with a
-- space. The adapters now tidy every team, competition and venue name
-- (`entityName` in packages/ingestion/src/adapters/_name.ts) and the adoption
-- tidies a queued name again (`tidyName` in packages/db/scripts/catalog.mjs);
-- the rows stored before are tidied here the same way: surrounding whitespace
-- dropped, inner runs collapsed to one space.
--
-- No constraint or unique index covers `team.name` or `team.short_name` (the
-- name is never a key, rule 1; the only index on it is the search trigram
-- index, which follows the new value), so tidying cannot collide with another
-- row and no row is skipped. A name that would be left blank is not touched:
-- `name` is NOT NULL and no team was stored blank, and a blank `short_name`
-- becomes NULL, which is what "no short name" is.

UPDATE team
   SET name = btrim(regexp_replace(name, '\s+', ' ', 'g')),
       updated_at = now()
 WHERE name <> btrim(regexp_replace(name, '\s+', ' ', 'g'))
   AND btrim(name) <> '';

UPDATE team
   SET short_name = NULLIF(btrim(regexp_replace(short_name, '\s+', ' ', 'g')), ''),
       updated_at = now()
 WHERE short_name IS NOT NULL
   AND short_name <> btrim(regexp_replace(short_name, '\s+', ' ', 'g'));

-- Down Migration
-- Nothing to restore: the removed whitespace was the provider's padding, not
-- part of any name, and nothing reads it.
SELECT 1;
