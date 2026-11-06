import type {
  FixtureEvaluationsResponse,
  ForecastVersion,
  ForecastVersionsResponse,
  MatchHeader,
  MatchOutcome,
  ModelProbabilities,
} from '@fmip/contracts';
import Link from '@/components/ui/link';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { formatDate, formatNumber, formatVersionStamp } from '@/i18n/format';
import { type MessageKey, interpolate, t } from '@/i18n/messages';
import { kindLabel, percentages, unavailableLabel } from '@/lib/forecast';
import { formatFixed, formatPercent } from '@/lib/words';
import { zoneWords } from '@/lib/reader-time-zone';
import { forecastBarWords } from '@/lib/words-server';
import { ForecastBar } from '@/components/forecast-bar';
import { AtApart } from '@/components/model-version';
import { nameIsolate, pairIsolate } from '@/components/score';
import { Translated } from '@/components/translated';
import { CoverageBadge, Notice } from '@/components/ui';
import { cx } from '@/components/ui/cx';

/**
 * The Summary's opening card (T-1497, D-263 point 4): what the statistical
 * model forecast, and -- after full time -- what happened. The model only
 * (rule 6): this file takes the model's versions and evaluations and nothing
 * of the founder's or the community's, which sit beside it as their own
 * voices. Every stored version is listed in order, each as it was computed
 * and never re-drawn from a later one (rule 5), and the version the card is
 * about carries its receipt: model, version, kind, computation time and what
 * it was fitted on. No version is a sentence, never an empty bar (rule 3).
 *
 * It is the one place the forecast is drawn on the page (T-1744, D-365): the
 * lower section says only why, and after full time this card carries the
 * result sentence and the match's ranked probability score.
 *
 * Which version: after kick-off, the one the model published before it --
 * the one its evaluation scored, else the last computed before kick-off;
 * before kick-off, the latest. A match
 * still scheduled long after its kick-off (`awaiting_update`, T-1708, D-343)
 * counts as after: its card is the stored forecast from before kick-off,
 * titled so, never the latest presented as a match still to come.
 */

/** The version a card about this match is about (see above). */
export function cardVersion(
  forecasts: ForecastVersionsResponse,
  evaluations: FixtureEvaluationsResponse | null,
  status: MatchHeader['status'],
  kickoffAt: string,
  awaiting = false,
): ForecastVersion | null {
  if (status === 'scheduled' && !awaiting) return forecasts.latest;
  const scored = evaluations?.evaluations.filter((e) => e.pre_kickoff).at(-1) ?? null;
  if (scored !== null) {
    const match = forecasts.versions.find((v) => v.version_number === scored.version_number);
    if (match !== undefined) return match;
  }
  const kickoff = Date.parse(kickoffAt);
  return (
    [...forecasts.versions]
      .sort((a, b) => a.version_number - b.version_number)
      .filter((v) => Date.parse(v.computed_at) <= kickoff)
      .at(-1) ?? null
  );
}

/**
 * Whether the match has a forecast at all: some stored version gave
 * probabilities. "No model forecast" is said only when none did; a later
 * version the model could not produce does not unsay an earlier one that
 * stands in the version list on the same page (rule 3).
 */
export function hasForecast(forecasts: ForecastVersionsResponse): boolean {
  return forecasts.versions.some((v) => v.probabilities !== null);
}

/** What happened, once there is a full-time score. */
export function outcomeOf(score: { home: number; away: number }): MatchOutcome {
  return score.home > score.away ? 'home' : score.home < score.away ? 'away' : 'draw';
}

/**
 * How long before kick-off a version was computed, in the receipt's words:
 * minutes under two hours, hours under three days, then days.
 */
