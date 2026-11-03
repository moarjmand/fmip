import {
  type AccuracyPoint,
  type ConsoleModelCalibrationBand,
  type ConsoleModelEstimate,
  type ConsoleModelOutcome,
} from '@fmip/contracts';
import { CONSOLE_MODEL_CALIBRATION_MINIMUM } from '@fmip/contracts/console';

/**
 * The console's model charts (T-1729, D-355): server-rendered SVG, no client
 * code and no library, as the schematic (D-352). One hue, the model's own
 * colour (`fill-model`, `stroke-model`: the statistical model's lane, rule
 * 6), with the reference -- what a one-third guess scores, or the diagonal
 * of a perfect calibration -- as a neutral hairline carrying its own label.
 * Each chart is a single series, so it needs no legend; every value is also
 * in the table beside it, so the tooltips (`<title>`) only add. Value axes
 * run left to right, as numbers do in Persian text; labels are Persian and
 * numbers left to right. Light and dark follow the theme through the tokens.
 */

const faNumber = (value: number, digits: number) =>
  new Intl.NumberFormat('fa-IR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);

/** A score, `۰٫۹۵۴`. */
export const score = (value: number, digits = 3) => faNumber(value, digits);
/** A share as a percentage, `۵۸٫۲٪`. */
export const percent = (share: number, digits = 1) =>
  new Intl.NumberFormat('fa-IR', {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(share);
/** An estimate's interval, `[۰٫۹۳۴، ۰٫۹۷۴]`; empty without bounds. */
export const interval = (
  estimate: ConsoleModelEstimate,
  format: (v: number) => string = (v) => score(v),
) =>
  estimate.low === null || estimate.high === null
    ? ''
    : `[${format(estimate.low)}، ${format(estimate.high)}]`;

export const OUTCOME_WORDS: Record<ConsoleModelOutcome, string> = {
  home: 'برد میزبان',
  draw: 'مساوی',
  away: 'برد میهمان',
};

/** Round bounds and a step for an axis over `[low, high]`. */
function niceAxis(low: number, high: number, ticks = 4) {
  const span = Math.max(high - low, 1e-6);
  const raw = span / ticks;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? raw;
  const from = Math.floor(low / step) * step;
  const to = Math.ceil(high / step) * step;
  const values: number[] = [];
  for (let v = from; v <= to + step / 2; v += step) values.push(Number(v.toFixed(6)));
  return { from, to, values, step };
}

const digitsFor = (step: number) => Math.max(0, Math.ceil(-Math.log10(step)));

// --- Calibration -------------------------------------------------------------

const CAL = { size: 240, left: 40, right: 12, top: 12, bottom: 40 } as const;

/**
 * Said against seen for one outcome: each ten-point band with enough
 * forecasts is a dot at (mean said, share seen) with its Wilson interval;
 * the diagonal is a perfect calibration. All three panels share one scale.
 */
function CalibrationPanel({
  outcome,
  bands,
  max,
}: {
  outcome: ConsoleModelOutcome;
  bands: ConsoleModelCalibrationBand[];
  max: number;
}) {
  const plotW = CAL.size - CAL.left - CAL.right;
  const plotH = CAL.size - CAL.top - CAL.bottom;
  const x = (v: number) => CAL.left + (v / max) * plotW;
  const y = (v: number) => CAL.top + plotH - (v / max) * plotH;
  const axis = niceAxis(0, max, max > 0.6 ? 5 : 3);
  const shown = bands.filter((b) => b.forecasts >= CONSOLE_MODEL_CALIBRATION_MINIMUM);
  const titleId = `calibration-${outcome}`;
  return (
    <figure className="flex flex-col gap-2">
      <figcaption id={titleId} className="text-sm font-bold text-fg">
        {OUTCOME_WORDS[outcome]}
      </figcaption>
      <svg
        viewBox={`0 0 ${CAL.size} ${CAL.size}`}
        role="img"
        aria-labelledby={titleId}
        className="w-full"
        data-testid={`calibration-${outcome}`}
      >
        <title>{`calibration ${OUTCOME_WORDS[outcome]}: احتمالی که مدل داد در برابر آنچه رخ داد`}</title>
        {axis.values.map((v) => (
          <g key={v}>
            <line
              x1={CAL.left}
              x2={CAL.left + plotW}
              y1={y(v)}
              y2={y(v)}
              className="stroke-caption"
              strokeOpacity={0.22}
              strokeWidth={1}
            />
            <text
              x={CAL.left - 6}
              y={y(v) + 3.5}
              textAnchor="end"
              direction="ltr"
              className="fill-caption"
              fontSize={10}
            >
              {percent(v, 0)}
            </text>
            <text
              x={x(v)}
              y={CAL.top + plotH + 14}
              textAnchor="middle"
              direction="ltr"
              className="fill-caption"
              fontSize={10}
            >
              {percent(v, 0)}
            </text>
          </g>
        ))}
        <line
          x1={x(0)}
          y1={y(0)}
          x2={x(max)}
          y2={y(max)}
          className="stroke-caption"
          strokeWidth={1}
        />
        <text
          x={CAL.left + plotW / 2}
          y={CAL.size - 6}
          textAnchor="middle"
          className="fill-muted"
          fontSize={10}
        >
          احتمالی که مدل داد
        </text>
        <text
          x={CAL.left + 4}
          y={CAL.top + 10}
          textAnchor="end"
          className="fill-muted"
          fontSize={10}
        >
          آنچه رخ داد
        </text>
        {shown.map((b) => (
          <g key={b.band}>
            <title>{`${OUTCOME_WORDS[outcome]}، باند ${percent(b.band / 10, 0)} تا ${percent(
              (b.band + 1) / 10,
              0,
            )}: مدل ${percent(b.said)} گفت، ${percent(b.seen.mean)} رخ داد ${interval(b.seen, (v) =>
              percent(v),
            )} روی ${faNumber(b.forecasts, 0)} پیش‌بینی`}</title>
            {b.seen.low !== null && b.seen.high !== null && (
              <line
                x1={x(b.said)}
                x2={x(b.said)}
                y1={y(Math.min(b.seen.high, max))}
                y2={y(b.seen.low)}
                className="stroke-model"
                strokeOpacity={0.45}
                strokeWidth={2}
                strokeLinecap="round"
              />
            )}
            <circle
              cx={x(b.said)}
              cy={y(Math.min(b.seen.mean, max))}
              r={4.5}
              className="fill-model stroke-surface"
              strokeWidth={2}
            />
            <circle cx={x(b.said)} cy={y(Math.min(b.seen.mean, max))} r={12} fill="transparent" />
          </g>
        ))}
      </svg>
    </figure>
  );
}

export function CalibrationPanels({ bands }: { bands: ConsoleModelCalibrationBand[] }) {
  const shown = bands.filter((b) => b.forecasts >= CONSOLE_MODEL_CALIBRATION_MINIMUM);
  const top = Math.max(0.6, ...shown.map((b) => Math.max(b.said, b.seen.high ?? b.seen.mean)));
  const max = Math.min(1, Math.ceil(top * 10) / 10);
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {(['home', 'draw', 'away'] as const).map((outcome) => (
        <CalibrationPanel
          key={outcome}
          outcome={outcome}
          bands={bands.filter((b) => b.outcome === outcome)}
          max={max}
        />
      ))}
    </div>
  );
}

// --- The weekly trend --------------------------------------------------------

const weekName = (iso: string) =>
  new Intl.DateTimeFormat('fa-IR', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${iso}T12:00:00Z`),
  );

/**
 * The published version's log loss by ISO week: one line in the model's
 * colour, a hollow dot for a week of fewer than `minimum` matches, the
 * one-third guess as a labelled hairline. Drawn twice, wide from 768 px and
 * narrow below, so its text stays readable at both.
 */
function TrendSvg({
  points,
  reference,
  minimum,
  width,
  height,
  className,
}: {
  points: AccuracyPoint[];
  reference: number;
  minimum: number;
  width: number;
  height: number;
  className: string;
}) {
  const pad = { left: 44, right: 56, top: 16, bottom: 30 };
  const values = points.flatMap((p) => (p.log_loss === null ? [] : [p.log_loss]));
  const axis = niceAxis(Math.min(reference, ...values), Math.max(reference, ...values), 4);
  const days = points.map((p) => Date.parse(`${p.period_start}T00:00:00Z`));
  const first = days[0] ?? 0;
  const last = days.at(-1) ?? first;
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const x = (day: number) =>
    pad.left + (last === first ? plotW / 2 : ((day - first) / (last - first)) * plotW);
  const y = (v: number) => pad.top + plotH - ((v - axis.from) / (axis.to - axis.from)) * plotH;
  const drawn = points
    .map((p, i) => ({ p, at: days[i] ?? first }))
    .filter(
      (d): d is { p: AccuracyPoint & { log_loss: number }; at: number } => d.p.log_loss !== null,
    );
  const path = drawn.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(d.at)},${y(d.p.log_loss)}`).join(' ');
  const labelled = new Set([0, drawn.length - 1, Math.floor((drawn.length - 1) / 2)]);
  const end = drawn.at(-1);
  const digits = digitsFor(axis.step);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" className={className} data-testid="trend">
      <title>{`log loss هفتگی نسخه‌ی منتشرشده در برابر حدس یک‌سوم (${score(reference)})`}</title>
      {axis.values.map((v) => (
        <g key={v}>
          <line
            x1={pad.left}
            x2={pad.left + plotW}
            y1={y(v)}
            y2={y(v)}
            className="stroke-caption"
            strokeOpacity={0.22}
            strokeWidth={1}
          />
          <text
            x={pad.left - 6}
            y={y(v) + 3.5}
            textAnchor="end"
            direction="ltr"
            className="fill-caption"
            fontSize={10}
          >
            {score(v, digits)}
          </text>
        </g>
      ))}
      <line
        x1={pad.left}
        x2={pad.left + plotW}
        y1={y(reference)}
        y2={y(reference)}
        className="stroke-caption"
        strokeWidth={1}
      />
      <text
        x={pad.left + 4}
        y={y(reference) - 5}
        textAnchor="end"
        className="fill-muted"
        fontSize={10}
      >
        {`حدس یک‌سوم ${score(reference)}`}
      </text>
      <path
        d={path}
        fill="none"
        className="stroke-model"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {drawn.map((d, i) => {
        const thin = d.p.matches < minimum;
        return (
          <g key={d.p.period_start}>
            <title>{`هفته‌ی ${weekName(d.p.period_start)}: log loss ${score(d.p.log_loss)} روی ${faNumber(
              d.p.matches,
              0,
            )} مسابقه`}</title>
            <circle
              cx={x(d.at)}
              cy={y(d.p.log_loss)}
              r={4.5}
              className={thin ? 'fill-surface stroke-model' : 'fill-model stroke-surface'}
              strokeWidth={2}
            />
            <circle cx={x(d.at)} cy={y(d.p.log_loss)} r={12} fill="transparent" />
            {labelled.has(i) && (
              <text
                x={x(d.at)}
                y={height - 8}
                textAnchor="middle"
                className="fill-caption"
                fontSize={10}
              >
                {weekName(d.p.period_start)}
              </text>
            )}
          </g>
        );
      })}
      {end !== undefined && (
        <text
          x={x(end.at) + 9}
          y={y(end.p.log_loss) + 3.5}
          textAnchor="start"
          direction="ltr"
          className="fill-fg"
          fontSize={11}
          fontWeight={700}
        >
          {score(end.p.log_loss)}
        </text>
      )}
    </svg>
  );
}

