-- Up Migration

-- T-042: following and favourites. One row per (member, entity): the row's
-- existence is "following"; the flag is "favourite". A favourite is always
-- followed, so the scores page can pin favourites and the feed can include
-- everything followed without a second table.
--
-- entity_id is polymorphic over team, competition and person, so it is not a
-- foreign key (same reasoning as provider_mapping.internal_id, T-012): the
-- profile service checks the target exists when a row is written, and a
-- catalog row that is later deleted leaves a dangling follow that the reads
-- below simply do not join to.
CREATE TABLE followed_entity (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id   uuid NOT NULL,
  favourite   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT followed_entity_type_check CHECK (entity_type IN ('team', 'competition', 'person')),
  CONSTRAINT followed_entity_unique UNIQUE (user_id, entity_type, entity_id)
);

-- "Who follows this team": follower counts on the team page (blueprint 5.2).
CREATE INDEX followed_entity_entity_idx ON followed_entity (entity_type, entity_id);

CREATE TRIGGER followed_entity_set_updated_at
  BEFORE UPDATE ON followed_entity FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE followed_entity IS
  'A member following a team, competition or person. favourite = pinned. One row per (user, entity).';

-- Down Migration

DROP TABLE IF EXISTS followed_entity;
