/**
 * Structural validation of normalised shapes and adapter manifests.
 *
 * Hand-written rather than a schema library: the rules are few, they are the
 * rules of the database (T-010 to T-012) restated at the boundary, and a
 * problem message that names the path and the rule is the whole point.
 * Every validator returns problems instead of throwing, so one run reports
 * everything wrong with a payload.
 */

import type { AdapterManifest } from '../adapters/_contract';
import {
  FIXTURE_STATUSES,
  INCIDENT_KINDS,
  PERIOD_KINDS,
  POSITIONS,
  PROVIDERS,
  STAGE_KINDS,
  STAT_METRICS,
} from '../normalised';

export interface Problem {
  path: string;
  message: string;
}

type Sink = Problem[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(sink: Sink, path: string, message: string): void {
  sink.push({ path, message });
}

function expectRecord(sink: Sink, value: unknown, path: string): value is Record<string, unknown> {
  if (!isRecord(value)) {
    fail(sink, path, 'must be an object');
    return false;
  }
  return true;
}

function expectString(sink: Sink, value: unknown, path: string): value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(sink, path, 'must be a non-blank string');
    return false;
  }
  return true;
}

function expectNullableString(sink: Sink, value: unknown, path: string): void {
  if (value === null) return;
  expectString(sink, value, path);
}

function expectInt(sink: Sink, value: unknown, path: string, min: number, max?: number): void {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    fail(sink, path, 'must be an integer');
    return;
  }
  if (value < min) fail(sink, path, `must be >= ${min}`);
  if (max !== undefined && value > max) fail(sink, path, `must be <= ${max}`);
}

function expectNullableInt(
  sink: Sink,
  value: unknown,
  path: string,
  min: number,
  max?: number,
): void {
  if (value === null) return;
  expectInt(sink, value, path, min, max);
}

function expectNumber(sink: Sink, value: unknown, path: string, min: number, max?: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(sink, path, 'must be a finite number');
    return;
  }
  if (value < min) fail(sink, path, `must be >= ${min}`);
  if (max !== undefined && value > max) fail(sink, path, `must be <= ${max}`);
}

function expectBoolean(sink: Sink, value: unknown, path: string): void {
  if (typeof value !== 'boolean') fail(sink, path, 'must be a boolean');
}

function expectEnum(sink: Sink, value: unknown, path: string, allowed: readonly string[]): boolean {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    fail(sink, path, `must be one of ${allowed.join(', ')}; received ${JSON.stringify(value)}`);
    return false;
  }
  return true;
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export function expectTimestamp(sink: Sink, value: unknown, path: string): void {
  if (typeof value !== 'string' || !ISO_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) {
    fail(sink, path, 'must be an ISO 8601 timestamp with a zone, e.g. 2025-01-05T16:30:00Z');
  }
}

function expectRef(sink: Sink, value: unknown, path: string): void {
  if (!expectRecord(sink, value, path)) return;
  expectString(sink, value.externalId, `${path}.externalId`);
  expectString(sink, value.name, `${path}.name`);
}

function expectNullableRef(sink: Sink, value: unknown, path: string): void {
  if (value === null) return;
  expectRef(sink, value, path);
}

function expectLooseRef(sink: Sink, value: unknown, path: string): void {
  if (!expectRecord(sink, value, path)) return;
  expectNullableString(sink, value.externalId, `${path}.externalId`);
  expectString(sink, value.name, `${path}.name`);
}

function expectNullableScore(sink: Sink, value: unknown, path: string): void {
  if (value === null) return;
  if (!expectRecord(sink, value, path)) return;
  expectInt(sink, value.home, `${path}.home`, 0);
  expectInt(sink, value.away, `${path}.away`, 0);
}

function expectArray(sink: Sink, value: unknown, path: string): value is unknown[] {
  if (!Array.isArray(value)) {
    fail(sink, path, 'must be an array');
    return false;
  }
  return true;
}

function noDuplicates(sink: Sink, values: unknown[], path: string, what: string): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) fail(sink, `${path}[${index}]`, `duplicate ${what} ${key}`);
    seen.add(key);
  });
}

