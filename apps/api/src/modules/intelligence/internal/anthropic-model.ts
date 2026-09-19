import Anthropic from '@anthropic-ai/sdk';
import type {
  Completion,
  CompletionRequest,
  Effort,
  IntelligenceSettings,
  LanguageModel,
  StopReason,
} from '../intelligence.port';

/**
 * The first adapter behind the port (T-402, D-070): Anthropic's Messages API
 * through the official SDK. Written from the reference, not from memory:
 * adaptive thinking, an effort the deployment sets, the server-side refusal
 * fallback enabled, and the stop reason read before the text is -- a refusal
 * or a truncation comes back as an outcome the caller treats as a rejection,
 * never as prose.
 *
 * The `messages` surface is injected so a spec can script every answer and
 * assert every request without a key or a network.
 */
export interface MessagesSurface {
  create(
    params: Anthropic.Beta.MessageCreateParamsNonStreaming,
  ): Promise<Anthropic.Beta.BetaMessage>;
}

/** The beta that turns on the server-side refusal fallback, per the reference. */
export const REFUSAL_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export class AnthropicModel implements LanguageModel {
  readonly provider = 'anthropic';

  constructor(
    readonly model: string,
    private readonly effort: Effort,
    private readonly messages: MessagesSurface,
  ) {}

  static fromSettings(settings: IntelligenceSettings): AnthropicModel {
    const client = new Anthropic({ apiKey: settings.apiKey });
    return new AnthropicModel(settings.model, settings.effort, client.beta.messages);
  }

  async complete(request: CompletionRequest): Promise<Completion> {
    const response = await this.messages.create({
      model: this.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: [{ role: 'user', content: request.prompt }],
      thinking: { type: 'adaptive' },
      output_config: { effort: this.effort },
      betas: [REFUSAL_FALLBACK_BETA],
      fallbacks: 'default',
    });
    const stop = stopReason(response.stop_reason);
    const text =
      stop === 'end_turn'
        ? response.content
            .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
            .map((block) => block.text)
            .join('')
            .trim()
        : '';
    return {
      text,
      model: response.model,
      stop,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    };
  }
}

function stopReason(reason: string | null): StopReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end_turn';
    case 'max_tokens':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    default:
      return 'other';
  }
}