export function leadTime(locale: Locale, computedAt: string, kickoffAt: string): string {
  const minutes = Math.floor((Date.parse(kickoffAt) - Date.parse(computedAt)) / 60_000);
  if (minutes < 0) return t(locale, 'matchCentre.receipt.after');
  const [key, n]: [MessageKey, number] =
    minutes < 120
      ? ['matchCentre.receipt.minutes', minutes]
      : minutes < 72 * 60
        ? ['matchCentre.receipt.hours', Math.floor(minutes / 60)]
        : ['matchCentre.receipt.days', Math.floor(minutes / (24 * 60))];
  return interpolate(t(locale, key), { n: formatNumber(locale, n) });
}

/** The API's `model_version` for a version no model answered (`forecast-triggers.ts`). */
const NO_MODEL_VERSION = 'none@0.0.0';

/**
 * The receipt (Design System `Receipt`): every fact the stored version
 * carries about itself, joined with " · ", times in the page's zone.
 */
export function receipt(
  locale: Locale,
  version: ForecastVersion,
  kickoffAt: string,
  timeZone: string,
  live: boolean,
): string {
  const parts = [
    // A version no model answered is stored under the API's placeholder,
    // which names no model: the receipt leaves it out (T-1554).
    ...(version.model_version === NO_MODEL_VERSION ? [] : [version.model_version]),
    `${interpolate(t(locale, 'matchCentre.receipt.version'), {
      version: formatNumber(locale, version.version_number),
      time: `${formatVersionStamp(locale, version.computed_at, timeZone)} ${zoneWords(locale, timeZone)}`,
    })}${t(locale, 'shared.listSeparator')}${leadTime(locale, version.computed_at, kickoffAt)}`,
    kindLabel(version.kind, locale),
  ];
  const inputs = version.inputs;
  if (inputs !== null) {
    const fitted = interpolate(t(locale, 'matchCentre.receipt.fitted'), {
      date: formatDate(locale, `${inputs.fit_date.slice(0, 10)}T12:00:00Z`, 'UTC', {
        day: 'numeric',
        month: 'short',
      }),
      matches: formatNumber(locale, inputs.matches_used),
    });
    parts.push(
      inputs.history_from === null
        ? fitted
        : `${fitted} ${interpolate(t(locale, 'matchCentre.receipt.since'), {
            month: formatDate(locale, `${inputs.history_from.slice(0, 10)}T12:00:00Z`, 'UTC', {
              month: 'short',
              year: 'numeric',
            }),
          })}`,
      t(locale, inputs.elo_used ? 'matchCentre.receipt.eloOn' : 'matchCentre.receipt.eloOff'),
      t(
        locale,
        inputs.data_completeness === 'available'
          ? 'matchCentre.receipt.complete'
          : 'matchCentre.receipt.limited',
      ),
    );
  }
  if (live) parts.push(t(locale, 'matchCentre.receipt.fixed'));
  return parts.join(' · ');
}

/**
 * The receipt's first facts on one line, for the headline before kick-off
 * (T-1744): the model, the version and when it was computed. The full
 * receipt stands with the model's details.
 */
export function receiptShort(locale: Locale, version: ForecastVersion, timeZone: string): string {
  return [
    ...(version.model_version === NO_MODEL_VERSION ? [] : [version.model_version]),
    interpolate(t(locale, 'matchCentre.receipt.version'), {
      version: formatNumber(locale, version.version_number),
      time: `${formatVersionStamp(locale, version.computed_at, timeZone)} ${zoneWords(locale, timeZone)}`,
    }),
  ].join(' · ');
}

/** The model and the version alone: the headline's receipt on a phone. */
export function receiptBrief(locale: Locale, version: ForecastVersion): string {
  return [
    ...(version.model_version === NO_MODEL_VERSION ? [] : [version.model_version]),
    interpolate(t(locale, 'matchCentre.reality.version'), {
      version: formatNumber(locale, version.version_number),
    }),
  ].join(' · ');
}

/**
 * The MODEL tag (Design System `model-tag`): the model's colour and nothing
 * else's. An outline rather than the Design System's tint: on Day the
 * turquoise text has little room on white (4.62:1) and falls under 4.5:1 on
 * its own tint, as the lanes found (D-263).
 */
