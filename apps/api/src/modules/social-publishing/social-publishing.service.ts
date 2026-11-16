import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  ForecastVersion,
  ModelProbabilities,
  ScoreCard,
  ScoresFilters,
  SocialAutomation,
  SocialAutomationLevel,
  SocialCardGoal,
  SocialCardModel,
  SocialCardPayload,
  SocialCardTeam,
  SocialGateCheck,
  SocialOutcome,
  SocialPostKind,
  SocialPostState,
  SocialSensitiveReason,
} from '@fmip/contracts';
import { SOCIAL_NETWORKS, SOCIAL_TIME_ZONE } from '@fmip/contracts/console';
import { EvaluationService, type CountedEvaluation } from '../forecast/evaluation.service';
import { ForecastService, roundToTotalOne } from '../forecast/forecast.service';
import { FixturesService } from '../fixtures/fixtures.service';
import { NewsHeadlines } from '../news/news-headlines.service';
import {
  type NewSocialPost,
  PostgresSocialPostStore,
  type SocialActor,
  type SocialPostRecord,
  type StoreOutcome,
} from './internal/social-post-store';
import {
  type CaptionRefusal,
  type SocialFacts,
  buildBody,
  checkCaptionEdit,
  checkGates,
  expiresAt,
  londonDay,
  sensitivity,
} from './internal/social-rules';

/** The site the posts link to (`WEB_BASE_URL`), as the channel post's and the e-mails' links. */
export const SOCIAL_OPTIONS = Symbol('SOCIAL_OPTIONS');
export interface SocialOptions {
  origin: string;
}

export function socialOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): SocialOptions {
  return { origin: (env.WEB_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '') };
}

/** Headlines read for the sensitive-topic check: the last 72 hours (D-427 point 5). */
export const HEADLINE_WINDOW_MS = 72 * 60 * 60 * 1000;

const MODEL_NAME: SocialCardModel['name'] = 'The Stadiomind model';

const LIVE_STATES: readonly SocialPostState[] = [
  'pending_approval',
  'approved',
  'publishing',
  'published',
  'refused',
  'unknown',
];
const UNCLAIMED_STATES: readonly SocialPostState[] = ['pending_approval', 'approved', 'refused'];

/** Why a candidate was not drafted, for the job's log. */
export type SkipReason = `gates:${string}` | 'too_long';

export interface DraftReport {
  drafted: number;
  /** Of the drafted, approved by `automation` (an automatic kind's clean post). */
  automatic: number;
  /** A live post already stood for the (fixture, kind, network). */
  existing: number;
  expired: number;
  superseded: number;
  skipped: { fixture_id: string; kind: SocialPostKind; reason: SkipReason }[];
}

/** One match as the scores list gives it to a guest, with its competition's stated place (T-504). */
interface Candidate {
  card: ScoreCard;
  rank: number | null;
}

const team = (t: ScoreCard['home']): SocialCardTeam => ({
  id: t.id,
  name: t.name,
  short_name: t.short_name,
  code: t.code,
});

/**
 * The three probabilities as the site shows them: percentages with one
 * decimal totalling exactly 100.0, the largest absorbing the rounding gap
 * (blueprint 6.2; the channel post's and the web's `percentages`).
 */
export function sitePercent(p: ModelProbabilities): { home: number; draw: number; away: number } {
  const r = roundToTotalOne(p, 3);
  return {
    home: Math.round(r.home * 1000) / 10,
    draw: Math.round(r.draw * 1000) / 10,
    away: Math.round(r.away * 1000) / 10,
  };
}

const GOAL_KINDS = { goal: 'goal', penalty_goal: 'penalty', own_goal: 'own_goal' } as const;

/**
 * The goals in order, for the result card, only when the match's events
 * supply every one of them, each with its scorer: their count per side equals
 * the score. Otherwise null, so the card lists no scorers rather than some
 * (rule 3). A shoot-out's kicks are not goals.
 */
export function goalsOf(card: ScoreCard): SocialCardGoal[] | null {
  const score = card.scores.current;
  if (score === null) return null;
  const goals: SocialCardGoal[] = [];
  for (const i of card.incidents) {
    if (i.in_shootout === true || !(i.kind in GOAL_KINDS)) continue;
    if (i.side === null || i.player === null) return null;
    goals.push({
      side: i.side,
      player: i.player,
      minute: i.minute,
      added: i.added_time,
      kind: GOAL_KINDS[i.kind as keyof typeof GOAL_KINDS],
    });
  }
  const count = (side: 'home' | 'away') => goals.filter((g) => g.side === side).length;
  return count('home') === score.home && count('away') === score.away ? goals : null;
}

