-- Up Migration
-- T-1364: whether the provider reports absences for a season at all.
--
-- The lineups job asks the provider who will miss each match of the next
-- three days (T-103), and an empty answer is read as "nobody is missing".
-- For a competition the provider does not cover for absences that reading is
-- false: the empty answer means "not reported here", and the match page said
-- "nobody is missing" for every match of it -- rule 3. The provider publishes
-- what it covers per competition and season; the job now asks that once a
-- week per season it is about to ask absences for, keeps the answer here, and
-- skips the absence asks of a season whose answer is no. The match page then
-- says the provider does not report absences for this competition.
--
-- `absences` is the provider's answer, `null` until it gave one. `asked_at`
-- is when it was last asked and `answered_at` when it last answered, so a
-- failed ask is tried again the next day rather than on every run.

CREATE TABLE season_feed_coverage (
  season_id   uuid NOT NULL REFERENCES season (id) ON DELETE CASCADE,
  provider    text NOT NULL,
  absences    boolean,
  asked_at    timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  PRIMARY KEY (season_id, provider),
  CONSTRAINT season_feed_coverage_provider_check
    CHECK (provider IN ('api_football', 'football_data_org', 'highlightly')),
  CONSTRAINT season_feed_coverage_answer_dated
    CHECK ((absences IS NULL) = (answered_at IS NULL))
);

COMMENT ON TABLE season_feed_coverage IS
  'Whether the provider reports absences for a season, as it last said (T-1364); a season it says no for is not asked about absences.';

-- Down Migration

DROP TABLE season_feed_coverage;
