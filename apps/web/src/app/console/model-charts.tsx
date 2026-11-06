import {
  type AccuracyPoint,
  type ConsoleModelCalibrationBand,
  type ConsoleModelEstimate,
  type ConsoleModelOutcome,
} from '@fmip/contracts';
import { CONSOLE_MODEL_CALIBRATION_MINIMUM } from '@fmip/contracts/console';

/**
 * The console's model charts (T-1729, D-355; every version, T-1752, D-371): server-rendered SVG, no client
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
  id,
  minimum,
}: {
  outcome: ConsoleModelOutcome;
  bands: ConsoleModelCalibrationBand[];
  max: number;
  /** Unique on the page: one set of panels per version. */
  id: string;
  /** A band under this many matches is a hollow dot. */
  minimum: number;
}) {
  const plotW = CAL.size - CAL.left - CAL.right;
  const plotH = CAL.size - CAL.top - CAL.bottom;
  const x = (v: number) => CAL.left + (v / max) * plotW;
  const y = (v: number) => CAL.top + plotH - (v / max) * plotH;
  const axis = niceAxis(0, max, max > 0.6 ? 5 : 3);
  const shown = bands.filter((b) => b.forecasts >= CONSOLE_MODEL_CALIBRATION_MINIMUM);
  const titleId = `calibration-${id}-${outcome}`;
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
        data-testid="calibration-draw"
        data-version={id}
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
              className={
                b.forecasts < minimum ? 'fill-surface stroke-model' : 'fill-model stroke-surface'
              }
              strokeWidth={2}
            />
            <circle cx={x(b.said)} cy={y(Math.min(b.seen.mean, max))} r={12} fill="transparent" />
          </g>
        ))}
      </svg>
    </figure>
  );
}

/** The scale's top for a set of bands: the largest said or upper bound drawn, at least 60%. */
export function calibrationMax(bands: ConsoleModelCalibrationBand[]): number {
  const shown = bands.filter((b) => b.forecasts >= CONSOLE_MODEL_CALIBRATION_MINIMUM);
  const top = Math.max(0.6, ...shown.map((b) => Math.max(b.said, b.seen.high ?? b.seen.mean)));
  return Math.min(1, Math.ceil(top * 10) / 10);
}

