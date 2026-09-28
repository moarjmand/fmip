-- Up Migration
-- T-803: API errors and job failures counted, one row per UTC hour and key,
-- incremented in place, kept for thirty days. Compact on purpose: a storm of
-- a thousand 500s on one route in one hour is one row with count 1000. Each
-- row keeps the id of its newest failure so the log line can be found; no
-- message, stack or request body is stored (they stay in the log, D-044).
-- Additive, no backfill.

CREATE TABLE http_error_count (
  hour            timestamptz NOT NULL,
  method          text NOT NULL,
  route           text NOT NULL,
  status          smallint NOT NULL,
  count           integer NOT NULL,
  last_request_id text NOT NULL,
  last_at         timestamptz NOT NULL,
  PRIMARY KEY (hour, method, route, status),
  CONSTRAINT http_error_count_is_5xx CHECK (status BETWEEN 500 AND 599),
  CONSTRAINT http_error_count_positive CHECK (count > 0),
  CONSTRAINT http_error_count_whole_hour CHECK (hour = date_bin('1 hour', hour, timestamptz '2000-01-01 00:00:00+00')),
  CONSTRAINT http_error_count_request_id CHECK (last_request_id ~ '^[A-Za-z0-9._-]{8,128}$'),
  CONSTRAINT http_error_count_route_length CHECK (length(route) BETWEEN 1 AND 300)
);

COMMENT ON TABLE http_error_count IS
  '5xx responses per UTC hour, method, route template and status (T-803), with the request id of the newest. Rows older than 30 days are deleted.';

CREATE TABLE job_failure_count (
  hour        timestamptz NOT NULL,
  queue       text NOT NULL,
  job         text NOT NULL,
  kind        text NOT NULL,
  count       integer NOT NULL,
  last_job_id text,
  last_at     timestamptz NOT NULL,
  PRIMARY KEY (hour, queue, job, kind),
  CONSTRAINT job_failure_count_kind CHECK (kind IN ('failed', 'stalled')),
  CONSTRAINT job_failure_count_positive CHECK (count > 0),
  CONSTRAINT job_failure_count_whole_hour CHECK (hour = date_bin('1 hour', hour, timestamptz '2000-01-01 00:00:00+00'))
);

COMMENT ON TABLE job_failure_count IS
  'Failed and stalled BullMQ jobs per UTC hour, queue, job name and kind (T-803), with the id of the newest. Rows older than 30 days are deleted.';

-- Down Migration

DROP TABLE job_failure_count;
DROP TABLE http_error_count;
