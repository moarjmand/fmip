import type { IntelligenceHealth, LanguageModelState } from '@fmip/contracts';

/**
 * A language model behind one port (T-401, Phase 5, D-070): a provider
 * chosen at deployment, and **a deployment that has none saying so**.
 *
 * The delivery port's shape (T-330), because it is the same problem: a
 * capability that may or may not exist on a given server, that must never
 * look present when it is absent, and whose absence every surface has an
 * honest sentence for. A model that is "configured" and cannot answer is the
 * failure this file exists to prevent, so a provider name this build cannot
 * drive stops the process at boot, and so does a driveable name with no key
 * beside it.
 */
export type StopReason = 'end_turn' | 'max_tokens' | 'refusal' | 'other';

/** What the model produced, and how it stopped. A refusal or a truncation is an outcome here, never text passed on. */
export interface Completion {
  text: string;
  model: string;
  stop: StopReason;
  input_tokens: number;
  output_tokens: number;
}

export interface CompletionRequest {
  /** The standing instruction, stable across calls of the same kind. */
  system: string;
  /** The grounded document the model answers from. */
  prompt: string;
  maxTokens: number;
}

export interface LanguageModel {
  readonly provider: string;
  readonly model: string;
  complete(request: CompletionRequest): Promise<Completion>;
}

export interface Intelligence {
  readonly model: LanguageModel | null;
}

export const LANGUAGE_MODEL = Symbol('LANGUAGE_MODEL');

/** No model: what every deployment is until a key exists on its server. */
export class AbsentIntelligence implements Intelligence {
  readonly model = null;
}

export function modelState(model: LanguageModel | null): LanguageModelState {
  return model === null
    ? { state: 'absent' }
    : { state: 'configured', provider: model.provider, model: model.model };
}

export function describeIntelligence(
  intelligence: Intelligence,
  now = new Date(),
): IntelligenceHealth {
  return {
    checked_at: now.toISOString(),
    language_model: modelState(intelligence.model),
    absent: intelligence.model === null,
  };
}

/**
 * The providers this build can drive (D-072): Anthropic through its SDK,
 * Mistral as a named preset of the chat-completions adapter, and any other
 * endpoint that answers the same shape, named by its URL.
 */
export const KNOWN_PROVIDERS = ['anthropic', 'mistral', 'openai_compatible'] as const;
export type Provider = (typeof KNOWN_PROVIDERS)[number];

/** How hard the model thinks per request; the surfaces of this phase are routine, so `medium` is the default. */
export const EFFORTS = ['low', 'medium', 'high'] as const;
export type Effort = (typeof EFFORTS)[number];

/** The model the reference names as the default for new work; a deployment may name another. */
export const DEFAULT_MODEL = 'claude-opus-5';

/** Where each provider's key lives on the server; the generic endpoint has its own, unprefixed. */
export const KEY_VARIABLE: Record<Provider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  openai_compatible: 'INTELLIGENCE_API_KEY',
};

/** A default model where the provider is known; the generic endpoint must name one. */
export const DEFAULT_MODEL_OF: Record<Provider, string | null> = {
  anthropic: DEFAULT_MODEL,
  mistral: 'mistral-small-latest',
  openai_compatible: null,
};

export interface IntelligenceSettings {
  provider: Provider;
  model: string;
  effort: Effort;
  /** Read from the environment and handed to the adapter; never logged, never stored. */
  apiKey: string;
  /** The endpoint, for the generic provider (`INTELLIGENCE_BASE_URL`); `null` where the provider knows its own. */
  baseUrl: string | null;
}

/**
 * What the deployment configured, or `null` for an honest absence. `off` or
 * unset is absent. A provider this build cannot drive, a driveable provider
 * with no key, or an effort that is not one of the three **refuses to
 * start**: a typo that silently became "absent" would be found weeks later
 * by nobody having been told anything.
 */
export function settingsFromEnv(env: NodeJS.ProcessEnv = process.env): IntelligenceSettings | null {
  const provider = (env.INTELLIGENCE_PROVIDER ?? 'off').trim().toLowerCase();
  if (provider === 'off' || provider === '') return null;
  if (!(KNOWN_PROVIDERS as readonly string[]).includes(provider)) {
    throw new Error(
      `INTELLIGENCE_PROVIDER=${provider} is not a provider this build can drive` +
        ` (known: ${KNOWN_PROVIDERS.join(', ')}; use "off" for none)`,
    );
  }
  const known = provider as Provider;
  const keyVariable = KEY_VARIABLE[known];
  const apiKey = (env[keyVariable] ?? '').trim();
  if (apiKey === '') {
    throw new Error(
      `INTELLIGENCE_PROVIDER=${known} needs ${keyVariable} on the server; a configured model that cannot answer is not allowed to start`,
    );
  }
  const model = (env.INTELLIGENCE_MODEL ?? '').trim() || DEFAULT_MODEL_OF[known];
  if (model === null) {
    throw new Error(
      'INTELLIGENCE_PROVIDER=openai_compatible needs INTELLIGENCE_MODEL: no default model is known for an endpoint named by its URL',
    );
  }
  const baseUrl = (env.INTELLIGENCE_BASE_URL ?? '').trim() || null;
  const isHttp =
    baseUrl !== null && (baseUrl.startsWith('http://') || baseUrl.startsWith('https://'));
  if (known === 'openai_compatible' && !isHttp) {
    throw new Error(
      'INTELLIGENCE_PROVIDER=openai_compatible needs INTELLIGENCE_BASE_URL, the endpoint that answers /chat/completions (an http or https URL)',
    );
  }
  const effort = (env.INTELLIGENCE_EFFORT ?? 'medium').trim().toLowerCase();
  if (!(EFFORTS as readonly string[]).includes(effort)) {
    throw new Error(
      `INTELLIGENCE_EFFORT=${effort} must be one of ${EFFORTS.join(', ')} (default medium)`,
    );
  }
  return { provider: known, model, effort: effort as Effort, apiKey, baseUrl };
}
