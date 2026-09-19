import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { AnthropicModel, type MessagesSurface, REFUSAL_FALLBACK_BETA } from './anthropic-model';

/**
 * The adapter (T-402) against a scripted Messages surface: the request it
 * sends is the reference's shape -- the deployment's model, adaptive
 * thinking, the effort, the refusal fallback -- and the stop reason is read
 * before the text is, so a refusal or a truncation comes back as an outcome
 * with no prose attached.
 */
function answer(
  over: Partial<Anthropic.Beta.BetaMessage> = {},
  capture?: Anthropic.Beta.MessageCreateParamsNonStreaming[],
): MessagesSurface {
  return {
    create: async (params) => {
      capture?.push(params);
      return {
        id: 'msg_scripted',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5',
        content: [
          {
            type: 'text',
            text: 'Liverpool and Manchester United drew 2-2 at Anfield.',
            citations: null,
          },
        ],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: 120,
          output_tokens: 14,
          cache_creation_input_tokens: null,
          cache_read_input_tokens: null,
          server_tool_use: null,
          service_tier: null,
        },
        ...over,
      } as Anthropic.Beta.BetaMessage;
    },
  };
}

const request = { system: 'Write from the record.', prompt: 'Record: 2-2.', maxTokens: 400 };

describe('AnthropicModel', () => {
  it("sends the reference's request shape and hands back the text with the model that wrote it", async () => {
    const sent: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
    const model = new AnthropicModel('claude-opus-5', 'medium', answer({}, sent));
    const completion = await model.complete(request);
    expect(completion).toEqual({
      text: 'Liverpool and Manchester United drew 2-2 at Anfield.',
      model: 'claude-opus-5',
      stop: 'end_turn',
      input_tokens: 120,
      output_tokens: 14,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      model: 'claude-opus-5',
      max_tokens: 400,
      system: 'Write from the record.',
      messages: [{ role: 'user', content: 'Record: 2-2.' }],
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      betas: [REFUSAL_FALLBACK_BETA],
      fallbacks: 'default',
    });
  });

  it('returns a refusal and a truncation as outcomes with no text, never as prose', async () => {
    const refused = new AnthropicModel('claude-opus-5', 'low', answer({ stop_reason: 'refusal' }));
    expect(await refused.complete(request)).toMatchObject({ stop: 'refusal', text: '' });
    const cut = new AnthropicModel('claude-opus-5', 'low', answer({ stop_reason: 'max_tokens' }));
    expect(await cut.complete(request)).toMatchObject({ stop: 'max_tokens', text: '' });
  });

  it('names its provider and model for the health line', () => {
    const model = new AnthropicModel('claude-sonnet-5', 'high', answer());
    expect(model.provider).toBe('anthropic');
    expect(model.model).toBe('claude-sonnet-5');
  });
});
