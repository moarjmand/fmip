-- Up Migration

-- T-012: the ingestion boundary's own tables. Three tables, three rules:
--
--   provider_mapping   rule 1 and rule 2 (CLAUDE.md): a provider's id for an
--                      entity is recorded exactly once, here, and nowhere else.
--   coverage_profile   rule 3: what a (competition, season) actually supplies,
--                      per module, so the API can say "not_supplied" instead
--                      of showing an empty box.
--   ingest_run         rule 4's audit trail: every fetch, when, from whom, with
--                      what result, so freshness can be proved rather than
--                      assumed.
--
-- Same conventions as T-010 and T-011: generated UUID keys, TEXT + CHECK for
-- enumerations (D-024), updated_at by trigger.
--
-- Provider identifiers are the three bake-off candidates from D-013 and
-- `.env.example`. The decision gate (T-025) adds or removes a value with a
-- constraint swap.

-- ---------------------------------------------------------------------------
-- provider_mapping
-- ---------------------------------------------------------------------------
-- (provider, external_id, entity_type) -> internal_id. The unique constraint on
-- that triple is the acceptance criterion for T-012 and the mechanism behind
-- T-013: a provider id resolves to exactly one internal entity, or to none.
--
-- internal_id is deliberately not a foreign key. It points at one of eight
-- tables depending on entity_type, and Postgres has no polymorphic reference.
-- The entity resolver (T-013) checks existence when it writes a row; a mapping
-- whose target was later deleted is a resolver bug to surface, not a row the
-- database should silently drop.
CREATE TABLE provider_mapping (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      text NOT NULL,
  entity_type   text NOT NULL,
  external_id   text NOT NULL,
  internal_id   uuid NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_mapping_provider_check
    CHECK (provider IN ('api_football', 'football_data_org', 'highlightly')),
  CONSTRAINT provider_mapping_entity_type_check CHECK (
    entity_type IN ('country', 'competition', 'season', 'stage', 'venue', 'team', 'person', 'fixture')
  ),
  CONSTRAINT provider_mapping_external_id_not_blank CHECK (btrim(external_id) <> ''),
  CONSTRAINT provider_mapping_seen_ordered CHECK (last_seen_at >= first_seen_at),
  CONSTRAINT provider_mapping_unique UNIQUE (provider, external_id, entity_type)
);

-- Reverse lookup: "what does provider X call our team Y".
CREATE INDEX provider_mapping_internal_idx ON provider_mapping (entity_type, internal_id);

COMMENT ON TABLE provider_mapping IS
  'The only place a provider id appears. (provider, external_id, entity_type) is unique and resolves to one internal UUID.';

-- ---------------------------------------------------------------------------
-- coverage_profile
-- ---------------------------------------------------------------------------
-- One row per (season, module). The four states are the CoverageState union
-- in @fmip/contracts; the two must change together. A season with no row for
-- a module has unknown coverage, which the API must treat as not_supplied
-- rather than as available.
CREATE TABLE coverage_profile (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id  uuid NOT NULL REFERENCES season (id) ON DELETE CASCADE,
  module     text NOT NULL,
  state      text NOT NULL,
  -- Which provider the module's data comes from, when it comes from one.
  provider   text,
  -- Human explanation shown to admins: "lineups arrive ~45 min late".
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coverage_profile_module_check CHECK (
    module IN (
      'scores', 'incidents', 'lineups', 'statistics', 'standings',
      'availability', 'advanced_statistics'
    )
  ),
  CONSTRAINT coverage_profile_state_check
    CHECK (state IN ('available', 'limited', 'not_supplied', 'delayed')),
  CONSTRAINT coverage_profile_provider_check
    CHECK (provider IS NULL OR provider IN ('api_football', 'football_data_org', 'highlightly')),
  -- Data that is available, limited or delayed came from somewhere.
  CONSTRAINT coverage_profile_supplied_has_provider
    CHECK (state = 'not_supplied' OR provider IS NOT NULL),
  CONSTRAINT coverage_profile_one_per_module UNIQUE (season_id, module)
);

COMMENT ON TABLE coverage_profile IS
  'Per (season, module) coverage state: available, limited, not_supplied or delayed. No row = unknown = treat as not_supplied.';

-- ---------------------------------------------------------------------------
-- ingest_run
-- ---------------------------------------------------------------------------
-- One row per job execution. The jobs are the five from T-026. A run is
-- 'running' exactly while finished_at is NULL, and at most one run of a given
-- (provider, job) may be running at once: the partial unique index is the
-- lock that makes a duplicate scheduler tick harmless.
CREATE TABLE ingest_run (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      text NOT NULL,
  job           text NOT NULL,
  -- What the run covered, in the job's own terms: a season id, a date, a fixture id.
  scope         text,
  status        text NOT NULL DEFAULT 'running',
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  items_seen    integer NOT NULL DEFAULT 0,
  items_written integer NOT NULL DEFAULT 0,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ingest_run_provider_check
    CHECK (provider IN ('api_football', 'football_data_org', 'highlightly')),
  CONSTRAINT ingest_run_job_check
    CHECK (job IN ('fixtures', 'live', 'lineups', 'standings', 'post_match')),
  CONSTRAINT ingest_run_status_check
    CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
  CONSTRAINT ingest_run_running_is_open CHECK ((status = 'running') = (finished_at IS NULL)),
  CONSTRAINT ingest_run_times_ordered CHECK (finished_at IS NULL OR finished_at >= started_at),
  CONSTRAINT ingest_run_counts_non_negative CHECK (items_seen >= 0 AND items_written >= 0),
  CONSTRAINT ingest_run_failed_has_error CHECK (status <> 'failed' OR error IS NOT NULL)
);

CREATE INDEX ingest_run_recent_idx ON ingest_run (provider, job, started_at DESC);

CREATE UNIQUE INDEX ingest_run_one_running_per_job
  ON ingest_run (provider, job)
  WHERE status = 'running';

COMMENT ON TABLE ingest_run IS
  'One row per ingestion job execution. running <=> finished_at IS NULL; at most one running row per (provider, job).';

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
CREATE TRIGGER provider_mapping_set_updated_at
  BEFORE UPDATE ON provider_mapping FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER coverage_profile_set_updated_at
  BEFORE UPDATE ON coverage_profile FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER ingest_run_set_updated_at
  BEFORE UPDATE ON ingest_run FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE IF EXISTS ingest_run;
DROP TABLE IF EXISTS coverage_profile;
DROP TABLE IF EXISTS provider_mapping;
