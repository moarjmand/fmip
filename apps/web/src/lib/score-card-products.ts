import type {
  CommunityConsensusResponse,
  ForecastSummary,
  ForecastUnavailableReason,
  MatchViewing,
  ScoresResponse,
} from '@fmip/contracts';
import { percentages } from './forecast';
import { optionsState } from './viewing';

/**
 * What the scores card says about the model, the community and viewing
 * (T-940, D-114, blueprint 4.1), reduced on the server to the few plain values
 * a row needs, so the client receives a line per card and not a forecast.
 *
 * **Three types, three builders, three maps.** The model's forecast and the
 * community consensus are two of the three prediction products (rule 6). Each
 * has its own endpoint, its own state type here and its own component on the
 * card; nothing takes "a prediction" with a source attached, so there is no
 * place for the two to be blended, averaged or relabelled.
 *
 * Every state that is not a figure is a stated reason (rule 3): the card never
 * draws an empty bar.
 */

/** The page asks about at most this many matches per request, per product. */
export const CARD_BATCH = 50;

/** The ids of every card the page will show, pinned first, each once. */
export function cardIds(scores: ScoresResponse): string[] {
  const ids = [
    ...scores.pinned.map((card) => card.id),
    ...scores.groups.flatMap((group) => group.fixtures.map((card) => card.id)),
  ];
  return [...new Set(ids)];
}

/** `ids` in requests of at most `size`, so a full Saturday is a few calls, never one per card. */
export function batches(ids: readonly string[], size = CARD_BATCH): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// The statistical model
// ---------------------------------------------------------------------------

export type CardForecast =
  /** The latest version computed before kick-off, as percentages totalling 100.0. */
  | {
      state: 'available';
      home: number;
      draw: number;
      away: number;
      version: number;
      model_version: string;
      computed_at: string;
    }
  /**
   * The model answered, and the answer was that it could not: its reason, which
   * the card puts in the reader's words (`null`: none was given).
   */
  | {
      state: 'unavailable';
      reason: ForecastUnavailableReason | null;
      version: number;
      computed_at: string;
    }
  /** No version was computed before kick-off. */
  | { state: 'none' }
  /** The forecast service did not answer this page's question. */
  | { state: 'unreachable' };

export function cardForecast(summary: ForecastSummary | null): CardForecast {
  if (summary === null) return { state: 'none' };
  if (summary.status === 'unavailable' || summary.probabilities === null) {
    return {
      state: 'unavailable',
      reason: summary.unavailable_reason,
      version: summary.version_number,
      computed_at: summary.computed_at,
    };
  }
  const pct = percentages(summary.probabilities);
  return {
    state: 'available',
    home: pct.home,
    draw: pct.draw,
    away: pct.away,
    version: summary.version_number,
    model_version: summary.model_version,
    computed_at: summary.computed_at,
  };
}

// ---------------------------------------------------------------------------
// The community
// ---------------------------------------------------------------------------

export type CardCommunity =
  /** How many members' standing predictions picked each outcome (D-052's floor met). */
  | { state: 'available'; sample: number; home: number; draw: number; away: number }
  /** Fewer than `MIN_CONSENSUS_SAMPLE` members: nothing is published (D-052). */
  | { state: 'below_floor' }
  /** The consensus service did not answer this page's question. */
  | { state: 'unreachable' };

export function cardCommunity(consensus: CommunityConsensusResponse | undefined): CardCommunity {
  // A fixture the list left out has no consensus to publish, which is the floor's sentence.
  if (consensus === undefined || consensus.data === null) return { state: 'below_floor' };
  const { counts } = consensus.data.crowd;
  return {
    state: 'available',
    sample: consensus.data.sample,
    home: counts.home,
    draw: counts.draw,
    away: counts.away,
  };
}

// ---------------------------------------------------------------------------
// Where to watch, in the viewer's territory
// ---------------------------------------------------------------------------

