-- Up Migration

-- T-273: when quiet hours end, so a held notification knows when to arrive.
--
-- `in_quiet_hours` (T-270) answers "is it quiet now". Delaying one needs the
-- other half: **until when**. Both live in SQL and for the same reason -- the
-- window is in the member's own timezone, the wrap-around is three lines, and
-- three lines written twice is two chances to get it wrong.

CREATE FUNCTION quiet_hours_end(member uuid, moment timestamptz) RETURNS timestamptz
LANGUAGE sql STABLE AS $$
  SELECT CASE
    -- Not quiet: nothing to wait for. Null rather than `moment`, because
    -- "deliver now" and "the quiet window ends now" are different facts and a
    -- caller should not have to tell them apart by comparing timestamps.
    WHEN NOT in_quiet_hours(member, moment) THEN NULL
    ELSE (
      SELECT (
        -- The local date the window ends on: today when the end is still
        -- ahead on their clock, tomorrow when it is behind. That one CASE is
        -- what makes a window through midnight work without a second branch:
        -- at 23:30 the 07:00 end is behind, so it is tomorrow's; at 03:00 it
        -- is ahead, so it is today's.
        CASE
          WHEN (moment AT TIME ZONE u.timezone)::time < q.ends_at
            THEN (moment AT TIME ZONE u.timezone)::date
          ELSE (moment AT TIME ZONE u.timezone)::date + 1
        END + q.ends_at
      ) AT TIME ZONE u.timezone
        FROM quiet_hours q
        JOIN user_account u ON u.id = q.user_id
       WHERE q.user_id = member
    )
  END
$$;

COMMENT ON FUNCTION quiet_hours_end(uuid, timestamptz) IS
  'When the member''s quiet window ends, as an instant, or null when it is not quiet (T-273). Read in their own timezone; handles a window through midnight.';

-- ---------------------------------------------------------------------------
-- notification.held_count
-- ---------------------------------------------------------------------------
-- How many more like this one were refused behind it (T-273).
--
-- A counter rather than a number derived at read time, because the things being
-- counted **were never written** -- that is what the cap does -- so there is
-- nothing to count. The first attempt inferred it from the rows in the hour and
-- could only ever say "1 more", which is the arithmetic being honest about
-- having no inputs.
--
-- `held_reason` is the sentence and this is the number behind it. Two columns
-- for one fact is usually a mistake; here the sentence is what a member reads
-- and the count is what the next suppression increments, and deriving either
-- from the other means parsing prose.
ALTER TABLE notification ADD COLUMN held_count integer NOT NULL DEFAULT 0;

ALTER TABLE notification ADD CONSTRAINT notification_held_count_non_negative
  CHECK (held_count >= 0);

COMMENT ON COLUMN notification.held_count IS
  'How many further notifications of this kind were refused behind this one within the hour (T-273).';

-- Down Migration

ALTER TABLE notification DROP CONSTRAINT IF EXISTS notification_held_count_non_negative;
ALTER TABLE notification DROP COLUMN IF EXISTS held_count;
DROP FUNCTION IF EXISTS quiet_hours_end(uuid, timestamptz);
