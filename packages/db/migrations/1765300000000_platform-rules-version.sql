-- Up Migration

-- ---------------------------------------------------------------------------
-- The platform-rules version a member accepted (blueprint 7.1 and 9.4,
-- 13-policy.md, T-931, D-113).
--
-- `13-policy.md` says a registration stores which platform rules were
-- accepted; until now only *when* was stored (`accepted_rules_at`). Three
-- pieces make the promise in the rules' own *Changes* clause keepable:
--
--   * `platform_rules_version`: every published version with its text, never
--     changed once written. Publishing a new version is inserting a row; the
--     one in force is the highest version number, not the latest timestamp,
--     so a clock cannot reorder them.
--   * `user_account.accepted_rules_version`, beside `accepted_rules_at`: the
--     version that applies to the member, and when they accepted it. A newer
--     published version does not apply to them until they accept it.
--   * `platform_rules_acceptance`: every acceptance, one row per member and
--     version, so an earlier acceptance is not lost when a later one updates
--     the two columns.
--
-- Backfill: `platform-rules@1.0.0` is the only version that has ever been
-- published (approved 2026-09-15), so every existing account accepted it, at
-- its own `accepted_rules_at`. The column's default says the same for a row
-- written without naming a version (fixtures, load scripts): such a member is
-- asked for any newer version rather than assumed to have accepted it.
-- ---------------------------------------------------------------------------
CREATE TABLE platform_rules_version (
  version       text PRIMARY KEY,
  body          text NOT NULL,
  published_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_rules_version_format
    CHECK (version ~ '^platform-rules@[0-9]+\.[0-9]+\.[0-9]+$'),
  CONSTRAINT platform_rules_version_body_not_blank CHECK (btrim(body) <> '')
);

COMMENT ON TABLE platform_rules_version IS
  'Every published version of the platform rules with its text; insert-only (T-931, D-113).';

-- The text approved on 2026-09-15 (13-policy.md section 4), as plain
-- paragraphs; a paragraph of "- " lines is a list.
INSERT INTO platform_rules_version (version, body, published_at) VALUES (
  'platform-rules@1.0.0',
  $rules$Joining. You need an e-mail address you can receive mail at, a username nobody else has, and to be old enough to hold an account where you live. One account per person.

What this place is for. Football: matches, predictions, analysis and argument about all three. Predictions here are a record of what you thought and when. They are not betting advice, nothing here is a wager, and no money changes hands.

What is not allowed.

- Spam. Repeated unwanted messages, advertising, or link-dropping.
- Abuse. Harassment, threats, slurs, or targeting somebody for who they are.
- Impersonation. Presenting yourself as another person, a club, a journalist, or this platform.

Your rating is earned and is shown. A Performance Rating is computed from your settled predictions and can be recomputed from them. It is not a score you can be given, and it is not one that can be taken from you as a punishment.

Reports and decisions. Anybody can report a member. A person reads every report and records what they decided, including deciding that nothing was wrong. A decision can restrict what you can do, for a stated time or permanently, and you are told which and why.

Appeals. Every decision can be appealed once, in writing, and the appeal is kept with the decision.

Leaving. You can delete your account, from Settings, with your password and your username typed again. It happens at once and cannot be undone.

- Removed: your e-mail address, password, display name, biography, preferences, every signed-in session, push subscriptions, the teams and members you follow and who follows you, friendships, friend requests, blocks, group memberships and group invitations, your unsubmitted analysis drafts, and the news stories you saved.
- Kept, without your name: your predictions and their settlements, which are what other people's ratings were computed against, and your rating history, which is shown nowhere. Messages you wrote in conversations and posts on a match panel stay where they are, shown as written by "a deleted member".
- Taken down: community analysis you published.
- Kept for the moderation record: reports you made, and any decision about you.
- Your username is retired: nobody can register it after you.
- A group you own passes to its longest-standing moderator, or else its longest-standing member. A group with nobody else in it is deleted, or closed to new members if messages were written in it.

The deletion is recorded (who asked and when), without a copy of what was removed.

Changes. If these rules change in a way that affects what is allowed, you are told before the change applies, and asked to accept the new version.$rules$,
  '2026-09-15T00:00:00Z'
);

-- Every existing row gets 1.0.0 from the default, in the same statement.
ALTER TABLE user_account
  ADD COLUMN accepted_rules_version text NOT NULL DEFAULT 'platform-rules@1.0.0'
    REFERENCES platform_rules_version (version) ON DELETE RESTRICT;

COMMENT ON COLUMN user_account.accepted_rules_version IS
  'The platform-rules version that applies to the member, accepted at accepted_rules_at (T-931, D-113).';

CREATE TABLE platform_rules_acceptance (
  user_id      uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  version      text NOT NULL REFERENCES platform_rules_version (version) ON DELETE RESTRICT,
  accepted_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, version)
);

COMMENT ON TABLE platform_rules_acceptance IS
  'Every platform-rules version each member accepted, and when (T-931, D-113).';

INSERT INTO platform_rules_acceptance (user_id, version, accepted_at)
SELECT id, 'platform-rules@1.0.0', accepted_rules_at FROM user_account;

-- Down Migration

DROP TABLE platform_rules_acceptance;
ALTER TABLE user_account DROP COLUMN accepted_rules_version;
DROP TABLE platform_rules_version;
