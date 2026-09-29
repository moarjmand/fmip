-- Up Migration

-- ---------------------------------------------------------------------------
-- A story's type (blueprint 3.2, T-1001, D-123).
--
-- The vocabulary is blueprint 3.2's eleven and nothing else; the contract's
-- `STORY_TYPES` is the same list and `story-label.schema.spec.ts` fails when
-- the two differ. A type has exactly two origins:
--
-- - `publisher`: the publisher's own category on the story's promoted original,
--   mapped by an exact, committed list (T-1002). The row names the article and
--   the category string it came from, so a reader's "why is this a transfer?"
--   has an answer that is a fact about the feed.
-- - `editor`: a person with the `editor` or `admin` role, with a reason. The
--   write and its `audit_log` row are one transaction (rule 10).
--
-- Nothing labels a story by machine (N-1): a third origin needs a decision
-- entry and a migration, and the check below refuses one until then.
--
-- A label is never edited. A new label supersedes the current one: the old
-- row keeps its words and gains `superseded_at`: when a newer label replaced
-- it, or when its basis went away (the promoted original lost its mapped
-- category). What replaced it is the next row by `created_at`. There is no
-- pointer column on purpose: a publisher's label goes with its article when
-- the publisher is dropped (D-061), and a pointer to it would make the drop
-- fail. One current label per story by a partial unique
-- index. A story with no current label has no type, and says so
-- (`not_supplied`), never a default.
-- ---------------------------------------------------------------------------
CREATE TABLE story_label (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id           uuid NOT NULL REFERENCES story (id) ON DELETE CASCADE,
  story_type         text NOT NULL,
  origin             text NOT NULL,
  -- publisher: the report and the exact category string the mapping matched.
  source_article_id  uuid REFERENCES article (id) ON DELETE CASCADE,
  source_category    text,
  -- editor: who, and why.
  labelled_by        uuid REFERENCES user_account (id) ON DELETE RESTRICT,
  reason             text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  superseded_at      timestamptz,
  CONSTRAINT story_label_type_known CHECK (story_type IN (
    'breaking_news', 'transfer', 'injury', 'suspension', 'tactical_analysis',
    'match_preview', 'match_report', 'interview', 'opinion', 'data_analysis',
    'explainer'
  )),
  CONSTRAINT story_label_origin_known CHECK (origin IN ('publisher', 'editor')),
  CONSTRAINT story_label_publisher_is_whole CHECK (
    origin <> 'publisher'
    OR (source_article_id IS NOT NULL AND source_category IS NOT NULL
        AND labelled_by IS NULL AND reason IS NULL)
  ),
  CONSTRAINT story_label_editor_is_whole CHECK (
    origin <> 'editor'
    OR (labelled_by IS NOT NULL AND reason IS NOT NULL AND btrim(reason) <> ''
        AND source_article_id IS NULL AND source_category IS NULL)
  ),
  CONSTRAINT story_label_superseded_after CHECK (
    superseded_at IS NULL OR superseded_at >= created_at
  )
);

CREATE UNIQUE INDEX story_label_one_current_per_story
  ON story_label (story_id) WHERE superseded_at IS NULL;

CREATE INDEX story_label_current_type_idx
  ON story_label (story_type) WHERE superseded_at IS NULL;

COMMENT ON TABLE story_label IS
  'A story''s type from blueprint 3.2, from the publisher''s mapped category or an editor, superseded and never edited (T-1001, D-123).';

-- The only change a label ever takes is being superseded, once.
CREATE OR REPLACE FUNCTION story_label_supersede_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.superseded_at IS NOT NULL
     OR NEW.superseded_at IS NULL
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.story_id IS DISTINCT FROM OLD.story_id
     OR NEW.story_type IS DISTINCT FROM OLD.story_type
     OR NEW.origin IS DISTINCT FROM OLD.origin
     OR NEW.source_article_id IS DISTINCT FROM OLD.source_article_id
     OR NEW.source_category IS DISTINCT FROM OLD.source_category
     OR NEW.labelled_by IS DISTINCT FROM OLD.labelled_by
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'story_label rows are superseded, never edited (D-123); write a new label'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER story_label_supersede_only
  BEFORE UPDATE ON story_label FOR EACH ROW EXECUTE FUNCTION story_label_supersede_only();

-- Down Migration

DROP TABLE story_label;
DROP FUNCTION story_label_supersede_only();