export function CalibrationPanels({
  bands,
  id = 'published',
  max,
  minimum = 30,
}: {
  bands: ConsoleModelCalibrationBand[];
  id?: string;
  /** One scale for every version on the page; this set's own when not given. */
  max?: number;
  minimum?: number;
}) {
  const top = max ?? calibrationMax(bands);
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {(['home', 'draw', 'away'] as const).map((outcome) => (
        <CalibrationPanel
          key={outcome}
          outcome={outcome}
          bands={bands.filter((b) => b.outcome === outcome)}
          max={top}
          id={id}
          minimum={minimum}
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
      data-testid="interval-strip"
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

// --- A headline figure against the one-third guess (T-1752) --------------------

const TILE = { width: 210, height: 54, left: 10, right: 200 } as const;

/**
 * One figure, its 95% interval and the one-third guess on the figure's own
 * scale, with the side of the guess that is better tinted: left for a score
 * (lower is better), right for a share. Four figures with two directions
 * then read the same way, without turning an axis round. The numbers are in
 * the tile's text; this adds where they stand.
 */
export function TileStrip({
  estimate,
  guess,
  better,
  label,
}: {
  estimate: ConsoleModelEstimate;
  guess: number;
  better: 'lower' | 'higher';
  label: string;
}) {
  const low = Math.min(estimate.low ?? estimate.mean, guess);
  const high = Math.max(estimate.high ?? estimate.mean, guess);
  const pad = Math.max((high - low) * 0.12, 1e-6);
  const from = low - pad;
  const to = high + pad;
  const x = (v: number) => TILE.left + ((v - from) / (to - from)) * (TILE.right - TILE.left);
  const gx = x(guess);
  const start = better === 'lower' ? TILE.left : gx;
  const end = better === 'lower' ? gx : TILE.right;
  // The guess's label sits on the side away from the nearer edge.
  const labelAtStart = gx > (TILE.left + TILE.right) / 2;
  return (
    <svg
      viewBox={`0 0 ${TILE.width} ${TILE.height}`}
      role="img"
      aria-label={label}
      className="w-full max-w-64"
      data-testid="tile-strip"
    >
      <rect
        x={start}
        y={14}
        width={Math.max(0, end - start)}
        height={30}
        className="fill-model"
        opacity={0.09}
      />
      <text
        x={better === 'lower' ? TILE.left + 2 : TILE.right - 2}
        y={52}
        textAnchor={better === 'lower' ? 'end' : 'start'}
        direction="rtl"
        className="fill-caption"
        fontSize={10}
      >
        بهتر از حدس
      </text>
      <line x1={gx} x2={gx} y1={14} y2={46} className="stroke-caption" strokeWidth={1} />
      <text
        x={labelAtStart ? gx - 4 : gx + 4}
        y={10}
        textAnchor={labelAtStart ? 'start' : 'end'}
        direction="rtl"
        className="fill-muted"
        fontSize={10.5}
      >
        حدس یک‌سوم
      </text>
      {estimate.low !== null && estimate.high !== null && (
        <g className="stroke-model" strokeWidth={2} strokeLinecap="round">
          <line x1={x(estimate.low)} x2={x(estimate.high)} y1={30} y2={30} />
          <line x1={x(estimate.low)} x2={x(estimate.low)} y1={25} y2={35} />
          <line x1={x(estimate.high)} x2={x(estimate.high)} y1={25} y2={35} />
        </g>
      )}
      <circle
        cx={x(estimate.mean)}
        cy={30}
        r={5}
        className="fill-model stroke-surface"
        strokeWidth={2}
      />
    </svg>
  );
}

// --- A difference around zero (T-1752) -------------------------------------------

/** A signed score, `−۰٫۰۰۳۲` / `+۰٫۰۰۳۳`, the sign kept at the start in a right-to-left line. */
export const signed = (value: number, digits = 4) =>
  `‎${value > 0 ? '+' : value < 0 ? '−' : ''}${faNumber(Math.abs(value), digits)}`;

/**
 * A paired difference on a symmetric scale shared by every strip of its
 * kind on the page, so a wider interval is visibly less certain across
 * cards: the mean as a dot, the 95% interval as a line (an arrowhead where
 * it runs past the scale), zero as the ink hairline. Left is better.
 */
export function DifferenceStrip({
  estimate,
  half,
  width,
  betterWords,
  worseWords,
  label,
  mark = 'circle',
  hollow = false,
  ticks = true,
}: {
  estimate: ConsoleModelEstimate;
  /** The scale runs from `-half` to `+half`. */
  half: number;
  width: number;
  betterWords?: string;
  worseWords?: string;
  label: string;
  mark?: 'circle' | 'diamond' | 'square';
  /** No interval was recorded: the point alone, drawn hollow. */
  hollow?: boolean;
  ticks?: boolean;
}) {
  const pad = 16;
  const top = betterWords === undefined ? 4 : 18;
  const height = top + 26 + (ticks ? 16 : 2);
  const x = (v: number) =>
    pad + ((Math.max(-half, Math.min(half, v)) + half) / (2 * half)) * (width - 2 * pad);
  const y = top + 13;
  const mean = x(estimate.mean);
  const beyondLow = estimate.low !== null && estimate.low < -half;
  const beyondHigh = estimate.high !== null && estimate.high > half;
  const digits = half >= 0.05 ? 3 : 2;
  const shape = hollow ? 'fill-surface stroke-model' : 'fill-model stroke-surface';
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      className="block w-full"
      style={{ maxInlineSize: `${width}px` }}
      data-testid="difference-strip"
    >
      {betterWords !== undefined && (
        <>
          <text
            x={pad}
            y={11}
            textAnchor="end"
            direction="rtl"
            className="fill-caption"
            fontSize={10.5}
          >
            {`◂ ${betterWords}`}
          </text>
          <text
            x={width - pad}
            y={11}
            textAnchor="start"
            direction="rtl"
            className="fill-caption"
            fontSize={10.5}
          >
            {`${worseWords ?? ''} ▸`}
          </text>
        </>
      )}
      {[-half, -half / 2, 0, half / 2, half].map((v) => (
        <g key={v}>
          <line
            x1={x(v)}
            x2={x(v)}
            y1={top}
            y2={top + 26}
            className={v === 0 ? 'stroke-fg' : 'stroke-caption'}
            strokeOpacity={v === 0 ? 1 : 0.22}
            strokeWidth={v === 0 ? 1.25 : 1}
          />
          {ticks && (
            <text
              x={x(v)}
              y={top + 39}
              textAnchor="middle"
              direction="ltr"
              className="fill-caption"
              fontSize={10}
            >
              {v === 0 ? faNumber(0, 0) : signed(v, digits)}
            </text>
          )}
        </g>
      ))}
      {estimate.low !== null && estimate.high !== null && (
        <g className="stroke-model" strokeWidth={2} strokeLinecap="round">
          <line x1={x(estimate.low)} x2={x(estimate.high)} y1={y} y2={y} />
          {!beyondLow && <line x1={x(estimate.low)} x2={x(estimate.low)} y1={y - 5} y2={y + 5} />}
          {!beyondHigh && (
            <line x1={x(estimate.high)} x2={x(estimate.high)} y1={y - 5} y2={y + 5} />
          )}
        </g>
      )}
      {beyondLow && <path d={`M${pad - 7} ${y} l8 -5 v10 z`} className="fill-model" />}
      {beyondHigh && <path d={`M${width - pad + 7} ${y} l-8 -5 v10 z`} className="fill-model" />}
      {mark === 'circle' && (
        <circle
          cx={mean}
          cy={y}
          r={4.5}
          className={shape}
          strokeWidth={hollow ? 1.5 : 2}
          strokeDasharray={hollow ? '2 2' : undefined}
        />
      )}
      {mark === 'diamond' && (
        <path
          d={`M${mean} ${y - 5.5} l5.5 5.5 l-5.5 5.5 l-5.5 -5.5 z`}
          className={shape}
          strokeWidth={1.5}
          strokeDasharray={hollow ? '2 2' : undefined}
        />
      )}
      {mark === 'square' && (
        <rect
          x={mean - 4.5}
          y={y - 4.5}
          width={9}
          height={9}
          className={shape}
          strokeWidth={1.5}
          strokeDasharray={hollow ? '2 2' : undefined}
        />
      )}
    </svg>
  );
}

/**
 * The place of a difference that is deliberately not shown (D-336's one
 * look, D-371): the same frame, faint, with a hatched bar and the words, so
 * it reads as withheld and never as broken or empty.
 */
export function WithheldStrip({ width, words }: { width: number; words: string }) {
  const pad = 16;
  const id = `withheld-${width}`;
  return (
    <svg
      viewBox={`0 0 ${width} 46`}
      role="img"
      aria-label={words}
      className="block w-full"
      style={{ maxInlineSize: `${width}px` }}
      data-testid="withheld-strip"
    >
      <defs>
        <pattern
          id={id}
          width={6}
          height={6}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line
            x1={0}
            y1={0}
            x2={0}
            y2={6}
            className="stroke-caption"
            strokeWidth={1.5}
            strokeOpacity={0.45}
          />
        </pattern>
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <line
          key={t}
          x1={pad + t * (width - 2 * pad)}
          x2={pad + t * (width - 2 * pad)}
          y1={4}
          y2={42}
          className="stroke-caption"
          strokeOpacity={0.28}
          strokeWidth={1}
        />
      ))}
      <rect x={pad} y={15} width={width - 2 * pad} height={16} rx={3} fill={`url(#${id})`} />
      <rect
        x={width / 2 - textSpan(words) / 2 - 8}
        y={13}
        width={textSpan(words) + 16}
        height={20}
        rx={4}
        className="fill-surface"
      />
      <text
        x={width / 2}
        y={27}
        textAnchor="middle"
        direction="rtl"
        className="fill-fg"
        fontSize={11}
      >
        {words}
      </text>
    </svg>
  );
}

