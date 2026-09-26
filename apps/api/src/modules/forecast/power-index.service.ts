import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import type { PowerIndex, PowerIndexComponentValue, PowerIndexPair } from '@fmip/contracts';
import { PG_POOL } from '../../database/database.module';
import { POWER_INDEX_FORMULA_VERSION, combine, leadingFactors } from './internal/power-index';
import {
  CONGESTION_WINDOW_DAYS,
  measure,
  type MeasureInput,
  type Side,
} from './internal/power-index-measure';
import { measureLineup, measureStability, type SquadContext } from './internal/power-index-squad';
import { PowerIndexStore, type IndexSubject } from './internal/power-index-store';

// The module's public surface for the Power Index. Other modules import here.
export { POWER_INDEX_FORMULA_VERSION } from './internal/power-index';

export type ComputeOutcome =
  | { kind: 'computed'; pair: PowerIndexPair }
  /** The fixture exists but nothing could be measured for either side. */
  | { kind: 'not_measurable'; reason: string }
  | { kind: 'unknown_fixture' };

/**
 * The Power Index (blueprint 6.1, T-111).
 *
 * Measures the components from the training history and our own schedule,
 * combines them with the published weights (T-110), and stores the result as an
 * immutable row. Computing twice at the same instant is the same computation,
 * not a second one, so the insert is a no-op on conflict; computing later writes
 * a new row, which is what makes "what changed after the confirmed line-up"
 * answerable (T-121).
 *
 * **When it declines to answer.** A fixture whose competition has no
 * football-data division, a team with no training alias, a division we hold too
 * little of — each produces `not_measurable` with the reason, never a number.
 * The cases where *some* components are missing are different and are handled
 * inside the index itself: the weight is redistributed and `completeness` says
 * how much of the picture arrived.
 */
@Injectable()
export class PowerIndexService {
  private readonly store: PowerIndexStore;

  constructor(@Inject(PG_POOL) pool: Pool) {
    this.store = new PowerIndexStore(pool);
  }

  /** Computes and stores both sides' index for a fixture. */
  async compute(fixtureId: string, now: Date = new Date()): Promise<ComputeOutcome> {
    const subject = await this.store.subject(fixtureId);
    if (subject === null) return { kind: 'unknown_fixture' };

    if (subject.division === null) {
      return {
        kind: 'not_measurable',
        reason: 'the competition has no football-data division, so there is no history to rank in',
      };
    }

    const history = await this.store.history(subject.division, subject.kickoffAt);
    if (history.length === 0) {
      return {
        kind: 'not_measurable',
        reason: `no recorded matches for division ${subject.division} before this kick-off`,
      };
    }

    const squad = await this.store.squadContext(subject);
    const home = await this.computeSide(subject, 'home', history, squad, now);
    const away = await this.computeSide(subject, 'away', history, squad, now);

    if (home === null && away === null) {
      return {
        kind: 'not_measurable',
        reason: `neither team has a training alias for division ${subject.division}`,
      };
    }
    if (home === null || away === null) {
      // One-sided is worse than none: a panel showing an index for one team and
      // a blank for the other invites the comparison it cannot support.
      return {
        kind: 'not_measurable',
        reason: `only one team has a training alias for division ${subject.division}; an index for one side alone would invite a comparison it cannot support`,
      };
    }
    return { kind: 'computed', pair: { home, away } };
  }

  /** The newest stored index for each side, or `null` when there is none. */
  async latest(fixtureId: string): Promise<PowerIndexPair | null> {
    const rows = await this.store.latest(fixtureId, POWER_INDEX_FORMULA_VERSION);
    const home = rows.find((row) => row.side === 'home');
    const away = rows.find((row) => row.side === 'away');
    if (home === undefined || away === undefined) return null;

    const toIndex = (entry: (typeof rows)[number]): PowerIndex => {
      const components = entry.row.components as PowerIndexComponentValue[];
      return {
        team: { id: entry.row.team_id, name: entry.row.team_name },
        value: Number(entry.row.value),
        completeness: Number(entry.row.completeness),
        formula_version: entry.row.formula_version,
        computed_at: entry.row.computed_at.toISOString(),
        components,
        leading: leadingFactors(components),
      };
    };
    return { home: toIndex(home), away: toIndex(away) };
  }

  private async computeSide(
    subject: IndexSubject,
    side: Side,
    history: MeasureInput['history'],
    squad: SquadContext,
    now: Date,
  ): Promise<PowerIndex | null> {
    const team = subject[side];
    const division = subject.division as string;

    const trainingName = await this.store.trainingName(team.teamId, division);
    if (trainingName === null) return null;

    const rest = await this.store.rest(team.teamId, subject.kickoffAt, CONGESTION_WINDOW_DAYS);
    const measurements = {
      ...measure({ trainingName, side, history, rest }),
      // The two our own match records reach once line-ups and ratings arrive
      // (T-112, D-081); measured from the catalogue, not the training store.
      lineup_quality: measureLineup(squad, team.teamId),
      stability: measureStability(squad, team.teamId),
    };
    const combined = combine(measurements);
    if (combined === null) return null;

    const computedAt = now;
    await this.store.record({
      participantId: team.participantId,
      formulaVersion: combined.formulaVersion,
      value: combined.value,
      completeness: combined.completeness,
      components: combined.components,
      inputsHash: hashInputs(trainingName, history.length, rest, combined.components),
      computedAt,
    });

    return {
      team: { id: team.teamId, name: team.name },
      value: combined.value,
      completeness: combined.completeness,
      formula_version: combined.formulaVersion,
      computed_at: computedAt.toISOString(),
      components: combined.components,
      leading: combined.leading,
    };
  }
}

/**
 * Identity of what the index was computed from, so an unchanged recomputation
 * is detectable — the same device `rating_snapshot` uses (T-053).
 */
function hashInputs(
  trainingName: string,
  historySize: number,
  rest: { daysSincePrevious: number | null; matchesInWindow: number },
  components: PowerIndexComponentValue[],
): string {
  const payload = JSON.stringify({
    trainingName,
    historySize,
    rest,
    components: components.map((c) => [c.key, c.value, c.state]),
  });
  return createHash('sha256').update(payload).digest('hex');
}