export function validateFixture(value: unknown, path = 'fixture'): Problem[] {
  const sink: Sink = [];
  if (!expectRecord(sink, value, path)) return sink;

  expectString(sink, value.externalId, `${path}.externalId`);
  expectRef(sink, value.competition, `${path}.competition`);

  if (expectRecord(sink, value.season, `${path}.season`)) {
    expectString(sink, value.season.label, `${path}.season.label`);
    expectInt(sink, value.season.startYear, `${path}.season.startYear`, 1850, 2100);
  }

  if (value.stage !== null && expectRecord(sink, value.stage, `${path}.stage`)) {
    expectString(sink, value.stage.name, `${path}.stage.name`);
    expectEnum(sink, value.stage.kind, `${path}.stage.kind`, STAGE_KINDS);
  }

  expectNullableString(sink, value.round, `${path}.round`);
  expectTimestamp(sink, value.kickoffAt, `${path}.kickoffAt`);
  const statusOk = expectEnum(sink, value.status, `${path}.status`, FIXTURE_STATUSES);
  expectNullableInt(sink, value.minute, `${path}.minute`, 0, 150);
  if (statusOk && value.minute !== null && value.status !== 'live') {
    fail(sink, `${path}.minute`, 'must be null unless status is live');
  }

  expectRef(sink, value.home, `${path}.home`);
  expectRef(sink, value.away, `${path}.away`);
  if (
    isRecord(value.home) &&
    isRecord(value.away) &&
    typeof value.home.externalId === 'string' &&
    value.home.externalId === value.away.externalId
  ) {
    fail(sink, `${path}.away.externalId`, 'a team cannot play itself');
  }

  if (value.venue !== null) {
    expectLooseRef(sink, value.venue, `${path}.venue`);
    if (isRecord(value.venue)) expectNullableString(sink, value.venue.city, `${path}.venue.city`);
  }
  if (value.referee !== null) expectLooseRef(sink, value.referee, `${path}.referee`);

  if (expectRecord(sink, value.scores, `${path}.scores`)) {
    for (const kind of ['current', 'halfTime', 'fullTime', 'extraTime', 'penalties', 'aggregate']) {
      if (!(kind in value.scores)) {
        fail(sink, `${path}.scores.${kind}`, 'must be present (null when not supplied)');
        continue;
      }
      expectNullableScore(sink, value.scores[kind], `${path}.scores.${kind}`);
    }
    if (statusOk && value.status === 'finished' && value.scores.fullTime === null) {
      fail(sink, `${path}.scores.fullTime`, 'a finished fixture must carry a full-time score');
    }
  }

  expectTimestamp(sink, value.lastUpdatedAt, `${path}.lastUpdatedAt`);
  return sink;
}

export function validateIncident(value: unknown, path = 'incident'): Problem[] {
  const sink: Sink = [];
  if (!expectRecord(sink, value, path)) return sink;

  expectString(sink, value.fixtureExternalId, `${path}.fixtureExternalId`);
  expectInt(sink, value.sequence, `${path}.sequence`, 1);
  expectInt(sink, value.minute, `${path}.minute`, 0, 150);
  expectNullableInt(sink, value.addedTime, `${path}.addedTime`, 0, 30);
  const kindOk = expectEnum(sink, value.kind, `${path}.kind`, INCIDENT_KINDS);
  if (value.side !== null) expectEnum(sink, value.side, `${path}.side`, ['home', 'away']);
  expectNullableRef(sink, value.player, `${path}.player`);
  expectNullableRef(sink, value.relatedPlayer, `${path}.relatedPlayer`);
  expectNullableString(sink, value.detail, `${path}.detail`);

  if (kindOk && value.kind !== 'var' && value.player === null) {
    fail(sink, `${path}.player`, `a ${String(value.kind)} needs a player`);
  }
  if (kindOk && value.kind === 'substitution' && value.relatedPlayer === null) {
    fail(sink, `${path}.relatedPlayer`, 'a substitution needs the player coming on');
  }
  return sink;
}

