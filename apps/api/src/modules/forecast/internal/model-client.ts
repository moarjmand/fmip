import type { ModelForecastRequest, ModelForecastResponse, ModelHealth } from '@fmip/contracts';

/**
 * The API's side of the internal contract with the model service (T-063).
 *
 * Two jobs: make the HTTP call, and refuse anything that does not match the
 * contract. The service is ours, but a response that drifted from the shape
 * `@fmip/contracts` promises would otherwise reach a page as a half-filled
 * object that looks like a forecast (rule 3). Failure is a value.
 */

export type ModelCallResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: 'unreachable' | 'http' | 'contract'; message: string; status?: number };

export interface ModelClientOptions {
  baseUrl: string;
  /** Milliseconds. A fit can take a moment on a cold service. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LEADING_FACTORS = new Set(['team_strength', 'home_advantage', 'attack_vs_defence']);
const FAVOURS = new Set(['home', 'away', 'neither']);
const REASONS = new Set(['team_not_mapped', 'no_history', 'division_not_loaded']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' && !Number.isNaN(Date.parse(value)) && /T\d{2}:\d{2}/.test(value)
  );
}

/**
 * Every rule the contract states, checked. Returns the problems, empty when
 * the value is a `ModelForecastResponse`.
 */
export function contractProblems(value: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(value)) return ['response is not an object'];

  if (typeof value.fixture_id !== 'string' || !UUID.test(value.fixture_id)) {
    problems.push('fixture_id must be a UUID');
  }
  if (!isIsoTimestamp(value.computed_at)) problems.push('computed_at must be an ISO timestamp');

  if (value.status === 'unavailable') {
    if (typeof value.reason !== 'string' || !REASONS.has(value.reason)) {
      problems.push('reason must be one of the contract reasons');
    }
    if (typeof value.detail !== 'string' || value.detail === '')
      problems.push('detail is required');
    return problems;
  }

  if (value.status !== 'available') {
    return [...problems, 'status must be available or unavailable'];
  }

  const p = value.probabilities;
  if (!isRecord(p) || !isProbability(p.home) || !isProbability(p.draw) || !isProbability(p.away)) {
    problems.push('probabilities must be three numbers in [0, 1]');
  } else if (Math.abs(p.home + p.draw + p.away - 1) > 0.0011) {
    problems.push(`probabilities must total 1, got ${p.home + p.draw + p.away}`);
  }

  const xg = value.expected_goals;
  if (
    !isRecord(xg) ||
    typeof xg.home !== 'number' ||
    typeof xg.away !== 'number' ||
    xg.home <= 0 ||
    xg.away <= 0
  ) {
    problems.push('expected_goals must be two positive numbers');
  }

  if (!Array.isArray(value.most_likely_scorelines) || value.most_likely_scorelines.length === 0) {
    problems.push('most_likely_scorelines must be a non-empty array');
  } else {
    value.most_likely_scorelines.forEach((s, i) => {
      if (
        !isRecord(s) ||
        !Number.isInteger(s.home) ||
        !Number.isInteger(s.away) ||
        !isProbability(s.probability)
      ) {
        problems.push(`most_likely_scorelines[${i}] is malformed`);
      }
    });
  }

  if (!Array.isArray(value.leading_factors)) {
    problems.push('leading_factors must be an array');
  } else {
    value.leading_factors.forEach((f, i) => {
      if (
        !isRecord(f) ||
        typeof f.factor !== 'string' ||
        !LEADING_FACTORS.has(f.factor) ||
        typeof f.favours !== 'string' ||
        !FAVOURS.has(f.favours) ||
        typeof f.magnitude !== 'number' ||
        typeof f.note !== 'string'
      ) {
        problems.push(`leading_factors[${i}] is malformed`);
      }
    });
  }

  const inputs = value.inputs;
  if (
    !isRecord(inputs) ||
    typeof inputs.model_version !== 'string' ||
    !/^[a-z0-9-]+@\d+\.\d+\.\d+$/.test(inputs.model_version) ||
    typeof inputs.fit_date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(inputs.fit_date) ||
    !Number.isInteger(inputs.matches_used) ||
    typeof inputs.elo_used !== 'boolean' ||
    !(inputs.history_from === null || typeof inputs.history_from === 'string') ||
    !(inputs.data_completeness === 'available' || inputs.data_completeness === 'limited')
  ) {
    problems.push('inputs is malformed');
  }

  return problems;
}

export class ModelClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  readonly baseUrl: string;

  constructor(options: ModelClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async health(): Promise<ModelCallResult<ModelHealth>> {
    const result = await this.call('/health', undefined);
    if (!result.ok) return result;
    const body = result.data;
    if (
      !isRecord(body) ||
      body.status !== 'ok' ||
      body.service !== 'model' ||
      typeof body.model_version !== 'string' ||
      !isIsoTimestamp(body.checked_at)
    ) {
      return {
        ok: false,
        kind: 'contract',
        message: 'health response does not match the contract',
      };
    }
    return { ok: true, data: body as unknown as ModelHealth };
  }

  async forecast(request: ModelForecastRequest): Promise<ModelCallResult<ModelForecastResponse>> {
    const result = await this.call('/forecast', request);
    if (!result.ok) return result;

    const problems = contractProblems(result.data);
    if (problems.length > 0) {
      return { ok: false, kind: 'contract', message: problems.join('; ') };
    }
    return { ok: true, data: result.data as ModelForecastResponse };
  }

  private async call(path: string, body: unknown): Promise<ModelCallResult<unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error: unknown) {
      return {
        ok: false,
        kind: 'unreachable',
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let json: unknown = null;
    try {
      json = text === '' ? null : (JSON.parse(text) as unknown);
    } catch {
      return {
        ok: false,
        kind: 'contract',
        message: 'response body is not JSON',
        status: response.status,
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        kind: 'http',
        message: `HTTP ${response.status}`,
        status: response.status,
      };
    }
    return { ok: true, data: json };
  }
}
