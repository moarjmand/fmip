import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type {
  LanguageModelState,
  ModerationSuggestion,
  SuggestedCategory,
  SuggestionOutcome,
} from '@fmip/contracts';
import { REPORT_REASONS } from '@fmip/contracts';
import { IntelligenceService } from '../intelligence/intelligence.service';
import { PostgresSuggestionStore } from './internal/suggestion-store';

export const PROMPT_VERSION = 'moderation-assist@1';
const MAX_TOKENS = 400;
const MAX_REASONING = 600;
const CATCH_UP_LIMIT = 10;
const CATCH_UP_EVERY_MS = 5 * 60 * 1000;

/**
 * The platform rules as the assistant may see them (T-442): the three
 * behaviours `13-policy.md` §4 names, in its words, and what to answer when a
 * report describes none of them. Nothing about who anybody is.
 */
export const RULES = [
  'The platform rules (platform-rules@1.0.0) forbid three things.',
  'Spam: repeated unwanted messages, advertising, or link-dropping.',
  'Abuse: harassment, threats, slurs, or targeting somebody for who they are.',
  'Impersonation: presenting yourself as another person, a club, a journalist, or this platform.',
  'A person reads every report and records what they decided, including deciding that nothing was wrong.',
].join(' ');

/** The standing instruction: stable across every report, so the provider can cache it. */
export const ASSIST_SYSTEM = [
  'You assist a human moderator on a football website. You are given the platform rules and one report a member filed about another member: the reason the reporter chose and what they wrote.',
  'Return JSON and nothing else, with two fields: "category", one of "spam", "abuse", "impersonation", "other", "no_action" -- the rule the report describes a breach of, "other" for a breach of something not named above, "no_action" when what is described breaks no rule; and "reasoning", one or two plain sentences saying why, for the moderator to weigh.',
  'You do not decide anything and you take no action. You know nothing about either member beyond this report, and you must not guess at anything about them.',
  RULES,
].join(' ');

const CATEGORIES: readonly SuggestedCategory[] = [...REPORT_REASONS, 'no_action'];

/**
 * Moderation assistance (E44, T-441): a suggestion beside a report, for a
 * moderator who decides. Requested by a catch-up over open reports with no
 * attempt on record when a model exists, or by a moderator for one report;
 * an answer that is not a suggestion, a refusal or a truncation is a
 * rejected row kept for the record and never shown; a failed call leaves no
 * row. Nothing here changes a report, a decision or a sanction.
 */
@Injectable()
export class ModerationAssistService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('ModerationAssist');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: PostgresSuggestionStore,
    private readonly intelligence: IntelligenceService,
  ) {}

  onModuleInit(): void {
    if (this.intelligence.describe().absent || process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      this.catchUp().catch((error: unknown) =>
        this.log.error(
          `moderation_assist.catch_up_failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }, CATCH_UP_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer);
  }

  assistant(): LanguageModelState {
    return this.intelligence.describe().language_model;
  }

  forReports(reportIds: string[]): Promise<Map<string, ModerationSuggestion>> {
    return this.store.latestFor(reportIds);
  }

  async suggest(reportId: string): Promise<SuggestionOutcome | 'no_report'> {
    const report = await this.store.report(reportId);
    if (report === null) return 'no_report';
    const answer = await this.intelligence.complete({
      system: ASSIST_SYSTEM,
      prompt: JSON.stringify({ reason: report.reason, detail: report.detail }),
      maxTokens: MAX_TOKENS,
    });
    if (answer.outcome === 'absent') return { outcome: 'absent' };
    if (answer.outcome === 'failed') return { outcome: 'failed' };
    const { completion } = answer;
    const read =
      completion.stop === 'refusal'
        ? { rejection: 'the model refused' }
        : completion.stop === 'max_tokens'
          ? { rejection: 'the answer was cut off' }
          : completion.stop === 'other'
            ? { rejection: 'the model stopped for another reason' }
            : readSuggestion(completion.text);
    const state = 'rejection' in read ? 'rejected' : 'published';
    const number = await this.store.add({
      reportId,
      state,
      category: 'rejection' in read ? null : read.category,
      reasoning: 'rejection' in read ? null : read.reasoning,
      rejection: 'rejection' in read ? read.rejection : null,
      promptVersion: PROMPT_VERSION,
      model: completion.model,
    });
    this.log.log(`suggestion ${state} report=${reportId} version=${number}`, {
      event: `moderation_assist.${state}`,
      report_id: reportId,
      version_number: number,
      model: completion.model,
    });
    return {
      outcome: state,
      version_number: number,
      rejection: 'rejection' in read ? read.rejection : null,
    };
  }

  async catchUp(): Promise<{ attempted: number; published: number }> {
    if (this.intelligence.describe().absent) return { attempted: 0, published: 0 };
    const ids = await this.store.unsuggested(CATCH_UP_LIMIT);
    let published = 0;
    for (const id of ids) {
      const outcome = await this.suggest(id);
      if (outcome !== 'no_report' && outcome.outcome === 'published') published += 1;
    }
    return { attempted: ids.length, published };
  }
}

/** The model's answer as a suggestion, or the reason it is not one. Strict: exactly the two fields, a known category, some reasoning. */
export function readSuggestion(
  text: string,
): { category: SuggestedCategory; reasoning: string } | { rejection: string } {
  const body = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { rejection: 'the answer was not JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { rejection: 'the answer was not an object' };
  }
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'category,reasoning') {
    return { rejection: 'the answer did not have exactly category and reasoning' };
  }
  const { category, reasoning } = record;
  if (typeof category !== 'string' || !CATEGORIES.includes(category as SuggestedCategory)) {
    return { rejection: `the category is not one the rules name: ${String(category)}` };
  }
  if (typeof reasoning !== 'string' || reasoning.trim() === '') {
    return { rejection: 'the reasoning was empty' };
  }
  return {
    category: category as SuggestedCategory,
    reasoning: reasoning.trim().slice(0, MAX_REASONING),
  };
}
