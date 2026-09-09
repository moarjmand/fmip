import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ADAPTER_CALLS,
  type AdapterCall,
  type AdapterConfig,
  type AdapterErrorKind,
  type AdapterFactory,
  type AdapterResult,
} from '../adapters/_contract';
import { type RecordedRequest, ReplayTransport } from './replay-transport';
import {
  type Problem,
  expectTimestamp,
  validateFixture,
  validateFixtureDetail,
  validateLineup,
  validateManifest,
  validateStanding,
} from './validate';

/**
 * One recorded scenario: a contract call, its arguments, the responses the
 * provider gave, and what a conforming adapter must make of them. Stored as
 * JSON under `adapters/_fixtures/<provider>/<name>.json`.
 */
export interface Scenario {
  name: string;
  /** When the responses were recorded; replayed as `receivedAt`. */
  recordedAt: string;
  call: AdapterCall;
  args: unknown[];
  expect: {
    ok: boolean;
    /** For list calls: the fewest items a conforming adapter must produce. */
    minItems?: number;
    /** For failing calls: the error kind a conforming adapter must report. */
    errorKind?: AdapterErrorKind;
  };
  requests: RecordedRequest[];
}

export interface ContractProblem extends Problem {
  scenario: string;
}

const MANIFEST = '<manifest>';
const SCENARIOS = '<scenarios>';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parses one scenario file, refusing anything the check could not act on. */
export function parseScenario(raw: unknown, source: string): Scenario {
  if (!isRecord(raw)) throw new Error(`${source}: scenario must be an object`);

  const { name, recordedAt, call, args, expect, requests } = raw;

  if (typeof name !== 'string' || name === '') throw new Error(`${source}: name is required`);
  if (typeof recordedAt !== 'string') throw new Error(`${source}: recordedAt is required`);
  if (typeof call !== 'string' || !(ADAPTER_CALLS as readonly string[]).includes(call)) {
    throw new Error(`${source}: call must be one of ${ADAPTER_CALLS.join(', ')}`);
  }
  if (!Array.isArray(args)) throw new Error(`${source}: args must be an array`);
  if (!isRecord(expect) || typeof expect.ok !== 'boolean') {
    throw new Error(`${source}: expect.ok is required`);
  }
  if (!Array.isArray(requests)) throw new Error(`${source}: requests must be an array`);

  for (const [index, request] of requests.entries()) {
    if (
      !isRecord(request) ||
      request.method !== 'GET' ||
      typeof request.url !== 'string' ||
      typeof request.status !== 'number'
    ) {
      throw new Error(`${source}: requests[${index}] needs method GET, url and status`);
    }
  }

  return {
    name,
    recordedAt,
    call: call as AdapterCall,
    args,
    expect: {
      ok: expect.ok,
      ...(typeof expect.minItems === 'number' ? { minItems: expect.minItems } : {}),
      ...(typeof expect.errorKind === 'string'
        ? { errorKind: expect.errorKind as AdapterErrorKind }
        : {}),
    },
    requests: requests as RecordedRequest[],
  };
}

/** Every `*.json` in a provider's `_fixtures` directory, by file name. */
export function loadScenarios(dir: string): Scenario[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) =>
      parseScenario(JSON.parse(readFileSync(join(dir, file), 'utf8')) as unknown, join(dir, file)),
    );
}

function validateData(call: AdapterCall, data: unknown, minItems: number | undefined): Problem[] {
  const problems: Problem[] = [];

  const asList = (validate: (item: unknown, path: string) => Problem[], noun: string): void => {
    if (!Array.isArray(data)) {
      problems.push({ path: 'data', message: `must be an array of ${noun}` });
      return;
    }
    if (minItems !== undefined && data.length < minItems) {
      problems.push({
        path: 'data',
        message: `expected at least ${minItems} ${noun}, received ${data.length}`,
      });
    }
    data.forEach((item, index) => problems.push(...validate(item, `data[${index}]`)));
  };

  switch (call) {
    case 'listFixtures':
    case 'getLive':
      asList(validateFixture, 'fixtures');
      break;
    case 'getStandings':
      asList(validateStanding, 'standings');
      break;
    case 'getLineup':
      problems.push(...validateLineup(data, 'data'));
      break;
    case 'getFixtureDetail':
      problems.push(...validateFixtureDetail(data, 'data'));
      break;
  }

  return problems;
}

