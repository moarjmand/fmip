-- Up Migration
-- T-332 (D-075): campaigns. An audience is a saved query, a send is a row.
--
-- `audience` is a saved filter over members -- a small closed vocabulary
-- (a followed team or competition, a country, a language, verified only,
-- joined after a date), all conditions together -- kept immutable so that
-- what a past campaign reached is still true later; a change is a new
-- audience. `campaign` is the message: a title, a body and the in-app path
-- it opens, bound to an audience, immutable too. Sending writes
-- `campaign_dispatch` first -- one row per campaign by its primary key, so a
-- second send of the same campaign finds it taken -- and then a
-- `campaign_send` row per member with what the inbox did (the notification's
-- dedupe key is the second guard), and `campaign_dispatch_result` when the
-- pass is over. Every row says who it reached; nobody is reached twice.
CREATE TABLE audience (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  filter     jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES user_account (id) ON DELETE RESTRICT,
  reason     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audience_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT audience_reason_not_blank CHECK (btrim(reason) <> '')
);

CREATE TABLE campaign (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audience_id uuid NOT NULL REFERENCES audience (id) ON DELETE RESTRICT,
  title       text NOT NULL,
  body        text NOT NULL,
  -- An in-app path, locale-less: what the notification opens.
  path        text NOT NULL,
  created_by  uuid NOT NULL REFERENCES user_account (id) ON DELETE RESTRICT,
  reason      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT campaign_body_not_blank CHECK (btrim(body) <> ''),
  CONSTRAINT campaign_path_is_in_app CHECK (path LIKE '/%' AND path NOT LIKE '//%'),
  CONSTRAINT campaign_reason_not_blank CHECK (btrim(reason) <> '')
);

CREATE TABLE campaign_dispatch (
  campaign_id   uuid PRIMARY KEY REFERENCES campaign (id) ON DELETE RESTRICT,
  started_by    uuid NOT NULL REFERENCES user_account (id) ON DELETE RESTRICT,
  started_at    timestamptz NOT NULL DEFAULT now(),
  audience_size integer NOT NULL,
  reason        text NOT NULL,
  CONSTRAINT campaign_dispatch_size_non_negative CHECK (audience_size >= 0),
  CONSTRAINT campaign_dispatch_reason_not_blank CHECK (btrim(reason) <> '')
);

CREATE TABLE campaign_send (
  campaign_id uuid NOT NULL REFERENCES campaign (id) ON DELETE RESTRICT,
  user_id     uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  outcome     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, user_id),
  CONSTRAINT campaign_send_outcome_check
    CHECK (outcome IN ('sent', 'delayed', 'muted', 'duplicate', 'failed'))
);

CREATE TABLE campaign_dispatch_result (
  campaign_id uuid PRIMARY KEY REFERENCES campaign_dispatch (campaign_id) ON DELETE RESTRICT,
  finished_at timestamptz NOT NULL DEFAULT now(),
  reached     integer NOT NULL,
  delayed     integer NOT NULL,
  muted       integer NOT NULL,
  duplicate   integer NOT NULL,
  failed      integer NOT NULL,
  CONSTRAINT campaign_dispatch_result_non_negative
    CHECK (reached >= 0 AND delayed >= 0 AND muted >= 0 AND duplicate >= 0 AND failed >= 0)
);

CREATE INDEX campaign_audience_idx ON campaign (audience_id);
CREATE INDEX campaign_send_user_idx ON campaign_send (user_id);

COMMENT ON TABLE audience IS 'A saved filter over members for campaigns (T-332, D-075); immutable, so what a past campaign reached stays true.';
COMMENT ON TABLE campaign IS 'One message to an audience: title, body and the in-app path it opens (T-332).';
COMMENT ON TABLE campaign_dispatch IS 'The send, claimed once per campaign by its primary key before any member is told (T-332).';
COMMENT ON TABLE campaign_send IS 'One member reached by one campaign, with what the inbox did; the primary key is why nobody is reached twice (T-332).';
COMMENT ON TABLE campaign_dispatch_result IS 'What a send added up to when the pass was over (T-332).';