/**
 * The verdict card's "model's pick", from the same stored evaluation that
 * says right or wrong (review of PR #895, finding 1), never from the rounded
 * percentages, where 39.951 and 40.049 both read 40.0. The evaluation's
 * `correct` means the actual outcome had the highest raw probability
 * (`forecast/internal/scoring.ts`), so when it is right the pick is that
 * outcome; when it is wrong, the raw probabilities' highest (home, then
 * draw, then away on an exact tie, none of which can then be the actual one).
 */
export function calledFrom(evaluation: {
  probabilities: ModelProbabilities;
  outcome: SocialOutcome;
  correct: boolean;
}): SocialOutcome {
  if (evaluation.correct) return evaluation.outcome;
  const p = evaluation.probabilities;
  if (p.home >= p.draw && p.home >= p.away) return 'home';
  return p.draw >= p.away ? 'draw' : 'away';
}

/** The pre-kick-off forecast the match page shows: the latest published version computed before kick-off. */
export function shownForecast(
  versions: readonly ForecastVersion[],
  kickOff: string,
): ForecastVersion | null {
  const before = versions.filter((v) => Date.parse(v.computed_at) < Date.parse(kickOff));
  return before.reduce<ForecastVersion | null>(
    (latest, v) => (latest === null || v.version_number > latest.version_number ? v : latest),
    null,
  );
}

/**
 * Social posts (T-1838, D-427): the module's public service. The candidate
 * job (`draftCandidates`) builds the three phase-1 kinds -- the model's
 * pre-match forecast, "did the model get it right" after the match, and the
 * result -- for X and Instagram from our own API's answers only, read through
 * the public services (`FixturesService.rankedScores`, the scores list a guest
 * is given with the product's competition order, T-504; `ForecastService`;
 * `EvaluationService.countedFor`, D-209; `NewsHeadlines`). Each candidate goes
 * through the gates and the sensitive-topic check of `social-rules.ts`, and a
 * post is drafted frozen with its text, card payload, inputs, gates, template
 * version, forecast and model version. Nothing here publishes (T-1837).
 *
 * The console's actions (T-1836) come through here too, so a person's
 * approval is checked against the gates as they stand at that moment.
 */
@Injectable()
export class SocialPublishingService {
  private readonly log = new Logger(SocialPublishingService.name);

  constructor(
    private readonly fixtures: FixturesService,
    private readonly forecasts: ForecastService,
    private readonly evaluations: EvaluationService,
    private readonly headlines: NewsHeadlines,
    private readonly store: PostgresSocialPostStore,
    @Inject(SOCIAL_OPTIONS) private readonly options: SocialOptions,
  ) {}

  // -------------------------------------------------------------------------
  // The candidate job.
  // -------------------------------------------------------------------------

