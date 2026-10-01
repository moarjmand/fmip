import {
  type CommunityConsensusResponse,
  type ConsensusListEntry,
  MIN_CONSENSUS_SAMPLE,
} from '@fmip/contracts';
import Link from 'next/link';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { interpolate, message, plural, t } from '@/i18n/messages';
import { formatKickoff } from '@/lib/scores';
import { formatPercent, formatSigned } from '@/lib/words';
import { FilledMessage } from '@/components/filled-message';
import { LtrNumeric } from '@/components/score';
import { Translated } from '@/components/translated';
import { type Triple, difference, sharesToPercentages } from '@/lib/triple';
import { Notice } from '@/components/ui';

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
  locale,
}: {
  percentages: Triple;
  home: string;
  away: string;
  testId: string;
  locale: Locale;
}) {
  const labels: Record<(typeof OUTCOME_KEYS)[number], string> = {
    home,
    draw: t(locale, 'matchCentre.community.draw'),
    away,
  };
  return (
    <div className="grid grid-cols-3 gap-2 text-center" data-testid={testId}>
      {OUTCOME_KEYS.map((key) => (
        <div key={key} className="flex flex-col rounded border border-default p-2">
          <span className="text-xs text-muted">{labels[key]}</span>
          <span className="text-lg font-semibold" dir="ltr">
            {formatPercent(locale, percentages[key])}
          </span>
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
  const l: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const heading = (
    <h2 className="text-lg font-semibold">
      <Translated locale={locale} message="matchCentre.community.title" />
    </h2>
  );

  if (consensus === null) {
    return (
      <section className="flex flex-col gap-2" data-testid="consensus" data-state="unreachable">
        {heading}
        <Notice tone="danger">
          <Translated locale={locale} message="matchCentre.community.unreachable" />
        </Notice>
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
        <p className="text-sm text-muted">
          <Translated
            locale={locale}
            message="matchCentre.community.belowFloor"
            count={MIN_CONSENSUS_SAMPLE}
          />
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
      <p className="text-xs text-muted">
        <Translated locale={locale} message="matchCentre.community.intro" />
      </p>

      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">
          <Translated locale={locale} message="matchCentre.community.everyMember" />{' '}
          <span className="font-normal text-muted">
            ·{' '}
            <Translated
              locale={locale}
              message="matchCentre.community.predictions"
              count={sample}
            />
          </span>
        </h3>
        <Distribution
          percentages={crowdPercentages}
          home={home}
          away={away}
          testId="consensus-crowd"
          locale={l}
        />
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">
          <Translated locale={locale} message="matchCentre.community.weighted" />
          {weighted !== null && (
            <span className="font-normal text-muted">
              {' · '}
              <Translated
                locale={locale}
                message="matchCentre.community.raters"
                count={weighted.raters}
              />
            </span>
          )}
        </h3>
        {weightedPercentages === null ? (
          // Never the crowd distribution shown a second time under this label.
          // Blueprint 6.6 asks for two distributions because they answer
          // different questions; one answer twice is the disguise it forbids.
          <p className="text-sm text-muted" data-testid="consensus-weighted-absent">
            <Translated locale={locale} message="matchCentre.community.weightedAbsent" />
          </p>
        ) : (
          <Distribution
            percentages={weightedPercentages}
            home={home}
            away={away}
            testId="consensus-weighted"
            locale={l}
          />
        )}
      </div>

      {gap !== null && (
        <div className="flex flex-col gap-1" data-testid="consensus-vs-model">
          <h3 className="text-sm font-medium">
            <Translated locale={locale} message="matchCentre.community.againstModel" />
          </h3>
          <p className="text-sm">
            {OUTCOME_KEYS.map((key, index) => (
              <span key={key}>
                {index > 0 ? t(l, 'forecast.listSeparator') : ''}
                {key === 'draw'
                  ? t(l, 'matchCentre.community.drawLower')
                  : key === 'home'
                    ? home
                    : away}{' '}
                <LtrNumeric>{formatSigned(l, gap[key])}</LtrNumeric>
              </span>
            ))}{' '}
            <span className="text-muted">
              <Translated locale={locale} message="matchCentre.community.gapNote" />
            </span>
          </p>
        </div>
      )}

      {consensus.last_updated_at !== null && (
        <p className="text-xs text-muted" data-testid="consensus-updated">
          <FilledMessage
            message={message(l, 'matchCentre.community.lastPrediction')}
            params={{
              time: (
                <time dateTime={consensus.last_updated_at}>
                  {consensus.last_updated_at.slice(0, 10)}{' '}
                  {formatKickoff(locale, consensus.last_updated_at, timeZone)}
                </time>
              ),
            }}
          />
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
  const l: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const withConsensus = entries.filter((entry) => entry.consensus.data !== null);

  return (
    <section className="flex flex-col gap-2" data-testid="predictions-consensus">
      <h2 className="text-lg font-semibold">
        <Translated locale={locale} message="matchCentre.community.listTitle" />
      </h2>
      <p className="text-xs text-muted">
        <Translated locale={locale} message="matchCentre.community.intro" />
      </p>
      {withConsensus.length === 0 ? (
        <p className="text-sm text-muted">
          <Translated
            locale={locale}
            message="matchCentre.community.listNone"
            count={MIN_CONSENSUS_SAMPLE}
          />
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
                  {teams === undefined
                    ? t(l, 'matchCentre.title')
                    : interpolate(t(l, 'matchCentre.fixtureTitle'), teams)}
                </Link>
                <p className="text-sm">
                  {interpolate(t(l, 'matchCentre.community.listLine'), {
                    home: teams?.home ?? t(l, 'matchCentre.home'),
                    homePct: formatPercent(l, percentages.home),
                    drawPct: formatPercent(l, percentages.draw),
                    away: teams?.away ?? t(l, 'matchCentre.away'),
                    awayPct: formatPercent(l, percentages.away),
                  })}{' '}
                  <span className="text-muted">
                    · {plural(l, 'matchCentre.community.predictions', data.sample).text}
                  </span>
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
