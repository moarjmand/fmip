-- Up Migration
-- T-1782 (D-382): when a fixture's team statistics were last confirmed by an
-- answer that carried them.
--
-- In play the live job asks each match's detail every few minutes, and the
-- match page says "Stats updated 2 min ago" from it (rule 4). The time cannot
-- be `fixture_stat.updated_at` alone: a figure that did not move (the
-- half-time interval) moves no row, and the line would turn to "may be
-- behind" while the asks go on. Nor `fixture_detail_fetch.fetched_at`: an
-- answer that carried no statistics moves it too, and the page would show
-- the last figures as current. A row here moves only when an answer carried
-- statistics.
--
-- Its own table, not a column on `fixture_detail_fetch`: a row there says the
-- after-the-whistle detail was asked (T-102), which the backlog and the
-- module's `delayed` state read, and an ask during play must not say that.
-- No trigger: a page in play hears of the match every minute anyway (its
-- clock moves, or the live list's answer is told, D-209).
CREATE TABLE fixture_stat_check (
  fixture_id uuid PRIMARY KEY REFERENCES fixture (id) ON DELETE CASCADE,
  checked_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE fixture_stat_check IS
  'The newest provider answer that carried this fixture''s team statistics (T-1782); the match page''s "Stats updated" time.';

-- Down Migration

DROP TABLE fixture_stat_check;
