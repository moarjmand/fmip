/**
 * The replay source (T-026, D-049).
 *
 * Not a fourth provider: a way to run a real adapter with no key, no network
 * and no terms. It builds the adapter under test with a `ReplayTransport` over
 * that provider's committed recordings, so a job exercises the same mapping,
 * the same entity resolution and the same writers as a live provider, and gets
 * back exactly what the provider really said on the day the recording was made.
 *
 * A recording is one snapshot per URL, so a replay is deterministic: running
 * the same job twice must write nothing the second time, which is T-026's
 * acceptance criterion. What a snapshot cannot show is a match changing over
 * time; recording a sequence and replaying it on a compressed clock is the next
 * step and is not built (`docs/05-data-providers.md`).
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AdapterFactory, ProviderAdapter, Transport } from '../_contract';
import { loadScenarios } from '../../harness/contract-check';
import { ReplayTransport } from '../../harness/replay-transport';
import type { Provider } from '../../normalised';
import { createApiFootballAdapter } from '../api-football';
import { createFootballDataOrgAdapter } from '../football-data-org';
import { createHighlightlyAdapter } from '../highlightly';

export { REPLAY_FIXTURE, REPLAY_QUERY } from './plan';

const FACTORIES: Record<Provider, AdapterFactory> = {
  api_football: createApiFootballAdapter,
  football_data_org: createFootballDataOrgAdapter,
  highlightly: createHighlightlyAdapter,
};

/**
 * The directory holding a provider's recordings.
 *
 * The recordings live beside the adapters in `src/`, which a built package does
 * not ship. That is deliberate: replay is for development, tests and CI, where
 * the repository is present. `replayAvailable` says whether they are there, so
 * a deployment without them reports "no source" rather than failing a job.
 */
export function recordingsDir(provider: Provider, root: string = defaultRoot()): string {
  return join(root, provider.replace(/_/g, '-'));
}

/**
 * Where the recordings are, in both layouts.
 *
 * `tsc` copies no JSON, so a built package has `dist/` without them and the
 * files are still where they were written, under `src/`. Trying the compiled
 * location first and the source tree second means replay works from a build,
 * from a test and from a `ts-node`-style run without anything being copied
 * around at build time.
 */
function defaultRoot(): string {
  const beside = join(__dirname, '..', '_fixtures');
  if (existsSync(beside)) return beside;
  return join(__dirname, '..', '..', '..', 'src', 'adapters', '_fixtures');
}

export function replayAvailable(provider: Provider, root: string = defaultRoot()): boolean {
  return existsSync(recordingsDir(provider, root));
}

/**
 * Every request in every scenario for one provider, flattened into a single
 * transport. A scenario is normally one call; a job makes several, and each is
 * answered from whichever scenario recorded that URL.
 */
export function replayTransport(provider: Provider, root: string = defaultRoot()): Transport {
  const scenarios = loadScenarios(recordingsDir(provider, root));
  if (scenarios.length === 0) {
    throw new Error(`replay: no recordings for ${provider}`);
  }
  const requests = scenarios.flatMap((scenario) => scenario.requests);
  const recordedAt = scenarios
    .map((scenario) => scenario.recordedAt)
    .sort()
    .at(-1) as string;
  return new ReplayTransport(requests, recordedAt);
}

/**
 * The adapter a replay job talks to. The manifest is the provider's own, with
 * the tier renamed so a run is never mistaken for a live one and the quota
 * cleared: a recording costs nothing.
 */
export function createReplayAdapter(
  provider: Provider,
  root: string = defaultRoot(),
): ProviderAdapter {
  const adapter = FACTORIES[provider](replayTransport(provider, root), { apiKey: null });
  return {
    ...adapter,
    manifest: {
      ...adapter.manifest,
      displayName: `${adapter.manifest.displayName} (replay)`,
      licence: { ...adapter.manifest.licence, tier: `${adapter.manifest.licence.tier}, replayed` },
      quota: { requestsPerDay: null, requestsPerMinute: null },
    },
    listFixtures: adapter.listFixtures.bind(adapter),
    getLive: adapter.getLive.bind(adapter),
    getLineup: adapter.getLineup.bind(adapter),
    getStandings: adapter.getStandings.bind(adapter),
    getFixtureDetail: adapter.getFixtureDetail.bind(adapter),
  };
}
