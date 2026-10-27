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
import { AtApart } from '@/components/model-version';
import { pairIsolate } from '@/components/score';
import { Translated } from '@/components/translated';
import { Notice } from '@/components/ui';
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
 * Which version: after kick-off, the one the model published before it --
 * the one its evaluation scored, else the last computed before kick-off
 * (the same choice as `ModelVerdict`); before kick-off, the latest.
 */

const STEPS = { home: 'bg-model', draw: 'bg-model/55', away: 'bg-model/25' } as const;

/** The version a card about this match is about (see above). */
export function cardVersion(
  forecasts: ForecastVersionsResponse,
  evaluations: FixtureEvaluationsResponse | null,
  status: MatchHeader['status'],
  kickoffAt: string,
): ForecastVersion | null {
  if (status === 'scheduled') return forecasts.latest;
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

export function ForecastReality({
  forecasts,
  evaluations,
  fixture,
  final,
  matchXg,
  timeZone,
  locale: raw,
}: {
  forecasts: ForecastVersionsResponse | null;
  evaluations: FixtureEvaluationsResponse | null;
  fixture: Pick<MatchHeader, 'status' | 'kickoff_at' | 'home' | 'away'>;
  /** The full-time score, once the match is over. */
  final: { home: number; away: number } | null;
  /** The match's own expected goals from the statistics, when supplied. */
  matchXg: { home: number; away: number } | null;
  timeZone: string;
  locale: string;
}) {
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const status = fixture.status;
  const title: MessageKey =
    final !== null
      ? 'matchCentre.reality.title'
      : status === 'scheduled'
        ? 'forecast.title'
        : 'matchCentre.reality.before';
  const version =
    forecasts === null ? null : cardVersion(forecasts, evaluations, status, fixture.kickoff_at);
  const p = version?.probabilities ?? null;
  // A match whose every version is a placeholder no model answered (a
  // competition the model was not trained on, say) has no forecast: the
  // sentence above says why, once, and no version list or receipt follows it
  // to repeat the reason or show the placeholder (T-1524).
  const forecastsAny =
    forecasts !== null && forecasts.versions.some((v) => v.probabilities !== null);
  return (
    <article
      className="flex min-w-0 flex-col gap-5 rounded-card border border-default bg-surface p-4 md:px-6 md:py-5"
      data-testid="forecast-reality"
      data-state={forecasts === null ? 'unreachable' : p === null ? 'none' : 'available'}
    >
      <h2 className="flex flex-wrap items-center gap-2.5 text-lg font-extrabold font-stretch-semi-expanded md:text-xl">
        <ModelTag locale={locale} />
        <Translated locale={locale} message={title} />
      </h2>
      {forecasts === null ? (
        <Notice tone="danger">
          <Translated locale={locale} message="forecast.unreachable" />
        </Notice>
      ) : version === null ? (
        <p
          dir="auto"
          className="rounded-control border border-dashed border-model px-3 py-2 text-sm text-muted"
          data-testid="forecast-reality-none"
        >
          <Translated
            locale={locale}
            message={status === 'scheduled' ? 'forecast.none' : 'forecastBar.noneBefore'}
          />
        </p>
      ) : p === null ? (
        <p
          dir="auto"
          className="rounded-control border border-dashed border-model px-3 py-2 text-sm text-muted"
          data-testid="forecast-reality-unavailable"
        >
          {version.unavailable_reason !== null ? (
            unavailableLabel(version.unavailable_reason, locale)
          ) : (
            <Translated locale={locale} message="forecast.couldNotProduce" />
          )}
        </p>
      ) : (
        <>
          <OutcomeBar
            p={p}
            outcome={final === null ? null : outcomeOf(final)}
            home={fixture.home.name}
            away={fixture.away.name}
            locale={locale}
          />
          {final !== null && (
            <p className="max-w-190 text-sm text-muted" data-testid="forecast-reality-note">
              {interpolate(t(locale, 'matchCentre.reality.note'), {
                probability: formatPercent(locale, percentages(p)[outcomeOf(final)]),
              })}{' '}
              <Link
                href={`/${locale}/model-accuracy`}
                className="font-bold text-fg underline"
                data-testid="forecast-accuracy-link"
              >
                <Translated locale={locale} message="matchCentre.reality.calibration" />
              </Link>
            </p>
          )}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(16rem,100%),1fr))] gap-4">
            <Goals version={version} final={final} matchXg={matchXg} locale={locale} />
            <Likeliest version={version} final={final} locale={locale} />
          </div>
        </>
      )}
      {forecasts !== null && forecastsAny && (
        <Versions
          versions={forecasts.versions}
          current={version?.id ?? null}
          timeZone={timeZone}
          locale={locale}
        />
      )}
      {version !== null && p !== null && (
        <p
          className="border-t border-dashed border-default pt-2.5 font-mono text-xs leading-relaxed text-model [:root:is(:lang(fa),:lang(ar))_&]:font-sans"
          data-testid="receipt"
        >
          {/* The model version's `@` set apart: no address in the HTML (T-1580). */}
          <AtApart
            text={receipt(locale, version, fixture.kickoff_at, timeZone, status === 'live')}
          />
        </p>
      )}
    </article>
  );
}