CREATE TRIGGER audience_immutable
  BEFORE UPDATE OR DELETE ON audience FOR EACH ROW EXECUTE FUNCTION refuse_change();
CREATE TRIGGER campaign_immutable
  BEFORE UPDATE OR DELETE ON campaign FOR EACH ROW EXECUTE FUNCTION refuse_change();
CREATE TRIGGER campaign_dispatch_immutable
  BEFORE UPDATE OR DELETE ON campaign_dispatch FOR EACH ROW EXECUTE FUNCTION refuse_change();
CREATE TRIGGER campaign_send_immutable
  BEFORE UPDATE ON campaign_send FOR EACH ROW EXECUTE FUNCTION refuse_change();
CREATE TRIGGER campaign_dispatch_result_immutable
  BEFORE UPDATE OR DELETE ON campaign_dispatch_result FOR EACH ROW EXECUTE FUNCTION refuse_change();

-- The inbox's kind and subject lists gain the campaign.
ALTER TABLE notification DROP CONSTRAINT notification_kind_check;
ALTER TABLE notification ADD CONSTRAINT notification_kind_check CHECK (
  kind IN (
    'prediction_settled', 'rating_changed', 'career_points_awarded', 'friend_request',
    'friend_accepted', 'message_received', 'mentioned', 'group_invite', 'group_join_request',
    'moderation_decision', 'contributor_granted', 'contributor_grant_changed', 'panel_reaction',
    'briefing', 'campaign'
  )
);
ALTER TABLE notification_preference DROP CONSTRAINT notification_preference_kind_check;
ALTER TABLE notification_preference ADD CONSTRAINT notification_preference_kind_check CHECK (
  kind IN (
    'prediction_settled', 'rating_changed', 'career_points_awarded', 'friend_request',
    'friend_accepted', 'message_received', 'mentioned', 'group_invite', 'group_join_request',
    'moderation_decision', 'contributor_granted', 'contributor_grant_changed', 'panel_reaction',
    'briefing', 'campaign'
  )
);
ALTER TABLE notification DROP CONSTRAINT notification_subject_kind;
ALTER TABLE notification ADD CONSTRAINT notification_subject_kind CHECK (
  subject_type IN (
    'fixture', 'member', 'group', 'conversation', 'message', 'panel_post', 'prediction',
    'sanction', 'briefing', 'campaign'
  )
);

-- Down Migration

ALTER TABLE notification DROP CONSTRAINT notification_subject_kind;
ALTER TABLE notification ADD CONSTRAINT notification_subject_kind CHECK (
  subject_type IN (
    'fixture', 'member', 'group', 'conversation', 'message', 'panel_post', 'prediction',
    'sanction', 'briefing'
  )
);
ALTER TABLE notification_preference DROP CONSTRAINT notification_preference_kind_check;
ALTER TABLE notification_preference ADD CONSTRAINT notification_preference_kind_check CHECK (
  kind IN (
    'prediction_settled', 'rating_changed', 'career_points_awarded', 'friend_request',
    'friend_accepted', 'message_received', 'mentioned', 'group_invite', 'group_join_request',
    'moderation_decision', 'contributor_granted', 'contributor_grant_changed', 'panel_reaction',
    'briefing'
  )
);
ALTER TABLE notification DROP CONSTRAINT notification_kind_check;
ALTER TABLE notification ADD CONSTRAINT notification_kind_check CHECK (
  kind IN (
    'prediction_settled', 'rating_changed', 'career_points_awarded', 'friend_request',
    'friend_accepted', 'message_received', 'mentioned', 'group_invite', 'group_join_request',
    'moderation_decision', 'contributor_granted', 'contributor_grant_changed', 'panel_reaction',
    'briefing'
  )
);
DROP TABLE campaign_dispatch_result;
DROP TABLE campaign_send;
DROP TABLE campaign_dispatch;
DROP TABLE campaign;
DROP TABLE audience;