export function ModelTag({ locale }: { locale: string }) {
  return (
    <span className="rounded-xs border border-model px-2 py-0.5 font-mono text-xs font-semibold text-model uppercase">
      <Translated locale={locale} message="matchCentre.modelTag" />
    </span>
  );
}

const CARD_FRAME =
  'flex min-w-0 flex-col gap-5 rounded-card border border-default bg-surface p-4 md:px-6 md:py-5';
const CARD_TITLE =
  'flex flex-wrap items-center gap-2.5 text-lg font-extrabold font-stretch-semi-expanded md:text-xl';

interface RealityProps {
  forecasts: ForecastVersionsResponse | null;
  evaluations: FixtureEvaluationsResponse | null;
  fixture: Pick<MatchHeader, 'status' | 'kickoff_at' | 'home' | 'away'> &
    Partial<Pick<MatchHeader, 'freshness'>>;
  /** The full-time score, once the match is over. */
  final: { home: number; away: number } | null;
  /** The match's own expected goals from the statistics, when supplied. */
  matchXg: { home: number; away: number } | null;
  timeZone: string;
  locale: string;
}

/** What the card says when the model has no forecast for the match. */
interface NoForecastProps {
  /**
   * The match has no Power Index either, as the page's own answer says
   * (T-1746): the card then says so, and the page draws no Power Index block
   * to say it a second time. Left out when there is one or it is not known.
   */
  noPowerIndex?: boolean;
}

/**
 * Whether the match is still to come, as this card reads it: scheduled and
 * not long past its kick-off with no word from the feed (T-1708, D-343).
 */
export function isUpcoming(fixture: RealityProps['fixture']): boolean {
  return fixture.status === 'scheduled' && fixture.freshness !== 'awaiting_update';
}

/**
 * The model's forecast, once on the page (T-1744, D-365).
 *
 * Before kick-off it is the headline alone -- the title, the bar with its
 * three percentages and one receipt line -- so that the reader's pick can
 * stand directly under it (decision 4 of package 2); `ForecastDetails`, after
 * the pick, holds the rest. From kick-off on it is the whole card: the bar,
 * after full time the result sentence, expected goals and likeliest scores,
 * every version and the receipt, and the way to why.
 *
 * With no forecast -- no version at all, or none that gave probabilities --
 * the card is the one place the page says so (T-1746, D-367; board P2-5):
 * "No model forecast for this match", the stored reason, that there is no
 * Power Index either when that is so, and one link to where the model's
 * coverage can be read. Never an empty bar (rule 3). When the card's own
 * version gave none but another did, the match has a forecast: the card
 * keeps its title and says only why this version has no numbers.
 */
