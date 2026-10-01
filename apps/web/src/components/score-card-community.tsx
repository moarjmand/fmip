import { MIN_CONSENSUS_SAMPLE } from '@fmip/contracts';
import { formatNumber } from '@/i18n/format';
import type { CardCommunity } from '@/lib/score-card-products';
import { pickPlural } from '@/lib/words';
import type { ScoresWords } from '@/lib/words-server';
import { MessageText } from '@/components/message-text';
import { LtrNumeric } from '@/components/score';

/**
 * The community's line on a scores card (T-940, D-114): how many members'
 * standing predictions picked each outcome. Only the community: this takes a
 * `CardCommunity` and nothing else, so it cannot render the model's
 * probabilities (rule 6, `three-products.spec.ts`). Its label,
 * `scores.card.community.label`, names whose line it is, and the sample line
 * says it is not the model.
 *
 * Totals, not percentages: counts of members cannot be mistaken for a model's
 * probabilities, and the match centre carries both distributions with their
 * explanation. Below D-052's five predictors nothing is published, and the
 * line says that instead of showing a small crowd's split. The words are the
 * reader's (T-1303).
 */
export function CardCommunityTotals({
  community,
  home,
  away,
  words,
}: {
  community: CardCommunity | undefined;
  home: string;
  away: string;
  words: ScoresWords;
}) {
  const c = community ?? { state: 'not_loaded' as const };
  const { m, p, locale } = words;
  const n = (value: number) => <LtrNumeric>{formatNumber(locale, value)}</LtrNumeric>;
  return (
    <p className="flex flex-wrap gap-x-2" data-testid="card-community" data-state={c.state}>
      <MessageText message={m['scores.card.community.label']} className="font-medium" />
      {c.state === 'available' ? (
        <>
          <span>
            <bdi>{home}</bdi> {n(c.home)}
          </span>
          <span>
            <MessageText message={m['scores.card.draw']} /> {n(c.draw)}
          </span>
          <span>
            <bdi>{away}</bdi> {n(c.away)}
          </span>
          <MessageText
            className="text-muted"
            message={pickPlural(p['scores.card.community.sample'], locale, c.sample)}
          />
        </>
      ) : c.state === 'below_floor' ? (
        <MessageText
          className="text-muted"
          message={pickPlural(p['scores.card.community.belowFloor'], locale, MIN_CONSENSUS_SAMPLE)}
        />
      ) : c.state === 'unreachable' ? (
        <MessageText className="text-muted" message={m['scores.card.lineUnreachable']} />
      ) : (
        <MessageText className="text-muted" message={m['scores.card.lineNotLoaded']} />
      )}
    </p>
  );
}