/**
 * The model's three chances as one bar (Design System `ForecastBar`), the
 * three percentages written above it; after full time the segment that
 * happened turns saffron and its label says so.
 */
function OutcomeBar({
  p,
  outcome,
  home,
  away,
  locale,
}: {
  p: ModelProbabilities;
  outcome: MatchOutcome | null;
  home: string;
  away: string;
  locale: Locale;
}) {
  const pct = percentages(p);
  const outcomes = [
    { key: 'home', name: home, value: pct.home },
    { key: 'draw', name: t(locale, 'forecast.draw'), value: pct.draw },
    { key: 'away', name: away, value: pct.away },
  ] as const;
  const label = (name: string, value: number) => `${name} ${formatPercent(locale, value)}`;
  return (
    <div className="flex flex-col gap-2" data-testid="outcome-bar">
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm font-bold tabular-nums md:text-base">
        {outcomes.map(({ key, name, value }) => (
          <span
            key={key}
            data-outcome={key}
            data-happened={key === outcome ? '' : undefined}
            className={key === outcome ? 'text-accent' : key === 'draw' ? 'text-muted' : 'text-fg'}
          >
            {key === outcome ? (
              interpolate(t(locale, 'matchCentre.reality.happened'), {
                outcome: label(name, value),
              })
            ) : (
              <bdi>{label(name, value)}</bdi>
            )}
          </span>
        ))}
      </div>
      <div aria-hidden="true" className="flex h-4.5 gap-0.5 overflow-hidden rounded-pill">
        {outcomes.map(({ key, value }) => (
          <span
            key={key}
            data-outcome={key}
            className={key === outcome ? 'bg-accent' : STEPS[key]}
            style={{ flexGrow: Math.max(value, 1.5), flexBasis: 0 }}
          />
        ))}
      </div>
    </div>
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
 * kind and time, its own three chances as it gave them, or why it gave none.
 * The version the card is about is marked; none is ever re-drawn.
 */
function Versions({
  versions,
  current,
  timeZone,
  locale,
}: {
  versions: ForecastVersion[];
  current: string | null;
  timeZone: string;
  locale: Locale;
}) {
  const ordered = [...versions].sort((a, b) => a.version_number - b.version_number);
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
                <>
                  <span
                    aria-hidden="true"
                    className="col-start-2 flex h-2 gap-0.5 overflow-hidden rounded-pill md:col-start-3"
                  >
                    {(['home', 'draw', 'away'] as const).map((key) => (
                      <span
                        key={key}
                        className={STEPS[key]}
                        style={{ flexGrow: Math.max(p[key], 1.5), flexBasis: 0 }}
                      />
                    ))}
                  </span>
                  <span className="col-start-2 font-mono text-xs md:col-start-4 md:text-end">
                    {[p.home, p.draw, p.away]
                      .map((value) => formatPercent(locale, value))
                      .join(' · ')}
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
