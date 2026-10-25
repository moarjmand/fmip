import { type CommunityConsensusResponse, MIN_CONSENSUS_SAMPLE } from '@fmip/contracts';
import Link from '@/components/ui/link';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { interpolate, message, t } from '@/i18n/messages';
import { formatKickoff } from '@/lib/scores';
import { formatPercent, formatSigned } from '@/lib/words';
import { FilledMessage } from '@/components/filled-message';
import { LtrNumeric, nameIsolate } from '@/components/score';
import { Translated } from '@/components/translated';
import { type Triple, difference, sharesToPercentages } from '@/lib/triple';
import { Icon, Notice } from '@/components/ui';

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
  return (
    <div data-testid={testId}>
      <SpreadBar percentages={percentages} home={home} away={away} locale={locale} />
    </div>
  );
}

/**
 * The members' spread as a bar (T-1388, D-206): the community colour only, in
 * three lightness steps, home strongest, labelled below with the share of
 * picks. Its own bar in its own file, never the model's bar handed other
 * numbers (rule 6): a spread of picks is not a probability, and the colour
 * and the words say which product it is.
 */
const SPREAD_STEPS = {
  home: 'bg-community',
  draw: 'bg-community/55',
  away: 'bg-community/25',
} as const;

function SpreadBar({
  percentages,
  home,
  away,
  locale,
}: {
  percentages: Triple;
  home: string;
  away: string;
  locale: Locale;
}) {
  const names: Record<(typeof OUTCOME_KEYS)[number], string> = {
    home,
    draw: t(locale, 'matchCentre.community.draw'),
    away,
  };
  const pct = (key: (typeof OUTCOME_KEYS)[number]) => formatPercent(locale, percentages[key]);
  return (
    <div className="flex flex-col">
      <div
        role="img"
        aria-label={interpolate(t(locale, 'pick.splitLabel'), {
          home,
          homePct: pct('home'),
          drawPct: pct('draw'),
          away,
          awayPct: pct('away'),
        })}
        className="flex h-2.5 gap-0.75"
      >
        {OUTCOME_KEYS.map((key) => (
          <span
            key={key}
            data-outcome={key}
            className={`rounded-sm ${SPREAD_STEPS[key]}`}
            style={{ flexGrow: Math.max(percentages[key], 1.5), flexBasis: 0 }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm text-muted">
        {OUTCOME_KEYS.map((key) => (
          <span key={key} className="inline-flex items-center gap-1.5" data-outcome={key}>
            <span aria-hidden="true" className={`size-2.5 rounded-xs ${SPREAD_STEPS[key]}`} />
            <bdi>{names[key]}</bdi>
            <b className="font-extrabold text-fg tabular-nums" dir="ltr">
              {pct(key)}
            </b>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The community split under "Make your pick" (T-1388, D-206): shown only once
 * the viewer has picked, so it cannot anchor the pick, with how many picks it
 * is drawn from and that it locks at kick-off. Below D-052's floor it says
 * there is no consensus yet rather than drawing one member's pick as a
 * finding (rule 3).
 */
export function CommunitySplit({
  consensus,
  home,
  away,
  locale,
}: {
  consensus: CommunityConsensusResponse | null;
  home: string;
  away: string;
  locale: string;
}) {
  const l: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const data = consensus?.data ?? null;
  return (
    <div
      className="flex flex-col gap-2 border-t-3 border-community bg-community/8 px-3 py-2.5"
      data-testid="community-split"
      data-state={consensus === null ? 'unreachable' : data === null ? 'not_supplied' : 'revealed'}
    >
      <p className="flex items-center gap-1.5 text-xs font-extrabold text-community">
        <Icon name="community" size={14} />
        <Translated locale={l} message="pick.split" />
      </p>
      {consensus === null ? (
        <p className="text-sm text-muted">
          <Translated locale={l} message="matchCentre.community.unreachable" />
        </p>
      ) : data === null ? (
        <p className="text-sm text-muted">
          <Translated
            locale={l}
            message="matchCentre.community.belowFloor"
            count={MIN_CONSENSUS_SAMPLE}
          />
        </p>
      ) : (
        <>
          <SpreadBar
            percentages={sharesToPercentages(data.crowd.shares)}
            home={home}
            away={away}
            locale={l}
          />
          <p className="text-xs text-caption">
            <Translated locale={l} message="pick.picks" count={data.sample} />
          </p>
        </>
      )}
    </div>
  );
}

/**
 * The community's lane on the homepage's "three forecasts" (T-1382, D-200):
 * how many members have picked, and nothing about what until the reader has
 * picked (or kick-off has locked every pick), then the split (D-206). Below
 * the floor there is no consensus to hide or show (D-052).
 */
export function CommunityPicksBrief({
  consensus,
  revealed,
  home,
  away,
  href,
  locale,
}: {
  consensus: CommunityConsensusResponse | null;
  /** The reader has picked, or kick-off has locked every pick. */
  revealed: boolean;
  home: string;
  away: string;
  /** Where the reader makes their pick: the match centre. */
  href: string;
  locale: string;
}) {
  const l: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  if (consensus === null || consensus.data === null || revealed) {
    return (
      <div className="flex flex-col gap-2" data-testid="community-brief" data-spread="shown">
        <CommunitySplit consensus={consensus} home={home} away={away} locale={l} />
        {!revealed && (
          <Link href={href} className="text-sm font-bold text-community underline">
            <Translated locale={l} message="pick.make" />
          </Link>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-testid="community-brief" data-spread="hidden">
      <p className="text-base font-semibold" data-testid="consensus-count">
        <Translated locale={l} message="lanes.community.picked" count={consensus.data.sample} />
      </p>
      <p className="text-sm text-muted">
        <Translated locale={l} message="lanes.community.hidden" />
      </p>
      <Link href={href} className="text-sm font-bold text-community underline">
        <Translated locale={l} message="pick.make" />
      </Link>
    </div>
  );
}

/**
 * The community's lane in "What was forecast, and what happened" (T-1384,
 * D-202): after full time every pick is locked, so the spread is open to
 * everyone; the lane says what share of members picked what happened, over
 * the spread and how many picks it is drawn from. The members' picks only:
 * a spread of picks, never a probability and never beside the model's or the
 * founder's in one figure (rule 6). Below D-052's floor there is no consensus
 * to set against the result, and the lane says so (rule 3).
 */
export function CommunityVerdict({
  consensus,
  result,
  home,
  away,
  locale,
}: {
  consensus: CommunityConsensusResponse | null;
  /** The full-time score. */
  result: { home: number; away: number };
  home: string;
  away: string;
  locale: string;
}) {
  const l: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const data = consensus?.data ?? null;
  const outcome: (typeof OUTCOME_KEYS)[number] =
    result.home > result.away ? 'home' : result.home < result.away ? 'away' : 'draw';
  return (
    <div
      className="flex flex-col gap-2"
      data-testid="community-verdict"
      data-state={consensus === null ? 'unreachable' : data === null ? 'not_supplied' : 'available'}
    >
      {consensus === null ? (
        <p className="text-sm text-muted">
          <Translated locale={l} message="matchCentre.community.unreachable" />
        </p>
      ) : data === null ? (
        <p className="text-sm text-muted">
          <Translated
            locale={l}
            message="matchCentre.community.belowFloor"
            count={MIN_CONSENSUS_SAMPLE}
          />
        </p>
      ) : (
        <>
          <p className="text-2xl leading-tight font-black" data-testid="community-verdict-share">
            {interpolate(
              t(
                l,
                outcome === 'draw'
                  ? 'matchCentre.community.verdict.draw'
                  : 'matchCentre.community.verdict.win',
              ),
              {
                share: formatPercent(l, sharesToPercentages(data.crowd.shares)[outcome]),
                team: nameIsolate(outcome === 'home' ? home : away),
              },
            )}
          </p>
          <SpreadBar
            percentages={sharesToPercentages(data.crowd.shares)}
            home={home}
            away={away}
            locale={l}
          />
          <p className="text-xs text-caption">
            <Translated locale={l} message="pick.picks" count={data.sample} />
          </p>
        </>
      )}
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
  revealed = true,
}: {
  consensus: CommunityConsensusResponse | null;
  home: string;
  away: string;
  timeZone: string;
  locale: string;
  /**
   * Whether the reader may see the spread (T-1388, D-206): on the match centre,
   * only once they have made their own pick, or once kick-off has locked every
   * pick, so the spread cannot anchor a pick still to be made. Until then the
   * panel says how many members have picked and nothing about what.
   */
  revealed?: boolean;
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

  if (!revealed) {
    return (
      <section
        className="flex flex-col gap-2"
        data-testid="consensus"
        data-state={consensus.coverage}
        data-spread="hidden"
      >
        {heading}
        <p className="text-base font-semibold" data-testid="consensus-count">
          <Translated
            locale={locale}
            message="lanes.community.picked"
            count={consensus.data.sample}
          />
        </p>
        <p className="text-sm text-muted">
          <Translated locale={locale} message="lanes.community.hidden" />{' '}
          <Translated locale={locale} message="matchCentre.community.intro" />
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
      data-spread="revealed"
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