export function ForecastReality({
  forecasts,
  evaluations,
  fixture,
  final,
  matchXg,
  timeZone,
  locale: raw,
  noPowerIndex = false,
}: RealityProps & NoForecastProps) {
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const status = fixture.status;
  const upcoming = isUpcoming(fixture);
  const title: MessageKey =
    final !== null
      ? 'matchCentre.reality.title'
      : upcoming
        ? 'forecast.title'
        : 'matchCentre.reality.before';
  const version =
    forecasts === null
      ? null
      : cardVersion(forecasts, evaluations, status, fixture.kickoff_at, !upcoming);
  const p = version?.probabilities ?? null;
  // No forecast, as against a forecast service that did not answer, and as
  // against one version without numbers among others that have them.
  const none = forecasts !== null && p === null && !hasForecast(forecasts);
  return (
    <article
      className={CARD_FRAME}
      data-testid="forecast-reality"
      data-state={
        forecasts === null
          ? 'unreachable'
          : none
            ? 'none'
            : p === null
              ? 'unavailable'
              : 'available'
      }
      data-part={upcoming ? 'headline' : 'whole'}
    >
      <h2 className={CARD_TITLE}>
        <ModelTag locale={locale} />
        <Translated locale={locale} message={none ? 'matchCentre.noForecast.title' : title} />
        {none && (
          // The state as an icon and a word, as every module says its own.
          <CoverageBadge
            state="not_supplied"
            label={<Translated locale={locale} message="forecastBar.noForecast" />}
          />
        )}
      </h2>
      {forecasts === null ? (
        <Notice tone="danger">
          <Translated locale={locale} message="forecast.unreachable" />
        </Notice>
      ) : version === null || p === null ? (
        <>
          <p
            dir="auto"
            className="-mt-2 max-w-190 text-sm text-muted"
            data-testid={
              version === null ? 'forecast-reality-none' : 'forecast-reality-unavailable'
            }
          >
            {version === null ? (
              <Translated
                locale={locale}
                message={upcoming ? 'forecast.none' : 'forecastBar.noneBefore'}
              />
            ) : version.unavailable_reason !== null ? (
              unavailableLabel(version.unavailable_reason, locale)
            ) : (
              <Translated locale={locale} message="forecast.couldNotProduce" />
            )}
            {none && noPowerIndex && (
              <span data-testid="forecast-reality-no-power">
                {' '}
                <Translated locale={locale} message="matchCentre.noForecast.power" />
              </span>
            )}
          </p>
          {none && (
            <p className="-mt-2 text-sm">
              {/* A stopgap the maintainer accepted: there is no page about the
                model's coverage, and the record lists every competition it has. */}
              <Link
                href={`/${locale}/model-accuracy`}
                className="inline-flex min-h-touch items-center font-bold text-fg underline md:min-h-0"
                data-testid="forecast-coverage-link"
              >
                <Translated locale={locale} message="matchCentre.noForecast.link" />
              </Link>
            </p>
          )}
        </>
      ) : (
        <>
          {!upcoming && (
            // From kick-off on the card is the forecast as it stood then.
            <p className="-mt-2 text-sm text-muted" data-testid="forecast-reality-frozen">
              <Translated locale={locale} message="forecast.verdict.frozen" />
            </p>
          )}
          {/* The one bar at headline size (T-1748, D-368); after full time
              the outcome that happened is outlined, ticked and named in
              words (T-1749, D-369). The receipt is the card's own. */}
          <ForecastBar
            forecast={percentages(p)}
            receipt={false}
            size="headline"
            outcome={final === null ? null : outcomeOf(final)}
            home={fixture.home.name}
            away={fixture.away.name}
            locale={locale}
            words={forecastBarWords(locale)}
            testId="outcome-bar"
          />
          {final !== null && (
            <Result
              version={version}
              p={p}
              final={final}
              evaluations={evaluations}
              home={fixture.home.name}
              away={fixture.away.name}
              locale={locale}
            />
          )}
          {upcoming ? (
            <p
              // On a phone the receipt stands closer to its bar: the 8px pay
              // for the names' second line, so the headline is never taller
              // than it was with one line of labels (T-1748).
              className="font-mono text-xs leading-relaxed text-model max-md:-mt-2 [:root:is(:lang(fa),:lang(ar))_&]:font-sans"
              data-testid="receipt-short"
            >
              {/* A phone has room for the model and the version on one line;
                  when it was computed stands in the full receipt, with the
                  details under the pick (board P2-4). */}
              <span className="md:hidden" data-testid="receipt-brief">
                <AtApart text={receiptBrief(locale, version)} />
              </span>
              <span className="max-md:hidden">
                <AtApart text={receiptShort(locale, version, timeZone)} />
              </span>
            </p>
          ) : (
            <Tiles version={version} final={final} matchXg={matchXg} locale={locale} />
          )}
        </>
      )}
      {!upcoming && (
        <Record
          forecasts={forecasts}
          version={version}
          fixture={fixture}
          outcome={final === null ? null : outcomeOf(final)}
          timeZone={timeZone}
          locale={locale}
        />
      )}
    </article>
  );
}

/**
 * The model's details before kick-off (T-1744, decision 4): expected goals,
 * the likeliest scores, every stored version and the receipt, in a card of
 * the model's own after the reader's pick. Nothing is left out of the page;
 * only the order changed. Not rendered from kick-off on (the card above is
 * then whole), nor when no version ever gave probabilities: the headline has
 * said why, once.
 */
