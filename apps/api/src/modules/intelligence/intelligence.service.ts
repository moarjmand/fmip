import { Inject, Injectable, Logger } from '@nestjs/common';
import type { IntelligenceHealth } from '@fmip/contracts';
import {
  type Completion,
  type CompletionRequest,
  type Intelligence,
  LANGUAGE_MODEL,
  describeIntelligence,
} from './intelligence.port';

export type CompletionOutcome =
  | { outcome: 'absent' }
  | { outcome: 'completed'; completion: Completion }
  | { outcome: 'failed'; error: string };

/**
 * The one place a request reaches a language model (T-401). Absence is an
 * outcome the caller renders as a sentence, a failure is an outcome the
 * caller records, and neither is an exception: nothing in this phase is on
 * the critical path, so nothing here may take a page down (D-070).
 */
@Injectable()
export class IntelligenceService {
  private readonly log = new Logger('Intelligence');

  constructor(@Inject(LANGUAGE_MODEL) private readonly intelligence: Intelligence) {
    const state = this.describe();
    // Said once at boot, as a fact: a deployment with no model is the normal
    // state of a new one, and must never be mistaken for one that quietly works.
    this.log.log(
      `language model ${state.language_model.state}` +
        (state.language_model.state === 'configured'
          ? ` provider=${state.language_model.provider} model=${state.language_model.model}`
          : ' -- every Phase 5 surface says so'),
      { event: 'intelligence.model', language_model: state.language_model },
    );
  }

  describe(now = new Date()): IntelligenceHealth {
    return describeIntelligence(this.intelligence, now);
  }

  async complete(request: CompletionRequest): Promise<CompletionOutcome> {
    const model = this.intelligence.model;
    if (model === null) return { outcome: 'absent' };
    try {
      return { outcome: 'completed', completion: await model.complete(request) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.error(`intelligence.completion_failed provider=${model.provider}: ${message}`, {
        event: 'intelligence.completion_failed',
        provider: model.provider,
        model: model.model,
      });
      return { outcome: 'failed', error: message };
    }
  }
}