export type CardViewing =
  /** No territory chosen: the card asks, and infers nothing (T-312). */
  | { state: 'ask' }
  | { state: 'listed'; territory: string; count: number }
  /** A source covers the territory and listed nothing: the one case "nothing listed" is a fact. */
  | { state: 'nothing_listed'; territory: string }
  /** No source has said anything about this match in the territory. */
  | { state: 'not_supplied'; territory: string }
  | { state: 'unreachable' };

export function cardViewing(viewing: MatchViewing | undefined): CardViewing {
  if (viewing === undefined) return { state: 'unreachable' };
  if (viewing.territory.state === 'not_chosen') return { state: 'ask' };
  const territory = viewing.territory.territory.name;
  switch (optionsState(viewing)) {
    case 'ask':
      return { state: 'ask' };
    case 'not_supplied':
      return { state: 'not_supplied', territory };
    case 'nothing_listed':
      return { state: 'nothing_listed', territory };
    case 'listed':
      return { state: 'listed', territory, count: viewing.options.data?.length ?? 0 };
  }
}

/** What the page hands the list: one map per product, keyed by fixture id. */
export interface ScoreCardProducts {
  forecast: Record<string, CardForecast>;
  community: Record<string, CardCommunity>;
  viewing: Record<string, CardViewing>;
}

export const NO_PRODUCTS: ScoreCardProducts = { forecast: {}, community: {}, viewing: {} };

type Answer<T> = { ok: true; data: T } | { ok: false };

/** The three batch routes, passed in so this file never imports the server's API client. */
export interface ProductFetchers {
  forecasts: (
    ids: string[],
  ) => Promise<Answer<{ fixtures: { fixture_id: string; pre_kickoff: ForecastSummary | null }[] }>>;
  consensus: (
    ids: string[],
  ) => Promise<
    Answer<{ fixtures: { fixture_id: string; consensus: CommunityConsensusResponse }[] }>
  >;
  /** `null` when there is nobody to ask for: a guest has no stored territory. */
  viewing: ((ids: string[]) => Promise<Answer<{ fixtures: MatchViewing[] }>>) | null;
}

/**
 * Every card's three lines, from one request per product per `CARD_BATCH`
 * matches, all in parallel (the scores list stays fast: never a request per
 * card). A batch that fails marks its own matches `unreachable`, and only for
 * the product that failed.
 */
export async function loadScoreCardProducts(
  ids: readonly string[],
  fetchers: ProductFetchers,
): Promise<ScoreCardProducts> {
  const out: ScoreCardProducts = { forecast: {}, community: {}, viewing: {} };
  if (ids.length === 0) return out;
  const groups = batches(ids);
  const viewing = fetchers.viewing;
  await Promise.all(
    groups.flatMap((group) => [
      fetchers.forecasts(group).then((answer) => {
        const found = new Map(
          answer.ok ? answer.data.fixtures.map((e) => [e.fixture_id, e.pre_kickoff]) : [],
        );
        for (const id of group) {
          out.forecast[id] = !answer.ok
            ? { state: 'unreachable' }
            : cardForecast(found.get(id) ?? null);
        }
      }),
      fetchers.consensus(group).then((answer) => {
        const found = new Map(
          answer.ok ? answer.data.fixtures.map((e) => [e.fixture_id, e.consensus]) : [],
        );
        for (const id of group) {
          out.community[id] = !answer.ok ? { state: 'unreachable' } : cardCommunity(found.get(id));
        }
      }),
      viewing === null
        ? Promise.resolve().then(() => {
            for (const id of group) out.viewing[id] = { state: 'ask' };
          })
        : viewing(group).then((answer) => {
            const found = new Map(
              answer.ok ? answer.data.fixtures.map((e) => [e.fixture_id, e]) : [],
            );
            for (const id of group) {
              out.viewing[id] = !answer.ok ? { state: 'unreachable' } : cardViewing(found.get(id));
            }
          }),
    ]),
  );
  return out;
}