export function ForecastDetails({
  forecasts,
  evaluations,
  fixture,
  matchXg,
  timeZone,
  locale: raw,
}: Omit<RealityProps, 'final'>) {
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  if (forecasts === null || !isUpcoming(fixture)) return null;
  if (!forecasts.versions.some((v) => v.probabilities !== null)) return null;
  const version = cardVersion(forecasts, evaluations, fixture.status, fixture.kickoff_at);
  return (
    <article className={CARD_FRAME} data-testid="forecast-details">
      <h2 className={CARD_TITLE}>
        <ModelTag locale={locale} />
        <Translated locale={locale} message="matchCentre.reality.details" />
      </h2>
      {version !== null && version.probabilities !== null && (
        <Tiles version={version} final={null} matchXg={matchXg} locale={locale} />
      )}
      <Record
        forecasts={forecasts}
        version={version}
        fixture={fixture}
        timeZone={timeZone}
        locale={locale}
      />
    </article>
  );
}

/** Expected goals and the likeliest scores, side by side where there is room. */
function Tiles({
  version,
  final,
  matchXg,
  locale,
}: {
  version: ForecastVersion;
  final: { home: number; away: number } | null;
  matchXg: { home: number; away: number } | null;
  locale: Locale;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(16rem,100%),1fr))] gap-4">
      <Goals version={version} final={final} matchXg={matchXg} locale={locale} />
      <Likeliest version={version} final={final} locale={locale} />
    </div>
  );
}

/**
 * The stored record under the forecast: every version in order, the receipt
 * of the version the card is about, and the one link to why (the section
 * `#forecast`). A match whose every version is a placeholder no model
 * answered (a competition the model was not trained on, say) has no forecast:
 * the sentence above says why, once, and no version list or receipt follows
 * it to repeat the reason or show the placeholder (T-1524).
 */
function Record({
  forecasts,
  version,
  fixture,
  outcome = null,
  timeZone,
  locale,
}: {
  forecasts: ForecastVersionsResponse | null;
  version: ForecastVersion | null;
  fixture: RealityProps['fixture'];
  /** What happened, once there is a full-time score. */
  outcome?: MatchOutcome | null;
  timeZone: string;
  locale: Locale;
}) {
  if (forecasts === null) return null;
  const any = forecasts.versions.some((v) => v.probabilities !== null);
  const explained = version !== null && version.probabilities !== null;
  return (
    <>
      {any && (
        <Versions
          versions={forecasts.versions}
          current={version?.id ?? null}
          outcome={outcome}
          home={fixture.home.name}
          away={fixture.away.name}
          timeZone={timeZone}
          locale={locale}
        />
      )}
      {explained && (
        <p
          className="border-t border-dashed border-default pt-2.5 font-mono text-xs leading-relaxed text-model [:root:is(:lang(fa),:lang(ar))_&]:font-sans"
          data-testid="receipt"
        >
          {/* The model version's `@` set apart: no address in the HTML (T-1580). */}
          <AtApart
            text={receipt(locale, version, fixture.kickoff_at, timeZone, fixture.status === 'live')}
          />
        </p>
      )}
      {explained && (
        <p className="text-sm">
          <a
            href="#forecast"
            className="inline-flex min-h-touch items-center font-bold text-fg underline md:min-h-0"
            data-testid="forecast-why-link"
          >
            <Translated locale={locale} message="matchCentre.reality.why" />
          </a>
        </p>
      )}
    </>
  );
}

/**
 * After full time, what happened against what the model gave it (T-1744; the
 * sentence the removed three-lane card carried): the result, the share the
 * card's version gave that outcome, and the ranked probability score of this
 * one match -- only from the stored evaluation of that same version. Not
 * scored yet is said; a score of another version is never shown as this
 * one's (rule 3).
 */
