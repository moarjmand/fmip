-- Up Migration
-- T-103: who will miss a match, and when the provider was last asked.
--
-- `fixture_absence` is one row per player the provider lists for a fixture:
-- `out` (will miss it) or `doubtful` (may), what the reason amounts to, the
-- provider's own words for it, and `reported_at` -- when the provider first
-- said this, or last changed what it said. A player it stops listing is
-- deleted: the list is the provider's whole answer for that match, and a
-- player who has recovered is not "unavailable, as of last week".
--
-- `fixture_availability_fetch` records each ask, because for availability an
-- empty answer is information -- "nobody is missing" -- and the only way to
-- tell it from "nobody asked" is to have written the ask down.
CREATE TABLE fixture_absence (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id     uuid NOT NULL REFERENCES fixture (id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES fixture_participant (id) ON DELETE CASCADE,
  person_id      uuid NOT NULL REFERENCES person (id) ON DELETE RESTRICT,
  status         text NOT NULL,
  kind           text,
  reason         text,
  reported_at    timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixture_absence_status_check CHECK (status IN ('out', 'doubtful')),
  CONSTRAINT fixture_absence_kind_check
    CHECK (kind IS NULL OR kind IN ('injury', 'suspension', 'illness', 'other')),
  CONSTRAINT fixture_absence_reason_not_blank CHECK (reason IS NULL OR btrim(reason) <> ''),
  CONSTRAINT fixture_absence_once UNIQUE (fixture_id, person_id)
);

CREATE INDEX fixture_absence_person ON fixture_absence (person_id);

CREATE TRIGGER fixture_absence_set_updated_at
  BEFORE UPDATE ON fixture_absence FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A match page open before kick-off hears when its team news changes.
CREATE TRIGGER fixture_absence_notify_change
  AFTER INSERT OR UPDATE OR DELETE ON fixture_absence
  FOR EACH ROW EXECUTE FUNCTION notify_fixture_change();

COMMENT ON TABLE fixture_absence IS
  'A player the provider says will miss (out) or may miss (doubtful) a fixture, with its reason and when it said so (T-103).';

CREATE TABLE fixture_availability_fetch (
  fixture_id uuid PRIMARY KEY REFERENCES fixture (id) ON DELETE CASCADE,
  provider   text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixture_availability_fetch_provider_check
    CHECK (provider IN ('api_football', 'football_data_org', 'highlightly'))
);

COMMENT ON TABLE fixture_availability_fetch IS
  'When the provider was last asked who will miss this fixture; an ask that found nobody is an answer (T-103).';

-- Down Migration

DROP TABLE fixture_availability_fetch;
DROP TABLE fixture_absence;
