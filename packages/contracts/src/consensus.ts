/**
 * Community consensus (blueprint 6.6, T-134). The third prediction product.
 *
 * **Why this is its own file.** The statistical model, the founder's analysis
 * and the community consensus are never blended or relabelled (rule 6). The
 * first two already had a boundary each; this one was the product the guard in
 * `three-products.spec.ts` protected without it ever having been built. A
 * consensus is not "a prediction" either: `predictions.ts` is one member's own
 * submission, with a lock and a history that belongs to them, and this is what
 * a crowd thinks. Sharing a type between the two is how a component ends up
 * rendering one where a reader was promised the other.
 *
 * **What blueprint 6.6 requires, exactly.** Both distributions: "the simple
 * crowd distribution *and* a rating-weighted distribution". And: "The website
 * must not disguise community opinion as the statistical model." Nothing here
 * carries a model version, a probability from a model, or any field a forecast
 * has, and this file imports neither of the other two products.
 */

import type { Covered } from './coverage';

/**
 * The outcome vocabulary, named for this product.
 *
 * It is deliberately not imported from `predictions.ts`, `forecast.ts` or
 * `founder-analysis.ts`, each of which declares its own: the three strings are
 * the same football fact, but a shared type is the thin end of a shared shape.
 */
export type ConsensusOutcome = 'home' | 'draw' | 'away';

/** Three shares of one, in the order a reader reads them. */
export interface ConsensusShares {
  home: number;
  draw: number;
  away: number;
}

/** One member, one vote — the distribution with nothing weighting it. */
export interface CrowdDistribution {
  counts: ConsensusShares;
  /** Rounded so the three sum to exactly 1; never "99.9%" on screen. */
  shares: ConsensusShares;
}

/**
 * The same crowd, weighted by Performance Rating.
 *
 * Only **established** raters carry weight (D-052). A provisional rating is the
 * system saying it does not yet know how good a member is, and weighting by a
 * number that means "unknown" would present guesswork as judgement.
 */
export interface WeightedDistribution {
  shares: ConsensusShares;
  /** How many established raters this is built from. Never zero — see `weighted`. */
  raters: number;
}

export interface CommunityConsensus {
  fixture_id: string;
  /** Members whose standing prediction was counted. */
  sample: number;
  crowd: CrowdDistribution;
  /**
   * `null` when no established rater has predicted this fixture.
   *
   * It is never the crowd distribution under another name. Blueprint 6.6 asks
   * for two distributions because they answer different questions, and
   * returning one of them twice would be the disguise the same sentence
   * forbids.
   */
  weighted: WeightedDistribution | null;
  /** The most recent submission counted here — when the consensus last moved. */
  last_submitted_at: string;
  computed_at: string;
}

/**
 * How many members must have predicted before a consensus is published.
 *
 * Two reasons, and either alone would be enough. A distribution over three
 * members is noise presented as an opinion — "67% home" reads like a finding
 * and is one vote. And an aggregate over a very small group stops being an
 * aggregate: with one predictor it *is* that member's prediction, which they
 * may have set their history to hide (T-056).
 *
 * Below this the module is `not_supplied`. That is the accurate word: there is
 * no consensus to supply yet, and saying so is rule 3 applied to a crowd.
 */
export const MIN_CONSENSUS_SAMPLE = 5;

/** `GET /fixtures/:id/consensus`. */
export type CommunityConsensusResponse = Covered<CommunityConsensus>;

/**
 * `GET /consensus?fixtures=<id>,<id>` — the same product for several fixtures
 * at once (T-136).
 *
 * A list rather than a map so the order the caller asked in is the order it
 * gets back, and a fixture that does not exist is simply absent rather than a
 * key holding null.
 *
 * Each entry carries a full `Covered` payload of its own, because the honest
 * answer differs per fixture: one match can have a consensus while the next has
 * five predictions between them and none.
 */
export interface ConsensusListEntry {
  fixture_id: string;
  consensus: CommunityConsensusResponse;
}

export interface ConsensusListResponse {
  fixtures: ConsensusListEntry[];
}

/**
 * How many fixtures one request may ask about.
 *
 * A page shows a day of matches; anything past this is a different question
 * being asked the wrong way, and an uncapped list is one query away from
 * scanning every prediction ever made.
 */
export const MAX_CONSENSUS_FIXTURES = 50;
