-- Up Migration
-- T-1012 (D-131): a reviewer's reason for passing a failing automatic check on
-- one translated version.
--
-- The checks themselves are a pure function (`checkTranslation` in
-- `@fmip/contracts`) and store nothing: they are recomputed from the two
-- versions whenever they are asked. What is stored is the one thing a person
-- decided -- "this check fails and the translation is right anyway, because
-- ..." -- against the exact version they read, naming who decided it. The
-- review endpoint refuses a version with a failing check that has no row
-- here.
--
-- The row belongs to a version, by the version's own key, and goes only with
-- its article (the same immutability as the version itself, T-141): a later
-- version is checked again from nothing, because it is different words.
CREATE TABLE translation_check_override (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id      uuid NOT NULL,
  language        text NOT NULL,
  version_number  integer NOT NULL,
  check_name      text NOT NULL,
  field           text NOT NULL,
  reason          text NOT NULL,
  reviewer_id     uuid NOT NULL REFERENCES user_account (id) ON DELETE RESTRICT,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT translation_check_override_version_fk
    FOREIGN KEY (article_id, language, version_number)
    REFERENCES article_version (article_id, language, version_number) ON DELETE CASCADE,
  CONSTRAINT translation_check_override_check_name
    CHECK (check_name IN ('empty', 'numbers', 'scorelines', 'dates', 'names', 'links', 'markup')),
  CONSTRAINT translation_check_override_field
    CHECK (field IN ('headline', 'summary', 'byline')),
  CONSTRAINT translation_check_override_reason_not_blank CHECK (btrim(reason) <> ''),
  -- One reason per check per field per version: a second would be two people
  -- disagreeing about why, and the first one stands.
  CONSTRAINT translation_check_override_once UNIQUE (article_id, language, version_number, check_name, field)
);

COMMENT ON TABLE translation_check_override IS
  'A reviewer''s recorded reason for passing one failing automatic check on one translated article version (T-1012, D-131). Immutable; audited in audit_log as translation.check_override.';

CREATE TRIGGER translation_check_override_immutable
  BEFORE UPDATE OR DELETE ON translation_check_override
  FOR EACH ROW EXECUTE FUNCTION refuse_change_unless_article_gone();

-- A reason is given for a person's translation, never for the publisher's own
-- words, which nobody reviews here.
CREATE FUNCTION translation_check_override_on_translation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM article_version
     WHERE article_id = NEW.article_id AND language = NEW.language
       AND version_number = NEW.version_number AND origin = 'translation'
  ) THEN
    RAISE EXCEPTION 'a check is passed with a reason only on a translation'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER translation_check_override_on_translation
  BEFORE INSERT ON translation_check_override
  FOR EACH ROW EXECUTE FUNCTION translation_check_override_on_translation();

-- Down Migration
DROP TRIGGER translation_check_override_on_translation ON translation_check_override;
DROP FUNCTION translation_check_override_on_translation();
DROP TRIGGER translation_check_override_immutable ON translation_check_override;
DROP TABLE translation_check_override;