  /**
   * Drafts every post due now: a forecast for each match of today (London)
   * still to kick off, a verdict and a result for each match of yesterday and
   * today that has finished. A (fixture, kind, network) is drafted once: a
   * post rejected, expired or published is not drafted again; a forecast post
   * not yet claimed whose forecast the page no longer shows is superseded and
   * drafted anew; anything past its validity is expired first. Idempotent:
   * running it twice drafts once.
   */
  async draftCandidates(now: Date = new Date()): Promise<DraftReport> {
    const report: DraftReport = {
      drafted: 0,
      automatic: 0,
      existing: 0,
      expired: await this.store.expireDue(now),
      superseded: 0,
      skipped: [],
    };
    const candidates = await this.candidates(now);
    const ids = candidates.map((c) => c.card.id);
    // What stands for each (fixture, kind, network): its live post if it has one, else its last.
    const standing = new Map<string, SocialPostRecord>();
    for (const p of await this.store.standingFor(ids)) {
      const key = `${p.fixture_id}:${p.kind}:${p.network}`;
      const known = standing.get(key);
      if (
        known === undefined ||
        !LIVE_STATES.includes(known.state) ||
        LIVE_STATES.includes(p.state)
      ) {
        standing.set(key, p);
      }
    }
    const finished = candidates.filter((c) => c.card.status === 'finished').map((c) => c.card.id);
    const counted = await this.evaluations.countedFor(finished);

    for (const candidate of candidates) {
      const { card } = candidate;
      const kinds: SocialPostKind[] =
        card.status === 'scheduled' && Date.parse(card.kickoff_at) > now.getTime()
          ? ['forecast_pre_match']
          : card.status === 'finished'
            ? ['model_verdict', 'result']
            : [];
      let sensitive: SocialSensitiveReason | null | undefined;
      for (const kind of kinds) {
        const built = await this.build(candidate, kind, counted.get(card.id) ?? null, now);
        if (!built.gates.passed || built.payload === null) {
          report.skipped.push({
            fixture_id: card.id,
            kind,
            reason: `gates:${built.gates.failed.join(',')}`,
          });
          continue;
        }
        for (const network of SOCIAL_NETWORKS) {
          const stands = standing.get(`${card.id}:${kind}:${network}`);
          if (stands !== undefined) {
            // Drafted once: only a forecast post not yet claimed whose forecast the page no
            // longer shows makes way for a new one. A rejection, an expiry or a publication stands.
            const stale =
              kind === 'forecast_pre_match' &&
              stands.forecast_id !== built.forecastId &&
              UNCLAIMED_STATES.includes(stands.state);
            if (!stale) {
              report.existing += 1;
              continue;
            }
            const ended = await this.store.end(
              stands.id,
              'superseded',
              'the forecast the match page shows changed',
            );
            if (ended.ok) report.superseded += 1;
          }
          const payload = built.payload;
          const text = buildBody(payload, network, this.link(card.id));
          if (text === null) {
            report.skipped.push({ fixture_id: card.id, kind, reason: 'too_long' });
            continue;
          }
          if (sensitive === undefined) sensitive = await this.sensitivityOf(card, now);
          const post: NewSocialPost = {
            fixtureId: card.id,
            kind,
            network,
            templateVersion: text.template_version,
            body: text.body,
            payload,
            inputs: { ...built.inputs, competition_rank: candidate.rank },
            gates: built.gates,
            forecastId: built.forecastId,
            modelVersion: built.modelVersion,
            sensitive,
            expiresAt: expiresAt(kind, card.kickoff_at, now),
          };
          const drafted = await this.store.draft(post);
          if (drafted.kind === 'exists') {
            report.existing += 1;
            continue;
          }
          report.drafted += 1;
          if (drafted.approvedBy !== null) report.automatic += 1;
        }
      }
    }
    if (report.drafted > 0 || report.expired > 0 || report.superseded > 0) {
      this.log.log('social posts drafted', { ...report, skipped: report.skipped.length });
    }
    return report;
  }

  /**
   * The gates of one post as they stand now, from fresh reads (D-427 point
   * 3): at a person's approval here, and at publishing (T-1837).
   */
  async gatesNow(post: SocialPostRecord, now: Date = new Date()): Promise<SocialGateCheck> {
    const kickOff = new Date(post.payload.kick_off);
    const card = (await this.candidatesBetween(kickOff, kickOff)).find(
      (c) => c.card.id === post.fixture_id,
    );
    if (card === undefined) {
      return { checked_at: now.toISOString(), passed: false, failed: ['fixture_status'] };
    }
    const counted =
      post.kind === 'model_verdict'
        ? ((await this.evaluations.countedFor([post.fixture_id])).get(post.fixture_id) ?? null)
        : null;
    const built = await this.build(card, post.kind, counted, now);
    if (built.gates.passed && post.forecast_id !== built.forecastId) {
      return { ...built.gates, passed: false, failed: ['forecast_shown'] };
    }
    return built.gates;
  }

  // -------------------------------------------------------------------------
  // The console's actions (T-1836), each audited by the store.
  // -------------------------------------------------------------------------

  /** A person's approval, refused with the failing gates named when a gate fails now. */
  async approve(
    id: string,
    actor: SocialActor,
    now: Date = new Date(),
  ): Promise<StoreOutcome<null, 'not_found' | 'not_waiting' | 'gates_failed'>> {
    const post = await this.store.get(id);
    if (post === null) return { ok: false, refusal: 'not_found' };
    if (post.state !== 'pending_approval') return { ok: false, refusal: 'not_waiting' };
    return this.store.approve(id, actor, await this.gatesNow(post, now));
  }

  reject(id: string, actor: SocialActor, reason: string) {
    return this.store.reject(id, actor, reason);
  }

