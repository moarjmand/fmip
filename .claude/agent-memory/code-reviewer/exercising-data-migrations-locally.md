---
name: exercising-data-migrations-locally
description: How to exercise a provider-id data migration on the local Postgres (no catalog data there) and the news linker, in a rolled-back transaction
metadata:
  type: reference
---

The local review databases (e.g. `fmip_t1842` in container `fmip-postgres-1`, user fmip) are migrated but hold no
catalog data: `provider_mapping` is empty, so a data migration keyed by `api_football` ids inserts nothing.
To test one, inside `BEGIN … ROLLBACK` create synthetic `team` rows (name, kind 'club', gender 'men') plus
`provider_mapping` rows, then paste the up section twice and the down section once.

- Feed the SQL to psql over stdin (`docker exec -i … psql -At < file`): `-f` with a Windows path gets mangled by Git Bash.
- The migrations table is `schema_migration`, not `pgmigrations`.
- News linker check: you need a `news_source` (kind 'licensed', rights 'headline', language 'en'), a `story(id)`, `article`
  (source_id, story_id, external_id, url) and `article_version` (article_id, language, version_number, headline); then
  `news_named_entities(article, 5, false)`. Running with and without the new rows shows the side effect.
- Provider ids can be cross-checked offline against the shipped Persian-name migrations (1765867000000, 1765868000000),
  which map the same api_football ids.
