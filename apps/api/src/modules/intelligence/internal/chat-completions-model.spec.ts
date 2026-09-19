import { describe, expect, it } from 'vitest';
import {
  ChatCompletionsModel,
  type ChatCompletionsPreset,
  MAX_RETRY_AFTER_MS,
  MISTRAL_BASE_URL,
  retryAfterMs,
} from './chat-completions-model';

/**
 * The second adapter (T-404, D-072) against a scripted `fetch`: the request
 * is the chat-completions shape Mistral's reference documents, the effort
 * travels only for the provider that takes it, the finish reason is read
 * before the text, a 429 is retried once after the pause the server names,
 * and any other failure is thrown for the service to record.
 */
interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function scripted(
  answers: { status: number; body?: unknown; headers?: Record<string, string> }[],
  sent: Sent[] = [],
) {
  const queue = [...answers];
  const fetchLike = async (url: string, init: RequestInit): Promise<Response> => {
    sent.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(init.body as string) as Record<string, unknown>,
    });
    const next = queue.shift() ?? { status: 500, body: { message: 'no more answers' } };
    return new Response(JSON.stringify(next.body ?? {}), {
      status: next.status,
      headers: { 'content-type': 'application/json', ...(next.headers ?? {}) },
    });
  };
  return { fetchLike, sent };
}

const paused: number[] = [];
const pause = async (ms: number) => {
  paused.push(ms);
};

const mistral: ChatCompletionsPreset = {
  provider: 'mistral',
  baseUrl: MISTRAL_BASE_URL,
  model: 'mistral-small-latest',
  apiKey: 'not-a-real-key',
  effort: 'low',
};

const request = { system: 'Write from the record.', prompt: 'Record: 2-2.', maxTokens: 400 };

const answer = (finish: string, content: unknown = 'Liverpool drew 2-2.') => ({
  status: 200,
  body: {
    id: 'cmpl-1',
    model: 'mistral-small-2603',
    choices: [{ index: 0, finish_reason: finish, message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 120, completion_tokens: 14, total_tokens: 134 },
  },
});

describe('ChatCompletionsModel', () => {
  it("sends the reference's request shape with the bearer key, and hands back the text with the model that wrote it", async () => {
    const { fetchLike, sent } = scripted([answer('stop')]);
    const model = new ChatCompletionsModel(mistral, fetchLike, pause);
    expect(await model.complete(request)).toEqual({
      text: 'Liverpool drew 2-2.',
      model: 'mistral-small-2603',
      stop: 'end_turn',
      input_tokens: 120,
      output_tokens: 14,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('https://api.mistral.ai/v1/chat/completions');
    expect(sent[0]!.headers.authorization).toBe('Bearer not-a-real-key');
    expect(sent[0]!.body).toEqual({
      model: 'mistral-small-latest',
      messages: [
        { role: 'system', content: 'Write from the record.' },
        { role: 'user', content: 'Record: 2-2.' },
      ],
      max_tokens: 400,
      reasoning_effort: 'low',
    });
  });

  it('sends only the fields every compatible server takes for an endpoint named by its URL', async () => {
    const { fetchLike, sent } = scripted([answer('stop')]);
    const model = new ChatCompletionsModel(
      {
        provider: 'openai_compatible',
        baseUrl: 'http://127.0.0.1:11434/v1/',
        model: 'llama',
        apiKey: 'k',
        effort: null,
      },
      fetchLike,
      pause,
    );
    await model.complete(request);
    expect(sent[0]!.url).toBe('http://127.0.0.1:11434/v1/chat/completions');
    expect(sent[0]!.body).not.toHaveProperty('reasoning_effort');
    expect(model.provider).toBe('openai_compatible');
    expect(model.model).toBe('llama');
  });

  it('reads the finish reason before the text: a truncation is an outcome with no prose attached', async () => {
    const { fetchLike } = scripted([
      answer('length', 'Liverpool drew 2-2 and then'),
      answer('error'),
    ]);
    const model = new ChatCompletionsModel(mistral, fetchLike, pause);
    expect(await model.complete(request)).toMatchObject({ stop: 'max_tokens', text: '' });
    expect(await model.complete(request)).toMatchObject({ stop: 'other', text: '' });
  });

  it('joins typed content chunks the way it takes a plain string', async () => {
    const { fetchLike } = scripted([
      answer('stop', [
        { type: 'text', text: 'Liverpool ' },
        { type: 'text', text: 'drew 2-2.' },
      ]),
    ]);
    const model = new ChatCompletionsModel(mistral, fetchLike, pause);
    expect((await model.complete(request)).text).toBe('Liverpool drew 2-2.');
  });

  it('retries once after the pause a 429 names, capped, and then records the answer', async () => {
    paused.length = 0;
    const { fetchLike, sent } = scripted([
      { status: 429, body: { message: 'too fast' }, headers: { 'retry-after': '2' } },
      answer('stop'),
    ]);
    const model = new ChatCompletionsModel(mistral, fetchLike, pause);
    expect((await model.complete(request)).stop).toBe('end_turn');
    expect(sent).toHaveLength(2);
    expect(paused).toEqual([2_000]);
    expect(retryAfterMs('60')).toBe(MAX_RETRY_AFTER_MS);
    expect(retryAfterMs(null)).toBe(1_000);
    expect(retryAfterMs('soon')).toBe(1_000);
  });

  it('throws on any other failure, naming the status, for the service to record as failed', async () => {
    const { fetchLike } = scripted([
      { status: 429, body: { message: 'still too fast' } },
      { status: 429, body: { message: 'still too fast' } },
    ]);
    const model = new ChatCompletionsModel(mistral, fetchLike, pause);
    await expect(model.complete(request)).rejects.toThrow(/mistral answered HTTP 429/);
    const { fetchLike: broken } = scripted([{ status: 401, body: { message: 'Unauthorized' } }]);
    await expect(
      new ChatCompletionsModel(mistral, broken, pause).complete(request),
    ).rejects.toThrow(/HTTP 401/);
  });

  it('is built from settings for the two providers it serves, and refuses the one it does not', () => {
    expect(
      ChatCompletionsModel.fromSettings({
        provider: 'mistral',
        model: 'mistral-small-latest',
        effort: 'medium',
        apiKey: 'k',
        baseUrl: null,
      }),
    ).toMatchObject({ provider: 'mistral', model: 'mistral-small-latest' });
    expect(() =>
      ChatCompletionsModel.fromSettings({
        provider: 'anthropic',
        model: 'claude-opus-5',
        effort: 'medium',
        apiKey: 'k',
        baseUrl: null,
      }),
    ).toThrow(/not a chat-completions provider/);
  });
});