  /**
   * A person's edit of a post's caption, and of nothing else: the card, the
   * model's numbers, name and version, the score and the outcome stay as
   * drafted (rules 5 and 6; review of PR #895, finding 3). Refused when the
   * text would change one of those lines or the link, add a figure, not fit
   * the network, or touch a sensitive topic (`checkCaptionEdit`).
   */
  async edit(
    id: string,
    actor: SocialActor,
    body: string,
    reason: string,
  ): Promise<
    StoreOutcome<string, 'not_found' | 'not_waiting' | 'reason_required' | CaptionRefusal>
  > {
    const post = await this.store.get(id);
    if (post === null) return { ok: false, refusal: 'not_found' };
    const check = checkCaptionEdit(post, body);
    if (!check.ok) return { ok: false, refusal: check.refusal };
    return this.store.edit(id, actor, body, reason);
  }

  settle(
    id: string,
    actor: SocialActor,
    to: { state: 'published'; providerRef: string } | { state: 'refused' },
    reason: string,
  ) {
    return this.store.settle(id, actor, to, reason);
  }

  setSwitch(actor: SocialActor, stop: boolean, reason: string) {
    return this.store.setSwitch(actor, stop, reason);
  }

  setLevel(actor: SocialActor, kind: SocialPostKind, to: SocialAutomationLevel, reason: string) {
    return this.store.setLevel(actor, kind, to, reason);
  }

  automation(): Promise<SocialAutomation[]> {
    return this.store.automation();
  }

  get(id: string): Promise<SocialPostRecord | null> {
    return this.store.get(id);
  }

  // -------------------------------------------------------------------------
  // The publisher's steps (T-1837).
  // -------------------------------------------------------------------------

  claim(id: string, slot: number) {
    return this.store.claim(id, slot);
  }

  finish(
    id: string,
    answer:
      { state: 'published'; providerRef: string } | { state: 'refused' | 'unknown'; error: string },
  ) {
    return this.store.finish(id, answer);
  }

  end(id: string, to: 'expired' | 'superseded', reason: string) {
    return this.store.end(id, to, reason);
  }

  markSensitive(id: string, reason: SocialSensitiveReason) {
    return this.store.markSensitive(id, reason);
  }

  // -------------------------------------------------------------------------
  // Reading and building.
  // -------------------------------------------------------------------------

  private link(fixtureId: string): string {
    return `${this.options.origin}/en/match/${fixtureId}`;
  }

  /** Yesterday's and today's matches (London), in the product's competition order. */
  private candidates(now: Date): Promise<Candidate[]> {
    return this.candidatesBetween(new Date(now.getTime() - 24 * 60 * 60 * 1000), now);
  }

  private async candidatesBetween(from: Date, to: Date): Promise<Candidate[]> {
    const filters: ScoresFilters = {
      from: londonDay(from),
      to: londonDay(to),
      timezone: SOCIAL_TIME_ZONE,
      live: false,
      favourites: false,
      country_id: null,
      competition_id: null,
      stage_id: null,
      gender: null,
      age: null,
    };
    const { response, statedOrder } = await this.fixtures.rankedScores(filters);
    return response.groups.flatMap((group) =>
      group.fixtures.map((card) => ({ card, rank: statedOrder.get(group.competition.id) ?? null })),
    );
  }

