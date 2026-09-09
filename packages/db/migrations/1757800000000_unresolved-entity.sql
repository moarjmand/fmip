-- Up Migration

-- T-013: the unresolved queue. When a provider hands ingestion an id that
-- provider_mapping does not know, the entity resolver writes it here and
-- stops. It never creates a catalog row from a guess (02-architecture.md,
-- "Identity resolution"): a human, or a later rule, links the external id to
-- an internal UUID, and only then does provider_mapping learn it.
--
-- One row per (provider, entity_type, external_id), for ever. Seeing the same
-- unknown id again bumps seen_count and last_seen_at on the existing row; it
-- does not add a second one. That is the acceptance criterion for T-013
-- expressed as a UNIQUE constraint rather than as application discipline.
--
-- payload is whatever the adapter chose to keep for the reviewer (a name, a
-- country, a kick-off time). It is provider-shaped and stays inside the
-- ingestion boundary; nothing here is served by the API (rule 2).
--
-- Resolution is audited (rule 10): who, when, why, and to what. A resolved or
-- ignored row keeps its history rather than being deleted.
CREATE TABLE unresolved_entity (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider             text NOT NULL,
  entity_type          text NOT NULL,
  external_id          text NOT NULL,
  payload              jsonb,
  status               text NOT NULL DEFAULT 'pending',
  seen_count           integer NOT NULL DEFAULT 1,
  first_seen_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at         timestamptz NOT NULL DEFAULT now(),
  resolved_internal_id uuid,
  resolved_by          text,
  resolved_at          timestamptz,
  resolution_note      text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unresolved_entity_provider_check
    CHECK (provider IN ('api_football', 'football_data_org', 'highlightly')),
  CONSTRAINT unresolved_entity_entity_type_check CHECK (
    entity_type IN ('country', 'competition', 'season', 'stage', 'venue', 'team', 'person', 'fixture')
  ),
  CONSTRAINT unresolved_entity_external_id_not_blank CHECK (btrim(external_id) <> ''),
  CONSTRAINT unresolved_entity_status_check CHECK (status IN ('pending', 'resolved', 'ignored')),
  CONSTRAINT unresolved_entity_seen_count_positive CHECK (seen_count >= 1),
  CONSTRAINT unresolved_entity_seen_ordered CHECK (last_seen_at >= first_seen_at),
  -- Each status carries exactly its own fields. A resolved row names its
  -- target, actor and time; an ignored row names actor and time and has no
  -- target; a pending row has none of the three. resolution_note is free in
  -- every state, so a reopened row can keep the history of its earlier
  -- resolution in prose.
  CONSTRAINT unresolved_entity_status_fields_consistent CHECK (
    CASE status
      WHEN 'resolved' THEN
        resolved_internal_id IS NOT NULL AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL
      WHEN 'ignored' THEN
        resolved_internal_id IS NULL AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL
      ELSE
        resolved_internal_id IS NULL AND resolved_by IS NULL AND resolved_at IS NULL
    END
  ),
  CONSTRAINT unresolved_entity_unique UNIQUE (provider, entity_type, external_id)
);

-- The review queue: what is pending, most recently seen first.
CREATE INDEX unresolved_entity_pending_idx
  ON unresolved_entity (last_seen_at DESC)
  WHERE status = 'pending';

CREATE TRIGGER unresolved_entity_set_updated_at
  BEFORE UPDATE ON unresolved_entity FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE unresolved_entity IS
  'Provider ids that provider_mapping does not know. One row per (provider, entity_type, external_id); re-seeing bumps seen_count. Resolution is audited.';

-- Down Migration

DROP TABLE IF EXISTS unresolved_entity;
