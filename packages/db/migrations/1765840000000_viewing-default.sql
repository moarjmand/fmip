-- Up Migration
-- T-1360 (D-181): a default broadcaster per competition and territory.
--
-- Until now the desk entered every listing by hand: this match, in this
-- territory, on this service. Most competitions are carried by one service in
-- a territory for a whole season, from a public schedule the editor already
-- reads, so the editor says it once -- "every Premier League match in Iran is
-- on this service, at this page" -- and that statement is the signed,
-- audited editorial fact. The listings it creates carry its id, so a reader
-- can always tell a listing entered by hand from one a default made.
--
-- Coverage still rules: a default creates listings only for fixtures whose
-- season the desk declared covered in that territory, and the read path is
-- unchanged. Exceptions are made by removal: an editor who takes down a
-- listing a default created leaves a skip row, so applying again never puts
-- it back. Link-only is unchanged: every listing is the desk's (D-069).

CREATE TABLE viewing_default (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES competition (id) ON DELETE RESTRICT,
  territory      text NOT NULL REFERENCES territory (code) ON DELETE RESTRICT,
  broadcaster_id uuid NOT NULL REFERENCES broadcaster (id) ON DELETE RESTRICT,
  access         text NOT NULL,
  -- The official destination every listing it creates sends the viewer to.
  url            text NOT NULL,
  -- Which public schedule the default is based on: the editor's evidence.
  note           text NOT NULL,
  created_by     uuid REFERENCES user_account (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  removed_at     timestamptz,
  removed_reason text,
  -- Null once removed only when the remover's account was deleted.
  removed_by     uuid REFERENCES user_account (id) ON DELETE SET NULL,
  CONSTRAINT viewing_default_access_check
    CHECK (access IN ('free', 'registration', 'subscription', 'pay_per_view')),
  CONSTRAINT viewing_default_url_format CHECK (btrim(url) <> '' AND url ~ '^https?://\S+$'),
  CONSTRAINT viewing_default_note_not_blank CHECK (btrim(note) <> ''),
  CONSTRAINT viewing_default_removed_is_whole CHECK (
    (removed_at IS NULL) = (removed_reason IS NULL)
    AND (removed_at IS NOT NULL OR removed_by IS NULL)
  )
);

-- One standing default per competition, territory and service; a removed one
-- stays as history and a new one may replace it.
CREATE UNIQUE INDEX viewing_default_one_active
  ON viewing_default (competition_id, territory, broadcaster_id)
  WHERE removed_at IS NULL;

COMMENT ON TABLE viewing_default IS
  'A standing editorial statement: every match of this competition in this territory is on this service, at this page (T-1360, D-181). Applied to covered upcoming fixtures; removed with a reason, never deleted.';

CREATE TRIGGER viewing_default_set_updated_at
  BEFORE UPDATE ON viewing_default
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- NULL = entered by hand. A default is never deleted, so SET NULL only covers
-- a deletion done by hand on the database.
ALTER TABLE viewing_option
  ADD COLUMN default_id uuid REFERENCES viewing_default (id) ON DELETE SET NULL;

CREATE INDEX viewing_option_default_idx ON viewing_option (default_id)
  WHERE default_id IS NOT NULL;

COMMENT ON COLUMN viewing_option.default_id IS
  'The default that created this listing; NULL when an editor entered it by hand (T-1360).';

CREATE TABLE viewing_default_skip (
  default_id uuid NOT NULL REFERENCES viewing_default (id) ON DELETE CASCADE,
  fixture_id uuid NOT NULL REFERENCES fixture (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES user_account (id) ON DELETE SET NULL,
  reason     text NOT NULL,
  PRIMARY KEY (default_id, fixture_id),
  CONSTRAINT viewing_default_skip_reason_not_blank CHECK (btrim(reason) <> '')
);

COMMENT ON TABLE viewing_default_skip IS
  'A match a default must not list: written when an editor removes a listing the default created, so applying never puts it back (T-1360).';

-- ---------------------------------------------------------------------------
-- Applying, in one place: the API's hourly job, the API's create endpoint and
-- the operator script all call this function, so the rule cannot drift
-- between them. For every standing default (or the one named), a listing
-- under the editorial desk for each fixture of the competition that
--   * belongs to a season the desk declared covered for that territory
--     (module viewing, available or limited),
--   * kicks off no earlier than three hours ago and is scheduled or live
--     (a postponed match has no date to be watched on),
--   * is not already listed on that service in that territory, and
--   * has no skip row for that default.
-- Returns one row per default that created anything.
-- ---------------------------------------------------------------------------
CREATE FUNCTION viewing_apply_defaults(only_default uuid DEFAULT NULL)
  RETURNS TABLE (applied_default uuid, created integer)
  LANGUAGE sql AS $$
  WITH inserted AS (
    INSERT INTO viewing_option
      (fixture_id, territory, broadcaster_id, source_id, access, url, default_id)
    SELECT f.id, d.territory, d.broadcaster_id, '00000000-0000-4000-8000-000000000901',
           d.access, d.url, d.id
      FROM viewing_default d
      JOIN season s ON s.competition_id = d.competition_id
      JOIN viewing_coverage c
        ON c.season_id = s.id AND c.territory = d.territory AND c.module = 'viewing'
       AND c.state IN ('available', 'limited')
       AND c.source_id = '00000000-0000-4000-8000-000000000901'
      JOIN fixture f ON f.season_id = s.id
     WHERE d.removed_at IS NULL
       AND (only_default IS NULL OR d.id = only_default)
       AND f.kickoff_at >= now() - interval '3 hours'
       AND f.status IN ('scheduled', 'live')
       AND NOT EXISTS (
         SELECT 1 FROM viewing_default_skip k WHERE k.default_id = d.id AND k.fixture_id = f.id
       )
    ON CONFLICT ON CONSTRAINT viewing_option_one_per_service DO NOTHING
    RETURNING viewing_option.default_id
  )
  SELECT i.default_id, count(*)::integer FROM inserted i GROUP BY i.default_id;
$$;

COMMENT ON FUNCTION viewing_apply_defaults(uuid) IS
  'Creates the listings standing defaults call for (T-1360, D-181); the one copy of the rule, called by the API and by scripts/viewing.mjs.';

-- Down Migration

DROP FUNCTION IF EXISTS viewing_apply_defaults(uuid);
DROP TABLE viewing_default_skip;
DROP INDEX IF EXISTS viewing_option_default_idx;
ALTER TABLE viewing_option DROP COLUMN default_id;
DROP TABLE viewing_default;