function Result({
  version,
  p,
  final,
  evaluations,
  home,
  away,
  locale,
}: {
  version: ForecastVersion;
  p: ModelProbabilities;
  final: { home: number; away: number };
  evaluations: FixtureEvaluationsResponse | null;
  home: string;
  away: string;
  locale: Locale;
}) {
  const outcome = outcomeOf(final);
  const scored = evaluations?.evaluations.filter((e) => e.pre_kickoff).at(-1) ?? null;
  const rps =
    scored !== null && scored.version_number === version.version_number ? scored.rps : null;
  return (
    <p
      className="max-w-190 text-sm text-muted"
      data-testid="forecast-reality-result"
      data-scored={rps !== null}
    >
      <span className="font-semibold text-fg">
        {interpolate(t(locale, 'forecast.verdict.result'), {
          outcome:
            outcome === 'draw'
              ? t(locale, 'forecast.aDraw')
              : interpolate(t(locale, 'predictions.outcome.teamWin'), {
                  team: nameIsolate(outcome === 'home' ? home : away),
                }),
          probability: formatPercent(locale, percentages(p)[outcome]),
        })}
      </span>{' '}
      {rps !== null ? (
        <span data-testid="forecast-reality-rps">
          {interpolate(t(locale, 'matchCentre.reality.rps'), { rps: formatFixed(locale, rps, 3) })}
        </span>
      ) : (
        <Translated locale={locale} message="forecast.verdict.unscored" />
      )}{' '}
      <Link
        href={`/${locale}/model-accuracy`}
        className="font-bold text-fg underline"
        data-testid="forecast-accuracy-link"
      >
        <Translated locale={locale} message="forecast.verdict.accuracy" />
      </Link>
    </p>
  );
}

const TILE = 'flex flex-col gap-2.5 rounded-tile bg-surface-raised p-4';
const KICKER = 'text-xs font-extrabold tracking-wider text-muted uppercase';
const FIGURE = 'text-lg leading-none font-extrabold font-stretch-condensed tabular-nums';