export function TrendChart({
  points,
  reference,
  minimum,
}: {
  points: AccuracyPoint[];
  reference: number;
  minimum: number;
}) {
  return (
    <>
      <TrendSvg
        points={points}
        reference={reference}
        minimum={minimum}
        width={720}
        height={260}
        className="hidden w-full md:block"
      />
      <TrendSvg
        points={points}
        reference={reference}
        minimum={minimum}
        width={360}
        height={240}
        className="w-full md:hidden"
      />
    </>
  );
}

// --- Intervals in a table ----------------------------------------------------

export interface IntervalScale {
  from: number;
  to: number;
  values: number[];
  step: number;
}

/** One scale for a column of intervals and the reference beside them. */
export function intervalScale(estimates: ConsoleModelEstimate[], reference: number): IntervalScale {
  const lows = estimates.map((e) => e.low ?? e.mean);
  const highs = estimates.map((e) => e.high ?? e.mean);
  return niceAxis(Math.min(reference, ...lows), Math.max(reference, ...highs), 4);
}

const STRIP = { width: 200, height: 22, pad: 6 } as const;
const stripX = (scale: IntervalScale, v: number) =>
  STRIP.pad + ((v - scale.from) / (scale.to - scale.from)) * (STRIP.width - 2 * STRIP.pad);

