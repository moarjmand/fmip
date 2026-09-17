import {
  type CommunityConsensusResponse,
  type ConsensusListEntry,
  MIN_CONSENSUS_SAMPLE,
} from '@fmip/contracts';
import Link from 'next/link';
import { formatKickoff } from '@/lib/scores';
import { LtrNumeric } from '@/components/score';
import { type Triple, difference, sharesToPercentages, signed } from '@/lib/triple';

/**
 * The community forecast on the match centre (blueprint 4.2, T-135).
 *
 * The third of the three prediction products, and the last one to get a
 * surface. It renders only a community consensus: there is no `source` prop,
 * no branch for a forecast, and no way to hand it one (rule 6).
 *
 * **The comparison with the model** is the part blueprint 4.2 asks for by name
 * and the part most likely to break the rule. It is done with plain numbers —
 * `Triple` is three anonymous values, not either product's type — and it
 * renders a *difference* with both sides labelled. There is no average and
 * there must never be one: two products that disagree are information, and a
 * blended number would destroy that while inventing a figure nobody computed.
 */

const OUTCOME_KEYS = ['home', 'draw', 'away'] as const;

function Distribution({
  percentages,
  home,
  away,
  testId,
}: {
  percentages: Triple;
  home: string;
  away: string;
  testId: string;
}) {
  const labels: Record<(typeof OUTCOME_KEYS)[number], string> = {
    home,
    draw: 'Draw',
    away,
  };
  return (
    <div className="grid grid-cols-3 gap-2 text-center" data-testid={testId}>
      {OUTCOME_KEYS.map((key) => (
        <div key={key} className="flex flex-col rounded border border-current/20 p-2">
          <span className="text-xs opacity-70">{labels[key]}</span>
          <span className="text-lg font-semibold">{percentages[key].toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}

export function CommunityForecastPanel({
  consensus,
  home,
  away,
  timeZone,
  model,
  locale,
}: {
  consensus: CommunityConsensusResponse | null;
  home: string;
  away: string;
  timeZone: string;
  locale: string;
  /**
   * The model's three probabilities as shares, for the comparison blueprint 4.2
   * asks for — extracted by the page, so this component never holds a forecast.
   * `null` when the model has no answer for this match, in which case there is
   * nothing to compare and the comparison is simply absent.
   */
  model: Triple | null;
}) {
  const heading = <h2 className="text-lg font-semibold">Community forecast</h2>;

  if (consensus === null) {
    return (
      <section className="flex flex-col gap-2" data-testid="consensus" data-state="unreachable">
        {heading}
        <p className="text-sm opacity-70" role="alert">
          The prediction service is unreachable right now, so what the community thinks cannot be
          shown.
        </p>
      </section>
    );
  }

  if (consensus.data === null) {
    // Rule 3, applied to a crowd. Fewer than the floor is not a small consensus,
    // it is no consensus — and a percentage over three people would read as a
    // finding while being one vote.
    return (
      <section className="flex flex-col gap-2" data-testid="consensus" data-state="not_supplied">
        {heading}
        <p className="text-sm opacity-70">
          Fewer than {MIN_CONSENSUS_SAMPLE} members have predicted this match, so there is no
          consensus to show yet.
        </p>
      </section>
    );
  }

  const { sample, crowd, weighted } = consensus.data;
  const crowdPercentages = sharesToPercentages(crowd.shares);
  const weightedPercentages = weighted === null ? null : sharesToPercentages(weighted.shares);
  const gap = model === null ? null : difference(crowdPercentages, sharesToPercentages(model));

  return (
    <section
      className="flex flex-col gap-3"
      data-testid="consensus"
      data-state={consensus.coverage}
    >
      {heading}
      <p className="text-xs opacity-60">
        What registered members predicted. Not the statistical model, and not the founder.
      </p>

      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">
          Every member, one vote{' '}
          <span className="font-normal opacity-70">· {sample} predictions</span>
        </h3>
        <Distribution
          percentages={crowdPercentages}
          home={home}
          away={away}
          testId="consensus-crowd"
        />
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">
          Weighted by Performance Rating
          {weighted !== null && (
            <span className="font-normal opacity-70"> · {weighted.raters} rated members</span>
          )}
        </h3>
        {weightedPercentages === null ? (
          // Never the crowd distribution shown a second time under this label.
          // Blueprint 6.6 asks for two distributions because they answer
          // different questions; one answer twice is the disguise it forbids.
          <p className="text-sm opacity-70" data-testid="consensus-weighted-absent">
            None of the members who predicted this match has an established rating yet, so there is
            nothing to weight by. This is not the same as the distribution above.
          </p>
        ) : (
          <Distribution
            percentages={weightedPercentages}
            home={home}
            away={away}
            testId="consensus-weighted"
          />
        )}
      </div>

      {gap !== null && (
        <div className="flex flex-col gap-1" data-testid="consensus-vs-model">
          <h3 className="text-sm font-medium">Against the model</h3>
          <p className="text-sm">
            {OUTCOME_KEYS.map((key, index) => (
              <span key={key}>
                {index > 0 ? ', ' : ''}
                {key === 'draw' ? 'draw' : key === 'home' ? home : away}{' '}
                <LtrNumeric>{signed(gap[key])}</LtrNumeric>
              </span>
            ))}{' '}
            <span className="opacity-70">
              percentage points, community against model. These are two separate answers to the same
              question; the site does not average them.
            </span>
          </p>
        </div>
      )}

      {consensus.last_updated_at !== null && (
        <p className="text-xs opacity-60" data-testid="consensus-updated">
          Last prediction{' '}
          <time dateTime={consensus.last_updated_at}>
            {consensus.last_updated_at.slice(0, 10)}{' '}
            {formatKickoff(locale, consensus.last_updated_at, timeZone)}
          </time>
          . Members may keep predicting until kick-off.
        </p>
      )}
    </section>
  );
}

/**
 * The community consensus across several matches, for the Predictions page
 * (T-137, blueprint 2.1).
 *
 * It lives in this file rather than in a shared "product list" component, and
 * that is the point: one file per product means there is no component in the
 * codebase that renders "a prediction" and no place for a `source` prop to
 * appear (rule 6).
 *
 * Only matches that actually have a consensus are listed. A match where four
 * people have predicted is not a small consensus, it is none (D-052), and
 * padding the list with rows saying so would drown the ones that mean
 * something — while suggesting the site has more community activity than it
 * does.
 */
export function CommunityConsensusList({
  entries,
  fixtures,
  locale,
}: {
  entries: ConsensusListEntry[];
  /** Names for the fixtures, by id, so a row can say who is playing. */
  fixtures: Map<string, { home: string; away: string }>;
  locale: string;
}) {
  const withConsensus = entries.filter((entry) => entry.consensus.data !== null);

  return (
    <section className="flex flex-col gap-2" data-testid="predictions-consensus">
      <h2 className="text-lg font-semibold">Community consensus</h2>
      <p className="text-xs opacity-60">
        What registered members predicted. Not the statistical model, and not the founder.
      </p>
      {withConsensus.length === 0 ? (
        <p className="text-sm opacity-70">
          No match here has {MIN_CONSENSUS_SAMPLE} predictions yet, so there is no consensus to
          show.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {withConsensus.map((entry) => {
            const data = entry.consensus.data;
            if (data === null) return null;
            const teams = fixtures.get(entry.fixture_id);
            const percentages = sharesToPercentages(data.crowd.shares);
            return (
              <li key={entry.fixture_id} className="flex flex-col gap-1">
                <Link href={`/${locale}/match/${entry.fixture_id}`} className="text-sm underline">
                  {teams === undefined ? 'Match' : `${teams.home} v ${teams.away}`}
                </Link>
                <p className="text-sm">
                  {teams?.home ?? 'Home'} {percentages.home.toFixed(1)}%, draw{' '}
                  {percentages.draw.toFixed(1)}%, {teams?.away ?? 'Away'}{' '}
                  {percentages.away.toFixed(1)}%{' '}
                  <span className="opacity-70">· {data.sample} predictions</span>
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
