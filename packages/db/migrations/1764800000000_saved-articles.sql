-- Up Migration
-- T-842 (blueprint 3.3 and 2.1): a member saves a news story and finds it
-- again under Following -> Saved.
--
-- One row per member per story, holding ids only. Nothing of the
-- publisher's is copied here: the headline and the link are read from the
-- article each time (D-061, headline and link), so a publisher who is
-- dropped takes their words out of every saved list at the same moment as
-- everywhere else -- the drop trigger deletes the article, `article_id`
-- becomes null, and the list says the publisher was dropped rather than
-- showing a dead link. `source_id` is what lets it name them: the source row
-- stays when dropped, dated and with the reason.
--
-- Private to the member: read and written only through `/me/saved-articles`.
-- Removed with the account's personal data on deletion (D-094); the cascade
-- on `user_account` is for tests and tooling that delete accounts outright.
-- Additive: no existing row changes, no backfill.

CREATE TABLE saved_article (
  user_id    uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  story_id   uuid NOT NULL REFERENCES story (id) ON DELETE CASCADE,
  -- The report the member saved (the story's promoted original at the time);
  -- null once it is gone, which only its publisher being dropped does.
  article_id uuid REFERENCES article (id) ON DELETE SET NULL,
  source_id  uuid NOT NULL REFERENCES news_source (id) ON DELETE CASCADE,
  saved_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, story_id)
);

CREATE INDEX saved_article_user_saved_idx ON saved_article (user_id, saved_at DESC);

COMMENT ON TABLE saved_article IS
  'Stories a member saved (T-842): ids only, the words read live from the article under its source''s rights (D-061); private; removed on account deletion (D-094).';

-- Down Migration
DROP TABLE saved_article;