function validateSideLineup(sink: Sink, value: unknown, path: string): void {
  if (!expectRecord(sink, value, path)) return;

  expectNullableString(sink, value.formation, `${path}.formation`);
  if (typeof value.formation === 'string' && !/^[0-9](-[0-9]){2,4}$/.test(value.formation)) {
    fail(sink, `${path}.formation`, 'must look like 4-3-3');
  }
  expectNullableRef(sink, value.coach, `${path}.coach`);

  if (!expectArray(sink, value.players, `${path}.players`)) return;

  let captains = 0;
  value.players.forEach((player, index) => {
    const p = `${path}.players[${index}]`;
    if (!expectRecord(sink, player, p)) return;
    expectRef(sink, player, p);
    expectEnum(sink, player.role, `${p}.role`, ['starter', 'bench']);
    expectNullableInt(sink, player.shirtNumber, `${p}.shirtNumber`, 1, 99);
    if (player.position !== null) expectEnum(sink, player.position, `${p}.position`, POSITIONS);
    expectBoolean(sink, player.isCaptain, `${p}.isCaptain`);
    if (player.isCaptain === true) captains += 1;
  });

  if (captains > 1) fail(sink, `${path}.players`, 'at most one captain per side');
  noDuplicates(
    sink,
    value.players.map((player) => (isRecord(player) ? player.externalId : player)),
    `${path}.players`,
    'player',
  );
  noDuplicates(
    sink,
    value.players
      .map((player) => (isRecord(player) ? player.shirtNumber : null))
      .filter((n) => n !== null),
    `${path}.players`,
    'shirt number',
  );
}

export function validateLineup(value: unknown, path = 'lineup'): Problem[] {
  const sink: Sink = [];
  if (!expectRecord(sink, value, path)) return sink;
  expectString(sink, value.fixtureExternalId, `${path}.fixtureExternalId`);
  validateSideLineup(sink, value.home, `${path}.home`);
  validateSideLineup(sink, value.away, `${path}.away`);
  return sink;
}

export function validateStanding(value: unknown, path = 'standing'): Problem[] {
  const sink: Sink = [];
  if (!expectRecord(sink, value, path)) return sink;

  expectRef(sink, value.competition, `${path}.competition`);
  expectString(sink, value.seasonLabel, `${path}.seasonLabel`);
  expectNullableString(sink, value.stage, `${path}.stage`);
  expectNullableString(sink, value.group, `${path}.group`);
  expectTimestamp(sink, value.lastUpdatedAt, `${path}.lastUpdatedAt`);

  if (!expectArray(sink, value.rows, `${path}.rows`)) return sink;
  if (value.rows.length === 0)
    fail(sink, `${path}.rows`, 'a standing with no rows is not a standing');

  value.rows.forEach((row, index) => {
    const p = `${path}.rows[${index}]`;
    if (!expectRecord(sink, row, p)) return;
    expectInt(sink, row.position, `${p}.position`, 1);
    expectRef(sink, row.team, `${p}.team`);
    for (const field of ['played', 'won', 'drawn', 'lost', 'goalsFor', 'goalsAgainst', 'points']) {
      expectInt(sink, row[field], `${p}.${field}`, 0);
    }
    if (
      typeof row.played === 'number' &&
      typeof row.won === 'number' &&
      typeof row.drawn === 'number' &&
      typeof row.lost === 'number' &&
      row.won + row.drawn + row.lost !== row.played
    ) {
      fail(sink, `${p}.played`, 'won + drawn + lost must equal played');
    }
    expectNullableString(sink, row.form, `${p}.form`);
    if (typeof row.form === 'string' && !/^[WDL]+$/.test(row.form)) {
      fail(sink, `${p}.form`, 'must be letters W, D and L only');
    }
  });

  noDuplicates(
    sink,
    value.rows.map((row) => (isRecord(row) ? row.position : row)),
    `${path}.rows`,
    'position',
  );
  noDuplicates(
    sink,
    value.rows.map((row) => (isRecord(row) && isRecord(row.team) ? row.team.externalId : row)),
    `${path}.rows`,
    'team',
  );
  return sink;
}