  /**
   * One kind's post for one match: its facts, its gates and, when they pass,
   * its frozen payload and inputs.
   */
  private async build(
    candidate: Candidate,
    kind: SocialPostKind,
    counted: CountedEvaluation | null,
    now: Date,
  ): Promise<{
    gates: SocialGateCheck;
    /** Null only when the gates fail. */
    payload: SocialCardPayload | null;
    inputs: Record<string, unknown>;
    forecastId: string | null;
    modelVersion: string | null;
  }> {
    const { card } = candidate;
    const versions =
      kind === 'result' ? [] : ((await this.forecasts.versions(card.id))?.versions ?? []);
    const shown = kind === 'result' ? null : shownForecast(versions, card.kickoff_at);
    const evaluation = kind === 'model_verdict' ? (counted?.evaluation ?? null) : null;
    const carried =
      kind === 'forecast_pre_match'
        ? shown === null
          ? null
          : { id: shown.id, version: shown.model_version, status: shown.status }
        : kind === 'model_verdict'
          ? evaluation !== null
            ? {
                id: evaluation.forecast_id,
                version: evaluation.model_version,
                status: 'available' as const,
              }
            : shown === null
              ? null
              : { id: shown.id, version: shown.model_version, status: shown.status }
          : null;
    const facts: SocialFacts = {
      kind,
      fixture: {
        status: card.status,
        kick_off: card.kickoff_at,
        coverage: card.coverage,
        last_updated_at: card.last_updated_at,
        score_dispute: card.score_dispute !== undefined && card.score_dispute !== null,
      },
      forecast: carried,
      shown_forecast: shown === null ? null : { id: shown.id, version: shown.model_version },
      evaluation:
        evaluation === null
          ? null
          : { forecast_id: evaluation.forecast_id, correct: evaluation.correct },
      products: kind === 'result' ? [] : ['model'],
    };
    const gates = checkGates(facts, now);
    const base = {
      fixture_id: card.id,
      competition: { id: card.competition.id, name: card.competition.name },
      round: card.round ?? card.stage?.name ?? null,
      kick_off: card.kickoff_at,
      home: team(card.home),
      away: team(card.away),
    };
    const wentFurther = card.scores.extra_time !== null || card.scores.penalties !== null;
    const inputs: Record<string, unknown> = {
      read_at: now.toISOString(),
      fixture: {
        status: card.status,
        kick_off: card.kickoff_at,
        coverage: card.coverage,
        last_updated_at: card.last_updated_at,
        score_dispute: facts.fixture.score_dispute,
        scores: card.scores,
      },
      forecast: carried,
      shown_forecast: facts.shown_forecast,
      evaluation:
        evaluation === null
          ? null
          : {
              id: evaluation.id,
              forecast_id: evaluation.forecast_id,
              actual: evaluation.actual,
              outcome: evaluation.outcome,
              correct: evaluation.correct,
              probabilities: evaluation.probabilities,
            },
    };
    const model = (id: string, version: string, computedAt: string): SocialCardModel => ({
      name: MODEL_NAME,
      version,
      forecast_id: id,
      computed_at: computedAt,
    });

    let payload: SocialCardPayload;
    if (kind === 'forecast_pre_match' && shown !== null && shown.probabilities !== null) {
      payload = {
        ...base,
        kind,
        model: model(shown.id, shown.model_version, shown.computed_at),
        percent: sitePercent(shown.probabilities),
      };
    } else if (kind === 'model_verdict' && evaluation !== null) {
      const percent = sitePercent(evaluation.probabilities);
      const called = calledFrom(evaluation);
      payload = {
        ...base,
        kind,
        model: model(evaluation.forecast_id, evaluation.model_version, evaluation.computed_at),
        // The 90-minute score the evaluation judged (D-317), never the final one.
        score: { home: evaluation.actual.home, away: evaluation.actual.away },
        after_extra_time: wentFurther,
        called,
        called_percent: percent[called],
        percent,
        correct: evaluation.correct,
      };
    } else if (kind === 'result' && card.scores.current !== null) {
      payload = {
        ...base,
        kind,
        score: { home: card.scores.current.home, away: card.scores.current.away },
        after_extra_time: card.scores.extra_time !== null,
        penalties:
          card.scores.penalties === null
            ? null
            : { home: card.scores.penalties.home, away: card.scores.penalties.away },
        half_time:
          card.scores.half_time === null
            ? null
            : { home: card.scores.half_time.home, away: card.scores.half_time.away },
        goals: goalsOf(card),
      };
    } else {
      // Nothing to show: the gates say why when they fail; a passing gate
      // with no probabilities or score is refused here all the same.
      const failed = gates.failed.length > 0 ? gates.failed : (['coverage'] as const);
      return {
        gates: { ...gates, passed: false, failed: [...failed] },
        payload: null,
        inputs,
        forecastId: null,
        modelVersion: null,
      };
    }
    return {
      gates,
      payload,
      inputs,
      forecastId: carried?.id ?? null,
      modelVersion: carried?.version ?? null,
    };
  }

  /**
   * Whether the match's posts must wait for a person: a headline linked to
   * either team or the match in the last 72 hours touching a sensitive topic,
   * once the match's own names are taken out; a failed read counts (fail closed).
   */
  private async sensitivityOf(card: ScoreCard, now: Date): Promise<SocialSensitiveReason | null> {
    let headlines: string[] | null;
    try {
      headlines = await this.headlines.recent(
        [card.id, card.home.id, card.away.id],
        new Date(now.getTime() - HEADLINE_WINDOW_MS),
      );
    } catch (error) {
      this.log.warn('headlines unreadable: the posts wait for a person', {
        fixture: card.id,
        error: error instanceof Error ? error.message : String(error),
      });
      headlines = null;
    }
    const names = [card.home, card.away]
      .flatMap((t) => [t.name, t.short_name, t.code])
      .concat(card.competition.name, card.competition.short_name)
      .filter((n): n is string => n !== null && n !== undefined);
    return sensitivity(headlines, { names });
  }
}
