import { MIN_CONSENSUS_SAMPLE } from '@fmip/contracts';
import type { CardCommunity } from '@/lib/score-card-products';
import { LtrNumeric } from '@/components/score';

/**
 * The community's line on a scores card (T-940, D-114): how many members'
 * standing predictions picked each outcome. Only the community: this takes a
 * `CardCommunity` and nothing else, so it cannot render the model's
 * probabilities (rule 6, `three-products.spec.ts`).
 *
 * Totals, not percentages: counts of members cannot be mistaken for a model's
 * probabilities, and the match centre carries both distributions with their
 * explanation. Below D-052's five predictors nothing is published, and the
 * line says that instead of showing a small crowd's split.
 */
export function CardCommunityTotals({
  community,
  home,
  away,
}: {
  community: CardCommunity | undefined;
  home: string;
  away: string;
}) {
  const c = community ?? { state: 'not_loaded' as const };
  return (
    <p className="flex flex-wrap gap-x-2" data-testid="card-community" data-state={c.state}>
      <span className="font-medium">Community predictions:</span>
      {c.state === 'available' ? (
        <>
          <span>
            <bdi>{home}</bdi> <LtrNumeric>{c.home}</LtrNumeric>
          </span>
          <span>
            Draw <LtrNumeric>{c.draw}</LtrNumeric>
          </span>
          <span>
            <bdi>{away}</bdi> <LtrNumeric>{c.away}</LtrNumeric>
          </span>
          <span className="text-muted">of {c.sample} members, not the model</span>
        </>
      ) : c.state === 'below_floor' ? (
        <span className="text-muted">
          not published until {MIN_CONSENSUS_SAMPLE} members have predicted this match.
        </span>
      ) : c.state === 'unreachable' ? (
        <span className="text-muted">
          could not be loaded for this page. The match centre has it.
        </span>
      ) : (
        <span className="text-muted">not loaded for this list. The match centre has it.</span>
      )}
    </p>
  );
}