export function validateFixtureDetail(value: unknown, path = 'detail'): Problem[] {
  const sink: Sink = [];
  if (!expectRecord(sink, value, path)) return sink;

  sink.push(...validateFixture(value.fixture, `${path}.fixture`));
  const fixtureId = isRecord(value.fixture) ? value.fixture.externalId : undefined;

  if (expectArray(sink, value.incidents, `${path}.incidents`)) {
    value.incidents.forEach((incident, index) => {
      const p = `${path}.incidents[${index}]`;
      sink.push(...validateIncident(incident, p));
      if (
        isRecord(incident) &&
        fixtureId !== undefined &&
        incident.fixtureExternalId !== fixtureId
      ) {
        fail(sink, `${p}.fixtureExternalId`, 'must match the fixture it is attached to');
      }
    });
    noDuplicates(
      sink,
      value.incidents.map((incident) => (isRecord(incident) ? incident.sequence : incident)),
      `${path}.incidents`,
      'sequence',
    );
  }

  if (value.lineup !== null) sink.push(...validateLineup(value.lineup, `${path}.lineup`));

  if (expectArray(sink, value.statistics, `${path}.statistics`)) {
    value.statistics.forEach((stat, index) => {
      const p = `${path}.statistics[${index}]`;
      if (!expectRecord(sink, stat, p)) return;
      expectEnum(sink, stat.side, `${p}.side`, ['home', 'away']);
      const metricOk = expectEnum(sink, stat.metric, `${p}.metric`, STAT_METRICS);
      const isPct = metricOk && String(stat.metric).endsWith('_pct');
      expectNumber(sink, stat.value, `${p}.value`, 0, isPct ? 100 : undefined);
    });
    noDuplicates(
      sink,
      value.statistics.map((stat) => (isRecord(stat) ? [stat.side, stat.metric] : stat)),
      `${path}.statistics`,
      '(side, metric)',
    );
  }

  if (expectArray(sink, value.periods, `${path}.periods`)) {
    value.periods.forEach((period, index) => {
      const p = `${path}.periods[${index}]`;
      if (!expectRecord(sink, period, p)) return;
      expectEnum(sink, period.kind, `${p}.kind`, PERIOD_KINDS);
      expectTimestamp(sink, period.startedAt, `${p}.startedAt`);
      if (period.endedAt !== null) expectTimestamp(sink, period.endedAt, `${p}.endedAt`);
      expectNullableInt(sink, period.addedMinutes, `${p}.addedMinutes`, 0, 30);
    });
    noDuplicates(
      sink,
      value.periods.map((period) => (isRecord(period) ? period.kind : period)),
      `${path}.periods`,
      'period kind',
    );
  }

  return sink;
}

/**
 * D-014 as a check: an adapter on the critical path must be a licensed API and
 * cannot call itself degradable.
 */
export function validateManifest(value: unknown, path = 'manifest'): Problem[] {
  const sink: Sink = [];
  if (!expectRecord(sink, value, path)) return sink;

  expectEnum(sink, value.provider, `${path}.provider`, PROVIDERS);
  expectString(sink, value.displayName, `${path}.displayName`);
  expectBoolean(sink, value.criticalPath, `${path}.criticalPath`);
  expectBoolean(sink, value.degradable, `${path}.degradable`);

  if (expectRecord(sink, value.licence, `${path}.licence`)) {
    const kindOk = expectEnum(sink, value.licence.kind, `${path}.licence.kind`, [
      'licensed_api',
      'open_data',
      'scraped',
    ]);
    if (
      expectString(sink, value.licence.termsUrl, `${path}.licence.termsUrl`) &&
      !/^https?:\/\//.test(value.licence.termsUrl)
    ) {
      fail(sink, `${path}.licence.termsUrl`, 'must be an http(s) URL');
    }
    expectString(sink, value.licence.tier, `${path}.licence.tier`);

    if (value.criticalPath === true && kindOk && value.licence.kind !== 'licensed_api') {
      fail(
        sink,
        `${path}.licence.kind`,
        'D-014: a critical-path adapter must be a licensed API, never open data or scraping',
      );
    }
  }

  if (value.criticalPath === true && value.degradable === true) {
    fail(sink, `${path}.degradable`, 'D-014: the critical path is not degradable');
  }

  if (expectRecord(sink, value.quota, `${path}.quota`)) {
    expectNullableInt(sink, value.quota.requestsPerDay, `${path}.quota.requestsPerDay`, 1);
    expectNullableInt(sink, value.quota.requestsPerMinute, `${path}.quota.requestsPerMinute`, 1);
  }

  return sink;
}

export function validateManifestTyped(manifest: AdapterManifest): Problem[] {
  return validateManifest(manifest);
}