/**
 * Runs an adapter through every recorded scenario and returns what is wrong.
 *
 * An empty result is the pass. The acceptance criterion for T-020 is the
 * converse: a non-conforming adapter produces a non-empty result, and the
 * harness's own tests prove that with deliberately broken adapters. Checks:
 *
 *   - the manifest is valid and honours D-014;
 *   - there is at least one scenario (an unverified adapter is not verified);
 *   - the call returns a value (a thrown error is a contract violation:
 *     failure is an `AdapterResult`, not an exception);
 *   - every request went to a recorded URL, and `requests` reports the true
 *     count (the bake-off's quota metric depends on it);
 *   - success or failure matches the scenario, and success carries data that
 *     validates as the normalised shape for that call.
 */
export async function checkAdapterContract(
  factory: AdapterFactory,
  scenarios: readonly Scenario[],
  config: AdapterConfig = { apiKey: null },
): Promise<ContractProblem[]> {
  const problems: ContractProblem[] = [];
  const report = (scenario: string, list: Problem[]): void => {
    for (const problem of list) problems.push({ scenario, ...problem });
  };

  const probe = factory(new ReplayTransport([], new Date(0).toISOString()), config);
  report(MANIFEST, validateManifest(probe.manifest));

  if (scenarios.length === 0) {
    report(SCENARIOS, [{ path: '', message: 'no recorded scenarios: the adapter is unverified' }]);
    return problems;
  }

  for (const scenario of scenarios) {
    const transport = new ReplayTransport(scenario.requests, scenario.recordedAt);
    const adapter = factory(transport, config);
    const call = adapter[scenario.call] as (...args: unknown[]) => Promise<AdapterResult<unknown>>;

    let result: AdapterResult<unknown>;
    try {
      result = await call.apply(adapter, scenario.args);
    } catch (error: unknown) {
      report(scenario.name, [
        {
          path: '',
          message: `threw instead of returning a result: ${error instanceof Error ? error.message : String(error)}`,
        },
      ]);
      continue;
    }

    const local: Problem[] = [];

    for (const key of transport.unmatched) {
      local.push({ path: 'transport', message: `requested an unrecorded URL: ${key}` });
    }

    if (!isRecord(result) || typeof result.ok !== 'boolean') {
      local.push({ path: 'result', message: 'must be an AdapterResult with a boolean ok' });
      report(scenario.name, local);
      continue;
    }

    const made = transport.served.length + transport.unmatched.length;
    if (result.requests !== made) {
      local.push({
        path: 'result.requests',
        message: `reports ${String(result.requests)} requests but made ${made}`,
      });
    }

    if (result.ok) {
      if (!scenario.expect.ok) {
        local.push({
          path: 'result.ok',
          message: `expected failure${scenario.expect.errorKind ? ` of kind ${scenario.expect.errorKind}` : ''}, received success`,
        });
      } else {
        expectTimestamp(local, result.fetchedAt, 'result.fetchedAt');
        local.push(...validateData(scenario.call, result.data, scenario.expect.minItems));
      }
    } else {
      if (scenario.expect.ok) {
        local.push({
          path: 'result.ok',
          message: `expected success, received ${result.error.kind}: ${result.error.message}`,
        });
      } else if (
        scenario.expect.errorKind !== undefined &&
        result.error.kind !== scenario.expect.errorKind
      ) {
        local.push({
          path: 'result.error.kind',
          message: `expected ${scenario.expect.errorKind}, received ${result.error.kind}`,
        });
      }
    }

    report(scenario.name, local);
  }

  return problems;
}
