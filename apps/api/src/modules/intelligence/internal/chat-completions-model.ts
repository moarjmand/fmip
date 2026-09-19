import type {
  Completion,
  CompletionRequest,
  Effort,
  IntelligenceSettings,
  LanguageModel,
  StopReason,
} from '../intelligence.port';

/**
 * The second adapter behind the port (T-404, D-072): the `POST
 * /chat/completions` shape that Mistral's La Plateforme and most other
 * vendors serve, over `fetch` and nothing else. Written from Mistral's API
 * reference on 2026-09-19: a bearer key, `model`, `messages` with a system
 * and a user turn, `max_tokens`, and for Mistral `reasoning_effort`; back
 * come `choices[0].message.content`, `choices[0].finish_reason` and `usage`.
 *
 * Two provider names share it. `mistral` is a preset -- the base URL, the
 * key variable and a default model are known -- and sends the effort the
 * deployment set. `openai_compatible` is any endpoint that answers the same
 * shape (a base URL, a key and a model, all named by the deployment) and
 * sends only the fields every such server accepts, because a field one
 * server does not know is a 400 on another.
 *
 * As with the first adapter, the finish reason is read before the text: a
 * truncation comes back as an outcome, never as prose cut off mid-sentence.
 * A free tier answers 429 when it is asked too fast; that is retried once
 * after the pause the server names (capped), and then it is a failure the
 * caller records. Two things learned on Mistral's free plan on 2026-09-19
 * are handled here rather than documented away: a model that does not take
 * `reasoning_effort` says so with a 400 naming the field, and the adapter
 * drops the field for the rest of the process and sends again; and a model
 * outside the workspace's plan answers 429 with a request limit of zero,
 * which is not "too fast" and is named as what it is. `fetch` is injected
 * so a spec can script every answer.
 */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ChatCompletionsPreset {
  readonly provider: 'mistral' | 'openai_compatible';
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
  /** Sent as `reasoning_effort` where the server takes it (Mistral); omitted otherwise. */
  readonly effort: Effort | null;
}

export const MISTRAL_BASE_URL = 'https://api.mistral.ai/v1';
export const MISTRAL_DEFAULT_MODEL = 'mistral-small-latest';
/** The longest this waits on a 429 before trying once more; a longer pause is the caller's failure to record. */
export const MAX_RETRY_AFTER_MS = 5_000;

interface ChatCompletionsResponse {
  model?: string;
  choices?: {
    finish_reason?: string | null;
    message?: { content?: string | { type?: string; text?: string }[] | null };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class ChatCompletionsModel implements LanguageModel {
  readonly provider: string;
  readonly model: string;
  /** Learned from a 400 that names the field: a model that takes no effort is not asked again. */
  private effortAccepted = true;

  constructor(
    private readonly preset: ChatCompletionsPreset,
    private readonly fetchLike: FetchLike = (input, init) => fetch(input, init),
    private readonly pause: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {
    this.provider = preset.provider;
    this.model = preset.model;
  }

  static fromSettings(settings: IntelligenceSettings): ChatCompletionsModel {
    if (settings.provider === 'mistral') {
      return new ChatCompletionsModel({
        provider: 'mistral',
        baseUrl: settings.baseUrl ?? MISTRAL_BASE_URL,
        model: settings.model,
        apiKey: settings.apiKey,
        effort: settings.effort,
      });
    }
    if (settings.provider === 'openai_compatible' && settings.baseUrl !== null) {
      return new ChatCompletionsModel({
        provider: 'openai_compatible',
        baseUrl: settings.baseUrl,
        model: settings.model,
        apiKey: settings.apiKey,
        effort: null,
      });
    }
    throw new Error(`${settings.provider} is not a chat-completions provider`);
  }

  async complete(request: CompletionRequest): Promise<Completion> {
    let response = await this.send(this.bodyFor(request));
    if (response.status === 400 && this.preset.effort !== null && this.effortAccepted) {
      const detail = await response
        .clone()
        .text()
        .catch(() => '');
      if (detail.includes('reasoning_effort')) {
        this.effortAccepted = false;
        response = await this.send(this.bodyFor(request));
      }
    }
    if (response.status === 429 && response.headers.get('x-ratelimit-limit-req-minute') === '0') {
      throw new Error(
        `${this.provider} answered HTTP 429 with a request limit of zero: ${this.preset.model} is not in this workspace's plan (on Mistral's free plan the Ministral models answer; set INTELLIGENCE_MODEL)`,
      );
    }
    if (response.status === 429) {
      await this.pause(retryAfterMs(response.headers.get('retry-after')));
      response = await this.send(this.bodyFor(request));
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 200);
      throw new Error(
        `${this.provider} answered HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
      );
    }
    const answer = (await response.json()) as ChatCompletionsResponse;
    const choice = answer.choices?.[0];
    const stop = stopReason(choice?.finish_reason ?? null);
    return {
      text: stop === 'end_turn' ? textOf(choice?.message?.content ?? null) : '',
      model: answer.model ?? this.preset.model,
      stop,
      input_tokens: answer.usage?.prompt_tokens ?? 0,
      output_tokens: answer.usage?.completion_tokens ?? 0,
    };
  }

  private bodyFor(request: CompletionRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.preset.model,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.prompt },
      ],
      max_tokens: request.maxTokens,
    };
    if (this.preset.effort !== null && this.effortAccepted) {
      body.reasoning_effort = this.preset.effort;
    }
    return body;
  }

  private send(body: Record<string, unknown>): Promise<Response> {
    return this.fetchLike(`${this.preset.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.preset.apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
  }
}

/** The pause a 429 names, in milliseconds, capped; a second when it names none. */
export function retryAfterMs(header: string | null): number {
  const seconds = Number(header);
  if (header === null || !Number.isFinite(seconds) || seconds < 0) return 1_000;
  return Math.min(seconds * 1_000, MAX_RETRY_AFTER_MS);
}

/** `stop` is the whole answer; `length` and `model_length` are the two ways a server says it was cut off. */
function stopReason(reason: string | null): StopReason {
  switch (reason) {
    case 'stop':
      return 'end_turn';
    case 'length':
    case 'model_length':
      return 'max_tokens';
    default:
      return 'other';
  }
}

/** Content is a string, or on some servers a list of typed chunks; either way the text, trimmed. */
function textOf(content: string | { type?: string; text?: string }[] | null): string {
  if (content === null) return '';
  if (typeof content === 'string') return content.trim();
  return content
    .filter((chunk) => chunk.type === undefined || chunk.type === 'text')
    .map((chunk) => chunk.text ?? '')
    .join('')
    .trim();
}