/** The column's axis: its ticks and where the one-third guess is. */
export function IntervalAxis({ scale, reference }: { scale: IntervalScale; reference: number }) {
  const digits = digitsFor(scale.step);
  return (
    <svg
      viewBox={`0 0 ${STRIP.width} ${STRIP.height}`}
      className="w-full min-w-32"
      aria-hidden="true"
    >
      {scale.values.map((v) => (
        <text
          key={v}
          x={stripX(scale, v)}
          y={14}
          textAnchor="middle"
          direction="ltr"
          className="fill-caption"
          fontSize={9}
        >
          {score(v, digits)}
        </text>
      ))}
      <line
        x1={stripX(scale, reference)}
        x2={stripX(scale, reference)}
        y1={16}
        y2={STRIP.height}
        className="stroke-caption"
        strokeWidth={1}
      />
    </svg>
  );
}

/** A mean as a dot, its interval as a line, the reference as a hairline. */
export function IntervalStrip({
  estimate,
  scale,
  reference,
  label,
}: {
  estimate: ConsoleModelEstimate;
  scale: IntervalScale;
  reference: number;
  label: string;
}) {
  const mid = STRIP.height / 2;
  return (
    <svg
      viewBox={`0 0 ${STRIP.width} ${STRIP.height}`}
      className="w-full min-w-32"
      role="img"
      aria-label={label}
    >
      {scale.values.map((v) => (
        <line
          key={v}
          x1={stripX(scale, v)}
          x2={stripX(scale, v)}
          y1={2}
          y2={STRIP.height - 2}
          className="stroke-caption"
          strokeOpacity={0.22}
          strokeWidth={1}
        />
      ))}
      <line
        x1={stripX(scale, reference)}
        x2={stripX(scale, reference)}
        y1={0}
        y2={STRIP.height}
        className="stroke-caption"
        strokeWidth={1}
      />
      {estimate.low !== null && estimate.high !== null && (
        <line
          x1={stripX(scale, estimate.low)}
          x2={stripX(scale, estimate.high)}
          y1={mid}
          y2={mid}
          className="stroke-model"
          strokeOpacity={0.45}
          strokeWidth={2}
          strokeLinecap="round"
        />
      )}
      <circle
        cx={stripX(scale, estimate.mean)}
        cy={mid}
        r={4.5}
        className="fill-model stroke-surface"
        strokeWidth={2}
      />
    </svg>
  );
}

// --- A count against its threshold -------------------------------------------

/** How far a count is toward the number a verdict needs: a meter, not a verdict. */
export function CountMeter({
  count,
  needed,
  label,
}: {
  count: number;
  needed: number;
  label: string;
}) {
  const share = Math.min(1, count / needed);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="text-fg">{label}</span>
        <span className="text-muted">
          {`${faNumber(count, 0)} از ${faNumber(needed, 0)}`}
          {count >= needed ? ' — رسید' : ''}
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={needed}
        aria-valuenow={Math.min(count, needed)}
        className="h-2 overflow-hidden rounded-pill bg-model/20"
      >
        <div className="h-full rounded-pill bg-model" style={{ inlineSize: `${share * 100}%` }} />
      </div>
    </div>
  );
}