/** Goals expected and scored: the model's, the match's own xG, and the goals. */
function Goals({
  version,
  final,
  matchXg,
  locale,
}: {
  version: ForecastVersion;
  final: { home: number; away: number } | null;
  matchXg: { home: number; away: number } | null;
  locale: Locale;
}) {
  const pair = (home: string, away: string) => pairIsolate(locale, `${home} – ${away}`);
  const xg = version.expected_goals;
  const rows: [MessageKey, string | null, string][] = [
    [
      'matchCentre.reality.modelXg',
      xg === null ? null : pair(formatFixed(locale, xg.home, 2), formatFixed(locale, xg.away, 2)),
      'text-model',
    ],
  ];
  if (final !== null) {
    rows.push(
      [
        'matchCentre.reality.matchXg',
        matchXg === null
          ? null
          : pair(formatFixed(locale, matchXg.home, 2), formatFixed(locale, matchXg.away, 2)),
        'text-fg',
      ],
      [
        'matchCentre.reality.goalsScored',
        pair(formatNumber(locale, final.home), formatNumber(locale, final.away)),
        'text-accent',
      ],
    );
  }
  return (
    <div className={TILE} data-testid="reality-goals">
      <h3 className={KICKER}>
        <Translated locale={locale} message="matchCentre.reality.goals" />
      </h3>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-2 text-sm">
        {rows.map(([key, value, tone]) => (
          <div key={key} className="contents">
            <dt className="text-muted">
              <Translated locale={locale} message={key} />
            </dt>
            <dd className={cx(FIGURE, value === null ? 'text-sm font-medium text-caption' : tone)}>
              {value ?? <Translated locale={locale} message="status.coverage.notSupplied" />}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The five likeliest scorelines of that version, and whether the result was one. */
function Likeliest({
  version,
  final,
  locale,
}: {
  version: ForecastVersion;
  final: { home: number; away: number } | null;
  locale: Locale;
}) {
  const lines = (version.most_likely_scorelines ?? []).slice(0, 5);
  if (lines.length === 0) return null;
  const score = (home: number, away: number) =>
    pairIsolate(locale, `${formatNumber(locale, home)}–${formatNumber(locale, away)}`);
  const hit =
    final !== null && lines.some((line) => line.home === final.home && line.away === final.away);
  return (
    <div className={TILE} data-testid="reality-scorelines">
      <h3 className={KICKER}>
        <Translated locale={locale} message="matchCentre.reality.likeliest" />
      </h3>
      <ul className="flex flex-wrap gap-1.5 text-sm font-bold tabular-nums">
        {lines.map((line) => (
          <li
            key={`${line.home}-${line.away}`}
            className={cx(
              'rounded-xs border px-2 py-1',
              final !== null && line.home === final.home && line.away === final.away
                ? 'border-accent'
                : 'border-default',
            )}
          >
            {score(line.home, line.away)}{' '}
            <span className="font-medium text-caption">
              {formatPercent(locale, line.probability * 100)}
            </span>
          </li>
        ))}
      </ul>
      {final !== null && (
        <p className="text-sm text-caption" data-testid="reality-scoreline-hit" data-hit={hit}>
          {interpolate(
            t(locale, hit ? 'matchCentre.reality.among' : 'matchCentre.reality.notAmong'),
            { score: score(final.home, final.away) },
          )}
        </p>
      )}
    </div>
  );
}

/**
 * Every stored version in the order it was computed (rule 5): its number,
 * kind and time, its own three chances as it gave them -- the one bar with a
 * label on each segment -- or why it gave none. The version the card is
 * about is marked; none is ever re-drawn. After full time the outcome that
 * happened is marked on every version's bar (T-1749).
 */
function Versions({
  versions,
  current,
  outcome,
  home,
  away,
  timeZone,
  locale,
}: {
  versions: ForecastVersion[];
  current: string | null;
  /** What happened, once the match is over: marked on every version. */
  outcome: MatchOutcome | null;
  home: string;
  away: string;
  timeZone: string;
  locale: Locale;
}) {
  const ordered = [...versions].sort((a, b) => a.version_number - b.version_number);
  const words = forecastBarWords(locale);
  return (
    <div className="flex flex-col gap-2.5" data-testid="forecast-versions-list">
      <h3 className={KICKER}>
        <Translated locale={locale} message="matchCentre.reality.versions" />
      </h3>
      <ol className="flex flex-col gap-2.5 text-sm tabular-nums">
        {ordered.map((v) => {
          const p = v.probabilities === null ? null : percentages(v.probabilities);
          const mine = v.id === current;
          return (
            <li
              key={v.id}
              className="grid grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-x-3.5 gap-y-1 md:grid-cols-[2.25rem_14rem_minmax(0,1fr)_7rem]"
              data-version={v.version_number}
              data-current={mine ? '' : undefined}
            >
              <span className={cx('font-mono', mine ? 'text-model' : 'text-caption')}>
                {interpolate(t(locale, 'matchCentre.reality.version'), {
                  version: formatNumber(locale, v.version_number),
                })}
              </span>
              <span className={mine ? 'font-bold text-fg' : 'text-muted'}>
                {kindLabel(v.kind, locale)} ·{' '}
                <time dateTime={v.computed_at}>
                  {formatVersionStamp(locale, v.computed_at, timeZone)}
                </time>
              </span>
              {p === null ? (
                <span className="col-start-2 text-caption md:col-span-2 md:col-start-3">
                  {v.unavailable_reason !== null
                    ? unavailableLabel(v.unavailable_reason, locale)
                    : t(locale, 'forecast.unavailable')}
                </span>
              ) : (
                // The one bar at row size with its labels: each figure over
                // its own segment and the side's name where it fits, so the
                // order no longer has to be known (T-1748); what happened is
                // marked on every version (T-1749).
                <ForecastBar
                  forecast={p}
                  receipt={false}
                  size="row"
                  labels="named"
                  outcome={outcome}
                  home={home}
                  away={away}
                  locale={locale}
                  words={words}
                  className="col-start-2 md:col-span-2 md:col-start-3"
                  testId="version-bar"
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
