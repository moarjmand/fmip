import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { MatchSummaryOutcome, MatchSummaryResponse } from '@fmip/contracts';
import { ConsensusService } from '../consensus/consensus.service';
import { FixturesService } from '../fixtures/fixtures.service';
import { ForecastService } from '../forecast/forecast.service';
import { IntelligenceService } from '../intelligence/intelligence.service';
import { checkGrounding } from './internal/grounding';
import {
  FACTS_VERSION,
  type MatchFacts,
  PROMPT_VERSION,
  assembleFacts,
  groundingOf,
} from './internal/match-facts';
import { PostgresMatchSummaryStore, groundingFromRow } from './internal/match-summary-store';

/** The standing instruction: stable across every summary, so the provider can cache it. */
export const SYSTEM = [
  'You write short factual match reports for a football website.',
  "You are given a JSON record of one match: the header, the score, the timeline, the statistics, the line-ups, recent form, head-to-head, the statistical model's forecast and the community's consensus, each part with a coverage state.",
  'Write two to four short paragraphs in plain English about what happened.',
  'Use only what the record says: name only people, teams and places that appear in it, spelled exactly as they appear, and give only numbers that appear in it.',
  'A part whose coverage is not_supplied is unknown: do not describe it and do not guess at it.',
  'Do not predict anything. Do not judge the forecast against the consensus and do not combine them; if you mention either, report it as the labelled number it is.',
  'Do not mention that you are a model or that you were given a record. Output the paragraphs only.',
].join(' ');

const MAX_TOKENS = 1_200;
const LANGUAGE = 'en';
/** How far back the catch-up looks for finished matches with no version. */
const CATCH_UP_DAYS = 3;
const CATCH_UP_LIMIT = 10;
const CATCH_UP_EVERY_MS = 10 * 60 * 1000;

/**
 * Match summaries (E41, T-412): the record assembled into facts, the model
 * asked, the answer checked against the facts, and a version written either
 * way. The absent model is an outcome the page turns into a sentence; a
 * refusal, a truncation or a failed gate is a rejected version kept for the
 * record and never shown; a failed call leaves no version, so the next
 * catch-up tries again. Nothing here is on the critical path: the match
 * page reads a stored row and never waits for a model (D-070).
 */
@Injectable()
export class SummariesService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Summaries');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: PostgresMatchSummaryStore,
    private readonly fixtures: FixturesService,
    private readonly forecasts: ForecastService,
    private readonly consensus: ConsensusService,
    private readonly intelligence: IntelligenceService,
  ) {}

  /** Full time's mechanism: a periodic catch-up, only when there is a model to ask. */
  onModuleInit(): void {
    if (this.intelligence.describe().absent || process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      this.catchUp().catch((error: unknown) =>
        this.log.error(
          `summaries.catch_up_failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }, CATCH_UP_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer);
  }

  async current(fixtureId: string): Promise<MatchSummaryResponse | null> {
    const status = await this.store.fixtureStatus(fixtureId);
    if (status === null) return null;
    const [published, versions] = await Promise.all([
      this.store.latestPublished(fixtureId),
      this.store.versions(fixtureId),
    ]);
    if (published !== null) {
      return {
        fixture_id: fixtureId,
        summary: {
          coverage: 'available',
          last_updated_at: published.generated_at.toISOString(),
          data: {
            text: published.text ?? '',
            language: published.language,
            model: published.model,
            prompt_version: published.prompt_version,
            generated_at: published.generated_at.toISOString(),
            version_number: published.version_number,
            grounded_on: groundingFromRow(published),
          },
        },
        reason: null,
        versions,
      };
    }
    const reason =
      status !== 'finished'
        ? 'not_finished'
        : this.intelligence.describe().absent
          ? 'no_model'
          : versions > 0
            ? 'rejected'
            : 'not_generated';
    return {
      fixture_id: fixtureId,
      summary: { coverage: 'not_supplied', last_updated_at: null, data: null },
      reason,
      versions,
    };
  }

  /** A new version for a finished match: published when the gate passes, rejected when it does not, nothing when the call failed. */
  async generate(
    fixtureId: string,
    requestedBy: string | null,
    reason: string | null,
  ): Promise<MatchSummaryOutcome | 'no_fixture'> {
    const centre = await this.fixtures.matchCentre(fixtureId);
    if (centre === null) return 'no_fixture';
    if (centre.fixture.status !== 'finished') return { outcome: 'not_finished' };
    const [forecast, consensus] = await Promise.all([
      this.forecasts.versions(fixtureId),
      this.consensus.forFixture(fixtureId),
    ]);
    const facts = assembleFacts(centre, forecast, consensus);
    const answer = await this.intelligence.complete({
      system: SYSTEM,
      prompt: JSON.stringify(facts),
      maxTokens: MAX_TOKENS,
    });
    if (answer.outcome === 'absent') return { outcome: 'absent' };
    if (answer.outcome === 'failed') return { outcome: 'failed' };
    const { completion } = answer;
    const rejection = rejectionOf(completion.stop, completion.text, facts);
    const state = rejection === null ? 'published' : 'rejected';
    const number = await this.store.add({
      fixtureId,
      language: LANGUAGE,
      state,
      text: completion.text === '' ? null : completion.text,
      rejection,
      facts,
      factsVersion: FACTS_VERSION,
      promptVersion: PROMPT_VERSION,
      model: completion.model,
      inputTokens: completion.input_tokens,
      outputTokens: completion.output_tokens,
      requestedBy,
      reason,
    });
    this.log.log(`summary ${state} fixture=${fixtureId} version=${number}`, {
      event: `summary.${state}`,
      fixture_id: fixtureId,
      version_number: number,
      model: completion.model,
      rejection,
      grounded_on: groundingOf(facts),
    });
    return { outcome: state, version_number: number, rejection };
  }

  /** Finished matches of the last days with no version yet, a few at a time. */
  async catchUp(now = new Date()): Promise<{ attempted: number; published: number }> {
    if (this.intelligence.describe().absent) return { attempted: 0, published: 0 };
    const since = new Date(now.getTime() - CATCH_UP_DAYS * 24 * 60 * 60 * 1000);
    const ids = await this.store.unsummarised(since, CATCH_UP_LIMIT);
    let published = 0;
    for (const id of ids) {
      const outcome = await this.generate(id, null, null);
      if (outcome !== 'no_fixture' && outcome.outcome === 'published') published += 1;
    }
    return { attempted: ids.length, published };
  }
}

/** Why a version is rejected, or `null` when it may be published: the stop reason first, then the gate. */
export function rejectionOf(
  stop: 'end_turn' | 'max_tokens' | 'refusal' | 'other',
  text: string,
  facts: MatchFacts,
): string | null {
  if (stop === 'refusal') return 'the model refused';
  if (stop === 'max_tokens') return 'the answer was cut off';
  if (stop === 'other') return 'the model stopped for another reason';
  if (text === '') return 'the model wrote nothing';
  const grounding = checkGrounding(text, facts);
  return grounding.ok ? null : grounding.reason;
}
