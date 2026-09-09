// The provider-neutral model every adapter produces.
export * from './normalised';

// The adapter contract.
export {
  ADAPTER_CALLS,
  type AdapterCall,
  type AdapterConfig,
  type AdapterError,
  type AdapterErrorKind,
  type AdapterFactory,
  type AdapterManifest,
  type AdapterResult,
  type FixtureQuery,
  type LiveQuery,
  type ProviderAdapter,
  type StandingsQuery,
  type Transport,
  type TransportInit,
  type TransportResponse,
} from './adapters/_contract';

// The recorded-fixture contract harness.
export {
  checkAdapterContract,
  loadScenarios,
  parseScenario,
  type ContractProblem,
  type Scenario,
} from './harness/contract-check';
export {
  RecordingTransport,
  ReplayTransport,
  type RecordedRequest,
} from './harness/replay-transport';
export {
  type Problem,
  validateFixture,
  validateFixtureDetail,
  validateIncident,
  validateLineup,
  validateManifest,
  validateStanding,
} from './harness/validate';
