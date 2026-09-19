import { describe, expect, it } from 'vitest';
import {
  AbsentIntelligence,
  DEFAULT_MODEL,
  type LanguageModel,
  describeIntelligence,
  settingsFromEnv,
} from './intelligence.port';
import { IntelligenceService } from './intelligence.service';

/**
 * The port's honest half (T-401): with nothing configured the model is absent
 * and says so; a provider this build cannot drive, a driveable one with no
 * key, or an effort that is not one of the three stops the process instead of
 * silently becoming "absent"; completing into absence is an outcome, not an
 * exception and not a success; and a model that throws is a failure the
 * caller records, never a page that falls over.
 */
describe('settingsFromEnv', () => {
  it('is absent when nothing is configured, and when the provider is off', () => {
    for (const env of [{}, { INTELLIGENCE_PROVIDER: 'off' }, { INTELLIGENCE_PROVIDER: '' }]) {
      expect(settingsFromEnv(env)).toBeNull();
    }
    expect(describeIntelligence(new AbsentIntelligence())).toMatchObject({
      language_model: { state: 'absent' },
      absent: true,
    });
  });

  it('refuses to start on a provider this build cannot drive, naming the variable', () => {
    expect(() => settingsFromEnv({ INTELLIGENCE_PROVIDER: 'openai' })).toThrow(
      /INTELLIGENCE_PROVIDER=openai/,
    );
  });

  it('refuses a driveable provider with no key beside it', () => {
    expect(() => settingsFromEnv({ INTELLIGENCE_PROVIDER: 'anthropic' })).toThrow(
      /ANTHROPIC_API_KEY/,
    );
    expect(() =>
      settingsFromEnv({ INTELLIGENCE_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: '   ' }),
    ).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('takes the reference default model and a medium effort unless the deployment names others', () => {
    const settings = settingsFromEnv({
      INTELLIGENCE_PROVIDER: 'Anthropic',
      ANTHROPIC_API_KEY: 'not-a-real-key',
    });
    expect(settings).toEqual({
      provider: 'anthropic',
      model: DEFAULT_MODEL,
      effort: 'medium',
      apiKey: 'not-a-real-key',
    });
    expect(
      settingsFromEnv({
        INTELLIGENCE_PROVIDER: 'anthropic',
        ANTHROPIC_API_KEY: 'k',
        INTELLIGENCE_MODEL: 'claude-sonnet-5',
        INTELLIGENCE_EFFORT: 'LOW',
      }),
    ).toMatchObject({ model: 'claude-sonnet-5', effort: 'low' });
    expect(() =>
      settingsFromEnv({
        INTELLIGENCE_PROVIDER: 'anthropic',
        ANTHROPIC_API_KEY: 'k',
        INTELLIGENCE_EFFORT: 'max',
      }),
    ).toThrow(/INTELLIGENCE_EFFORT=max/);
  });
});

describe('IntelligenceService', () => {
  const request = { system: 'Write from the record.', prompt: 'The record.', maxTokens: 200 };

  it('reports absence rather than throwing or pretending', async () => {
    const service = new IntelligenceService(new AbsentIntelligence());
    expect(await service.complete(request)).toEqual({ outcome: 'absent' });
    expect(service.describe().absent).toBe(true);
  });

  it('hands back what a configured model wrote, and names it', async () => {
    const model: LanguageModel = {
      provider: 'scripted',
      model: 'scripted-1',
      complete: async () => ({
        text: 'Two each.',
        model: 'scripted-1',
        stop: 'end_turn',
        input_tokens: 10,
        output_tokens: 3,
      }),
    };
    const service = new IntelligenceService({ model });
    expect(await service.complete(request)).toMatchObject({
      outcome: 'completed',
      completion: { text: 'Two each.', stop: 'end_turn' },
    });
    expect(service.describe()).toMatchObject({
      language_model: { state: 'configured', provider: 'scripted', model: 'scripted-1' },
      absent: false,
    });
  });

  it('turns a model that throws into a failure the caller records', async () => {
    const model: LanguageModel = {
      provider: 'scripted',
      model: 'scripted-1',
      complete: async () => {
        throw new Error('rate limited');
      },
    };
    const service = new IntelligenceService({ model });
    expect(await service.complete(request)).toEqual({ outcome: 'failed', error: 'rate limited' });
  });
});