/** A rough width of Persian words at 11 px, for the plate behind them. */
const textSpan = (words: string) => words.length * 5.6;

// --- The weekly trend of several versions on one scale (T-1752) -------------------

export interface TrendDomain {
  /** The first and last Monday on the shared calendar axis, `YYYY-MM-DD`. */
  first: string;
  last: string;
  /** The shared value axis. */
  low: number;
  high: number;
}

/** One calendar axis and one value axis for every version's panel, so heights compare. */
export function trendDomain(series: AccuracyPoint[][], reference: number): TrendDomain | null {
  const points = series.flat().filter((p) => p.log_loss !== null);
  if (points.length === 0) return null;
  const days = points.map((p) => p.period_start).sort();
  const values = points.map((p) => p.log_loss as number);
  const axis = niceAxis(Math.min(reference, ...values), Math.max(reference, ...values), 4);
  return { first: days[0] as string, last: days.at(-1) as string, low: axis.from, high: axis.to };
}

/**
 * One version's log loss by ISO week on the shared axes: a version that has
 * existed for three weeks fills only its part of the calendar, and a height
 * difference between two panels is a real difference.
 */
export function TrendPanel({
  points,
  domain,
  reference,
  minimum,
  width,
  className,
  label,
}: {
  points: AccuracyPoint[];
  domain: TrendDomain;
  reference: number;
  minimum: number;
  width: number;
  className?: string;
  label: string;
}) {
  const height = 210;
  const pad = { left: 44, right: 50, top: 16, bottom: 30 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
  const first = day(domain.first);
  const last = day(domain.last);
  const x = (iso: string) =>
    pad.left + (last === first ? plotW / 2 : ((day(iso) - first) / (last - first)) * plotW);
  const y = (v: number) =>
    pad.top + plotH - ((v - domain.low) / (domain.high - domain.low)) * plotH;
  const axis = niceAxis(domain.low, domain.high, 4);
  const digits = digitsFor(axis.step);
  const drawn = points.filter(
    (p): p is AccuracyPoint & { log_loss: number } => p.log_loss !== null,
  );
  const path = drawn
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.period_start)},${y(p.log_loss)}`)
    .join(' ');
  const end = drawn.at(-1);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      className={className ?? 'w-full'}
      data-testid="trend"
    >
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
        direction="rtl"
        className="fill-muted"
        fontSize={10}
      >
        {`حدس یک‌سوم ${score(reference)}`}
      </text>
      {[domain.first, domain.last].map((iso, i) => (
        <text
          key={iso}
          x={x(iso)}
          y={height - 8}
          textAnchor={domain.first === domain.last ? 'middle' : i === 0 ? 'start' : 'end'}
          direction="rtl"
          className="fill-caption"
          fontSize={10}
        >
          {weekName(iso)}
        </text>
      ))}
      <path
        d={path}
        fill="none"
        className="stroke-model"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {drawn.map((p) => (
        <g key={p.period_start}>
          <title>{`هفته‌ی ${weekName(p.period_start)}: log loss ${score(p.log_loss)} روی ${faNumber(
            p.matches,
            0,
          )} مسابقه`}</title>
          <circle
            cx={x(p.period_start)}
            cy={y(p.log_loss)}
            r={4.5}
            className={
              p.matches < minimum ? 'fill-surface stroke-model' : 'fill-model stroke-surface'
            }
            strokeWidth={2}
          />
          <circle cx={x(p.period_start)} cy={y(p.log_loss)} r={12} fill="transparent" />
        </g>
      ))}
      {end !== undefined && (
        <text
          x={x(end.period_start) + 9}
          y={y(end.log_loss) + 3.5}
          textAnchor="start"
          direction="ltr"
          className="fill-fg"
          fontSize={11}
          fontWeight={700}
        >
          {score(end.log_loss)}
        </text>
      )}
    </svg>
  );
}
