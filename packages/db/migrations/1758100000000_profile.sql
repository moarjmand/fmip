-- Up Migration

-- T-041: the profile boundary's first two tables. profile holds what a member
-- says about themselves; privacy_setting holds who may see it. Both are
-- keyed by the account and vanish with it. favourites and following (T-042)
-- join this boundary next.
--
-- A missing row means the defaults: an empty profile, and public visibility.
-- The API composes the page from user_account plus these, so registration
-- does not have to know the profile boundary exists.

CREATE TABLE profile (
  user_id    uuid PRIMARY KEY REFERENCES user_account (id) ON DELETE CASCADE,
  bio        text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profile_bio_length CHECK (bio IS NULL OR char_length(bio) <= 500),
  CONSTRAINT profile_avatar_url_format CHECK (avatar_url IS NULL OR avatar_url ~ '^https?://')
);

COMMENT ON TABLE profile IS
  'What a member says about themselves. Absent row = empty profile.';

-- The three levels from blueprint 7.2. 'friends' is enforced through the
-- friendship oracle in the API; with no friendships in Phase 1 it behaves as
-- private for everyone but the owner, which is exactly what friends-only with
-- zero friends means.
CREATE TABLE privacy_setting (
  user_id                       uuid PRIMARY KEY REFERENCES user_account (id) ON DELETE CASCADE,
  profile_visibility            text NOT NULL DEFAULT 'public',
  prediction_history_visibility text NOT NULL DEFAULT 'public',
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT privacy_setting_profile_check
    CHECK (profile_visibility IN ('public', 'friends', 'private')),
  CONSTRAINT privacy_setting_history_check
    CHECK (prediction_history_visibility IN ('public', 'friends', 'private'))
);

COMMENT ON TABLE privacy_setting IS
  'Who may see the profile and the prediction history: public, friends or private. Absent row = public.';

CREATE TRIGGER profile_set_updated_at
  BEFORE UPDATE ON profile FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER privacy_setting_set_updated_at
  BEFORE UPDATE ON privacy_setting FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE IF EXISTS privacy_setting;
DROP TABLE IF EXISTS profile;
