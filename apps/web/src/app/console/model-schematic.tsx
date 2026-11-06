import type { ConsoleModelInputState, ConsoleModelVersion } from '@fmip/contracts';
import type { ReactNode } from 'react';
import {
  FATE_WORDS,
  MODEL_MATRIX,
  MODEL_NAME,
  MODEL_VERSIONS,
  PIPELINE_INPUTS,
  PIPELINE_OUTPUTS,
  PIPELINE_OUTSIDE,
  PIPELINE_STEPS,
  VERSION_ORDER,
  type VersionNumber,
  isNewIn,
  matrixCell,
  hasElement,
  versionNumber,
} from './model-notes';
import { textWidth, wrap } from './schematic';
import { fa, when } from './ui';

/**
 * The forecast model as a drawing (T-1752, D-371), server-rendered SVG as
 * the agent schematic (D-352): what goes in, with what the store holds of it
 * now; the steps of one forecast; what comes out; and, apart in a dashed
 * band, the data every version leaves out. A pill per version on each part
 * says which version uses it, and a leading "+" marks the first of them to:
 * "what 0.6.0 uses that 0.1.0 did not" is read off the picture. Two
 * drawings of the same data: columns from 1024 px, stacked below it, so no
 * text is drawn under 10 px. The make-up matrix below is its full text form.
 */

// --- Words -------------------------------------------------------------------

export const INPUT_STATE_WORDS = {
  available: 'در دسترس',
  limited: 'ناکامل',
  not_supplied: 'موجود نیست',
  delayed: 'با تأخیر',
} as const;

/** One input's count and freshness, in words, from what the API counted. */
export function inputWords(state: ConsoleModelInputState | undefined): string {
  if (state === undefined) return 'شمرده نشد';
  const newest = state.newest_at === null ? '' : `؛ تازه‌ترین ${when(state.newest_at, false)}`;
  const word = INPUT_STATE_WORDS[state.coverage];
  switch (state.key) {
    case 'results':
      return `${fa(state.count)} مسابقه در پنجره‌ی ۱۱۰۰ روزه، ${fa(state.groups ?? 0)} لیگ${
        (state.late_groups ?? 0) > 0
          ? `؛ در ${fa(state.late_groups ?? 0)} لیگ نتیجه‌ی ده روز اخیر نیامده`
          : ''
      }${newest} — ${word}`;
    case 'cross_league':
      return `${fa(state.count)} مسابقه در پنجره${newest} — ${word}`;
    case 'own_elo':
      return `${fa(state.count)} باشگاه${newest} — ${word}`;
    case 'expected_goals':
      return `برای ${fa(state.count)} از ${fa(state.of ?? 0)} مسابقه‌ی تمام‌شده‌ی ۹۰ روز اخیر — ${word}`;
    case 'lineups':
      return `هر دو ترکیب برای ${fa(state.count)} از ${fa(state.of ?? 0)} مسابقه‌ی ۳۰ روز اخیر — ${word}`;
    case 'absences':
      return `برای ${fa(state.count)} مسابقه${newest} — ${word}`;
  }
}

// --- Geometry --------------------------------------------------------------------

const LABEL = 12.5;
const DETAIL = 10.5;
const LH = 17;
const DLH = 14;
const PAD = 8;
const GAP = 8;
const HEAD = 26;
const PILL_W = 34;
const PILL_H = 16;
const PILL_GAP = 4;

type Pill = 'used' | 'new' | 'not' | 'silent';

interface Item {
  label: string;
  details: string[];
  pills: { version: string; state: Pill }[];
  tone: 'input' | 'step' | 'output' | 'outside';
  href?: string;
}

interface Box extends Item {
  lines: string[];
  detailLines: string[];
  w: number;
  h: number;
}

function measure(item: Item, w: number): Box {
  const lines = wrap(item.label, w - 2 * PAD, LABEL);
  const detailLines = item.details.flatMap((d) => wrap(d, w - 2 * PAD, DETAIL));
  const pillRow = item.pills.length > 0 ? PILL_H + 6 : 0;
  return {
    ...item,
    lines,
    detailLines,
    w,
    h: 2 * PAD + lines.length * LH + detailLines.length * DLH + pillRow,
  };
}

const TONE: Record<Item['tone'], string> = {
  input: 'fill-surface-raised stroke-caption',
  step: 'fill-surface stroke-model',
  output: 'fill-surface-raised stroke-success',
  outside: 'fill-canvas stroke-muted',
};

const PILL_WORDS: Record<Pill, string> = {
  used: 'به‌کار می‌رود',
  new: 'از این نسخه به‌کار می‌رود',
  not: 'به‌کار نمی‌رود',
  silent: 'نام برده، ولی چیزی از آن نگرفت',
};

function PillRow({ pills, right, y }: { pills: Box['pills']; right: number; y: number }) {
  return (
    <g data-part="pills">
      {pills.map((pill, i) => {
        const x = right - PAD - (i + 1) * PILL_W - i * PILL_GAP;
        const filled = pill.state === 'used' || pill.state === 'new';
        return (
          <g key={pill.version}>
            <title>{`${pill.version}: ${PILL_WORDS[pill.state]}`}</title>
            <rect
              x={x}
              y={y}
              width={PILL_W}
              height={PILL_H}
              rx={PILL_H / 2}
              className={filled ? 'fill-model' : 'fill-surface stroke-caption'}
              strokeWidth={1}
              strokeDasharray={pill.state === 'silent' ? '3 2' : undefined}
            />
            <text
              x={x + PILL_W / 2}
              y={y + 11.5}
              textAnchor="middle"
              direction="ltr"
              fontSize={10.5}
              fontWeight={700}
              className={filled ? 'fill-surface' : 'fill-caption'}
            >
              {`${pill.state === 'new' ? '+' : ''}${versionNumber(pill.version).slice(0, 3)}`}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function BoxView({ box, right, top }: { box: Box; right: number; top: number }) {
  const x = right - box.w;
  const body = (
    <g>
      <rect
        x={x}
        y={top}
        width={box.w}
        height={box.h}
        rx={6}
        className={TONE[box.tone]}
        strokeWidth={box.tone === 'step' ? 1.5 : 1.25}
        strokeDasharray={box.tone === 'outside' ? '4 3' : undefined}
      />
      {box.lines.map((line, i) => (
        <text
          key={`l${i}`}
          x={right - PAD}
          y={top + PAD + 12.5 + i * LH}
          direction="rtl"
          textAnchor="start"
          fontSize={LABEL}
          fontWeight={700}
          className="fill-fg"
        >
          {line}
        </text>
      ))}
      {box.detailLines.map((line, i) => (
        <text
          key={`d${i}`}
          x={right - PAD}
          y={top + PAD + 11 + box.lines.length * LH + i * DLH}
          direction="rtl"
          textAnchor="start"
          fontSize={DETAIL}
          className="fill-muted"
        >
          {line}
        </text>
      ))}
      {box.pills.length > 0 && (
        <PillRow
          pills={box.pills}
          right={right}
          y={top + PAD + 4 + box.lines.length * LH + box.detailLines.length * DLH}
        />
      )}
    </g>
  );
  return box.href === undefined ? body : <a href={box.href}>{body}</a>;
}

function stack(heights: number[], top: number, gap: number): number[] {
  const tops: number[] = [];
  let y = top;
  for (const h of heights) {
    tops.push(y);
    y += h + gap;
  }
  return tops;
}

function Title({ text, right, y }: { text: string; right: number; y: number }) {
  return (
    <text
      x={right}
      y={y}
      direction="rtl"
      textAnchor="start"
      fontSize={13}
      fontWeight={700}
      className="fill-muted"
    >
      {text}
    </text>
  );
}

function Column({
  title,
  boxes,
  right,
  top,
  section,
}: {
  title: string;
  boxes: Box[];
  right: number;
  top: number;
  section: string;
}) {
  const tops = stack(
    boxes.map((b) => b.h),
    top + HEAD,
    GAP,
  );
  return (
    <g data-section={section}>
      <Title text={title} right={right} y={top + 15} />
      {boxes.map((box, i) => (
        <BoxView key={i} box={box} right={right} top={tops[i] as number} />
      ))}
    </g>
  );
}

const columnHeight = (boxes: Box[]) =>
  HEAD + boxes.reduce((sum, b) => sum + b.h, 0) + GAP * Math.max(0, boxes.length - 1);

function Arrow({
  id,
  x1,
  y1,
  x2,
  y2,
}: {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}) {
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      className="stroke-caption"
      strokeWidth={1.5}
      markerEnd={`url(#${id}-arrow)`}
    />
  );
}

// --- The parts, from the notes and the API ---------------------------------------

/** The versions the pills name: those with stored forecasts, oldest first, that the notes know. */
export function pillVersions(versions: readonly ConsoleModelVersion[]): string[] {
  const known = new Set(versions.map((v) => v.model_version));
  return VERSION_ORDER.filter((n) => known.has(`${MODEL_NAME}@${n}`)).map(
    (n) => `${MODEL_NAME}@${n}`,
  );
}

function pillsOf(
  span: { from: VersionNumber; until?: VersionNumber; silent?: VersionNumber[] },
  shown: readonly string[],
): Item['pills'] {
  const numbers = shown.map(versionNumber);
  return shown.map((version, i) => {
    const use = hasElement(span, numbers[i] as string);
    return {
      version,
      state:
        use === 'not'
          ? 'not'
          : use === 'silent'
            ? 'silent'
            : isNewIn(span, numbers[i] as string, numbers)
              ? 'new'
              : 'used',
    };
  });
}

function parts(inputs: readonly ConsoleModelInputState[], shown: readonly string[]) {
  const byKey = new Map(inputs.map((i) => [i.key, i]));
  const inputItems: Item[] = PIPELINE_INPUTS.map((input) => ({
    label: input.title,
    details: [
      input.source,
      input.input === null ? (input.plain ?? '') : inputWords(byKey.get(input.input)),
    ].filter((d) => d !== ''),
    pills: pillsOf(input, shown),
    tone: 'input',
  }));
  const stepItems: Item[] = PIPELINE_STEPS.map((step, i) => ({
    label: `${fa(i + 1)}. ${step.title}`,
    details: [step.detail],
    pills: pillsOf(step, shown),
    tone: 'step',
  }));
  const outputItems: Item[] = PIPELINE_OUTPUTS.map((output) => ({
    label: output.title,
    details: [output.detail],
    pills: [],
    tone: 'output',
  }));
  const outsideItems: Item[] = [
    ...PIPELINE_OUTSIDE.map((item) => ({
      label: item.title,
      details: [item.detail, inputWords(byKey.get(item.input))],
      pills: shown.map((version) => ({ version, state: 'not' as const })),
      tone: 'outside' as const,
      href: '#ledger',
    })),
    {
      label: 'و هر عامل دیگری که آزموده شد',
      details: ['استراحت، مربی، انگیزه، سابقه‌ی رودررو، … → دفتر آزمایش‌ها'],
      pills: [],
      tone: 'outside' as const,
      href: '#ledger',
    },
  ];
  return { inputItems, stepItems, outputItems, outsideItems };
}

const LEGEND: { kind: 'used' | 'new' | 'not' | 'silent' | 'outside' | 'arrow'; label: string }[] = [
  { kind: 'used', label: 'این نسخه به‌کارش می‌برد' },
  { kind: 'new', label: 'از این نسخه به‌کار رفت' },
  { kind: 'not', label: 'به‌کار نمی‌برد' },
  { kind: 'silent', label: 'نام برده، ولی ساکت بود' },
  { kind: 'outside', label: 'بیرون از مدل' },
  { kind: 'arrow', label: 'جهت کار' },
];

function Legend({ id, w, right, top }: { id: string; w: number; right: number; top: number }) {
  const rows: { entry: (typeof LEGEND)[number]; dx: number; dy: number }[] = [];
  let dx = 0;
  let dy = 0;
  for (const entry of LEGEND) {
    const ew = PILL_W + 6 + textWidth(entry.label, 11.5) + 18;
    if (dx > 0 && dx + ew > w) {
      dx = 0;
      dy += 22;
    }
    rows.push({ entry, dx, dy });
    dx += ew;
  }
  return (
    <g data-section="legend">
      <Title text="راهنما" right={right} y={top + 15} />
      {rows.map(({ entry, dx: x0, dy: y0 }) => {
        const x = right - x0;
        const y = top + HEAD + y0;
        return (
          <g key={entry.kind}>
            {entry.kind === 'arrow' ? (
              <Arrow id={id} x1={x} y1={y + 8} x2={x - PILL_W} y2={y + 8} />
            ) : entry.kind === 'outside' ? (
              <rect
                x={x - PILL_W}
                y={y}
                width={PILL_W}
                height={PILL_H}
                rx={4}
                className="fill-canvas stroke-muted"
                strokeWidth={1.25}
                strokeDasharray="4 3"
              />
            ) : (
              <>
                <rect
                  x={x - PILL_W}
                  y={y}
                  width={PILL_W}
                  height={PILL_H}
                  rx={PILL_H / 2}
                  className={
                    entry.kind === 'used' || entry.kind === 'new'
                      ? 'fill-model'
                      : 'fill-surface stroke-caption'
                  }
                  strokeWidth={1}
                  strokeDasharray={entry.kind === 'silent' ? '3 2' : undefined}
                />
                <text
                  x={x - PILL_W / 2}
                  y={y + 11.5}
                  textAnchor="middle"
                  direction="ltr"
                  fontSize={10.5}
                  fontWeight={700}
                  className={
                    entry.kind === 'used' || entry.kind === 'new' ? 'fill-surface' : 'fill-caption'
                  }
                >
                  {entry.kind === 'new' ? '+0.6' : '0.6'}
                </text>
              </>
            )}
            <text
              x={x - PILL_W - 6}
              y={y + 12}
              direction="rtl"
              textAnchor="start"
              fontSize={11.5}
              className="fill-muted"
            >
              {entry.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

const M = 16;

function Drawing({
  inputs,
  shown,
  layout,
}: {
  inputs: readonly ConsoleModelInputState[];
  shown: readonly string[];
  layout: 'wide' | 'narrow';
}) {
  const id = `model-schematic-${layout}`;
  const wide = layout === 'wide';
  const W = wide ? 1048 : 360;
  const inner = W - 2 * M;
  const right = W - M;
  const { inputItems, stepItems, outputItems, outsideItems } = parts(inputs, shown);
  const nodes: ReactNode[] = [];
  let y = M;
  if (wide) {
    const widths = [310, 400, 230];
    const gap = (inner - widths.reduce((a, b) => a + b, 0)) / 2;
    const rights = [right, right - widths[0]! - gap, right - widths[0]! - widths[1]! - 2 * gap];
    const ins = inputItems.map((i) => measure(i, widths[0]!));
    const steps = stepItems.map((i) => measure(i, widths[1]!));
    const outs = outputItems.map((i) => measure(i, widths[2]!));
    const heights = [columnHeight(ins), columnHeight(steps), columnHeight(outs)];
    nodes.push(
      <Column
        key="i"
        title="داده‌ی ورودی: آنچه انبار الان دارد"
        boxes={ins}
        right={rights[0]!}
        top={y}
        section="inputs"
      />,
      <Column
        key="s"
        title={`خط‌لوله‌ی یک پیش‌بینی: ${MODEL_NAME}`}
        boxes={steps}
        right={rights[1]!}
        top={y}
        section="steps"
      />,
      <Column key="o" title="خروجی" boxes={outs} right={rights[2]!} top={y} section="outputs" />,
    );
    for (let i = 0; i < 2; i += 1) {
      const ay = y + HEAD + Math.min(heights[i]!, heights[i + 1]!, 140) / 2;
      nodes.push(
        <Arrow
          key={`a${i}`}
          id={id}
          x1={rights[i]! - widths[i]! - 4}
          y1={ay}
          x2={rights[i + 1]! + 4}
          y2={ay}
        />,
      );
    }
    y += Math.max(...heights) + 28;
    // The dashed band: the four boxes side by side.
    const bw = (inner - 2 * PAD - 3 * GAP) / 4;
    const outs2 = outsideItems.map((i) => measure(i, bw));
    const bh = HEAD + Math.max(...outs2.map((b) => b.h)) + PAD;
    nodes.push(
      <g key="band" data-section="outside">
        <rect
          x={M}
          y={y}
          width={inner}
          height={bh}
          rx={10}
          className="fill-none stroke-muted"
          strokeWidth={1}
          strokeDasharray="6 4"
        />
        <Title
          text="آزموده‌شده و بیرون مانده: هیچ نسخه‌ای نمی‌خواند"
          right={right - PAD}
          y={y + 17}
        />
        {outs2.map((box, i) => (
          <BoxView key={i} box={box} right={right - PAD - i * (bw + GAP)} top={y + HEAD} />
        ))}
      </g>,
    );
    y += bh + 20;
  } else {
    const down = (key: string) => {
      nodes.push(<Arrow key={key} id={id} x1={W / 2} y1={y + 2} x2={W / 2} y2={y + 24} />);
      y += 30;
    };
    const ins = inputItems.map((i) => measure(i, inner));
    nodes.push(
      <Column
        key="i"
        title="داده‌ی ورودی: آنچه انبار الان دارد"
        boxes={ins}
        right={right}
        top={y}
        section="inputs"
      />,
    );
    y += columnHeight(ins);
    down('d0');
    const steps = stepItems.map((i) => measure(i, inner));
    nodes.push(
      <Column
        key="s"
        title={`خط‌لوله‌ی یک پیش‌بینی: ${MODEL_NAME}`}
        boxes={steps}
        right={right}
        top={y}
        section="steps"
      />,
    );
    y += columnHeight(steps);
    down('d1');
    const outs = outputItems.map((i) => measure(i, inner));
    nodes.push(
      <Column key="o" title="خروجی" boxes={outs} right={right} top={y} section="outputs" />,
    );
    y += columnHeight(outs) + 24;
    const outs2 = outsideItems.map((i) => measure(i, inner - 2 * PAD));
    const bh = HEAD + outs2.reduce((s, b) => s + b.h, 0) + GAP * (outs2.length - 1) + PAD;
    const tops = stack(
      outs2.map((b) => b.h),
      y + HEAD,
      GAP,
    );
    nodes.push(
      <g key="band" data-section="outside">
        <rect
          x={M}
          y={y}
          width={inner}
          height={bh}
          rx={10}
          className="fill-none stroke-muted"
          strokeWidth={1}
          strokeDasharray="6 4"
        />
        <Title text="آزموده‌شده و بیرون مانده" right={right - PAD} y={y + 17} />
        {outs2.map((box, i) => (
          <BoxView key={i} box={box} right={right - PAD} top={tops[i] as number} />
        ))}
      </g>,
    );
    y += bh + 20;
  }
  const legendRows = Math.ceil(LEGEND.length / (wide ? 6 : 2));
  nodes.push(<Legend key="g" id={id} w={inner} right={right} top={y} />);
  y += HEAD + legendRows * 22 + M;
  return (
    <svg
      viewBox={`0 0 ${W} ${Math.ceil(y)}`}
      role="img"
      aria-labelledby={`${id}-title ${id}-desc`}
      direction="rtl"
      className="block h-auto w-full"
      data-layout={layout}
    >
      <title id={`${id}-title`}>مدل پیش‌بینی از چه ساخته شده است</title>
      <desc id={`${id}-desc`}>
        {`${fa(inputItems.length)} ورودی، ${fa(stepItems.length)} گام و ${fa(outputItems.length)} خروجی؛ ${fa(PIPELINE_OUTSIDE.length)} داده‌ی آزموده‌شده بیرون از مدل. هر گل‌میخ یک نسخه است: ${shown.map(versionNumber).join('، ')}.`}
      </desc>
      <defs>
        <marker
          id={`${id}-arrow`}
          viewBox="0 0 10 10"
          refX={9}
          refY={5}
          markerWidth={7}
          markerHeight={7}
          orient="auto"
        >
          <path d="M0 0 L10 5 L0 10 z" className="fill-caption" />
        </marker>
      </defs>
      {nodes}
    </svg>
  );
}

/** The pipeline: columns from 1024 px, stacked below (Tailwind's `lg`). */
export function ModelSchematic({
  inputs,
  versions,
}: {
  inputs: readonly ConsoleModelInputState[];
  versions: readonly ConsoleModelVersion[];
}) {
  const shown = pillVersions(versions);
  return (
    <div data-testid="model-schematic">
      <div className="hidden lg:block">
        <Drawing inputs={inputs} shown={shown} layout="wide" />
      </div>
      <div className="mx-auto max-w-[30rem] lg:hidden">
        <Drawing inputs={inputs} shown={shown} layout="narrow" />
      </div>
    </div>
  );
}

// --- The make-up matrix: the schematic's full text form ---------------------------

const MARK: Record<'used' | 'not' | 'silent', string> = { used: '●', not: '○', silent: '◐' };

/** Every version as a column, oldest at the inline start; a changed cell says so in a word. */
export function MakeupMatrix() {
  return (
    <div className="overflow-x-auto" data-testid="makeup-matrix">
      <table className="w-full min-w-[40rem] text-sm">
        <caption className="sr-only">ترکیب هر نسخه: هر ستون یک نسخه، هر ردیف یک جزء</caption>
        <thead className="text-xs text-caption">
          <tr>
            <th className="sticky inset-inline-start-0 bg-surface p-2 text-start font-normal">
              جزء
            </th>
            {VERSION_ORDER.map((number) => {
              const note = MODEL_VERSIONS[number];
              return (
                <th
                  key={number}
                  className={`p-2 text-start font-normal align-top ${
                    note.fate === 'never_shipped'
                      ? 'border-t-2 border-dotted border-strong'
                      : note.fate === 'shadow_unstored'
                        ? 'border-t-2 border-dashed border-strong'
                        : 'border-t-2 border-model'
                  }`}
                >
                  <span className="block font-bold text-fg" dir="ltr">
                    {number}
                  </span>
                  <span className="block">{FATE_WORDS[note.fate]}</span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {MODEL_MATRIX.map((row) => (
            <tr
              key={row.technical}
              className={`border-t border-default ${row.outside ? 'text-muted' : ''}`}
              data-outside={row.outside ? 'true' : undefined}
            >
              <th
                scope="row"
                className="sticky inset-inline-start-0 bg-surface p-2 text-start font-normal"
              >
                <span className="block text-fg">{row.title}</span>
                <span className="block text-xs text-caption" dir="ltr">
                  {row.technical}
                </span>
                {row.outside && (
                  <span className="block text-xs text-caption">بیرون از همه‌ی نسخه‌ها</span>
                )}
              </th>
              {VERSION_ORDER.map((number) => {
                const cell = matrixCell(row, number);
                return (
                  <td
                    key={number}
                    className={`p-2 align-top ${cell.changed ? 'border-s-2 border-model' : ''}`}
                  >
                    {cell.words ?? (
                      <span
                        aria-label={
                          cell.use === 'used'
                            ? 'دارد'
                            : cell.use === 'silent'
                              ? 'نام برده، ساکت'
                              : 'ندارد'
                        }
                      >
                        {MARK[cell.use]}
                      </span>
                    )}
                    {cell.changed && <span className="ms-1 text-xs text-model">تازه</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** What each version changed from the one before it, in one line each. */
export function VersionDeltas({ versions }: { versions: readonly ConsoleModelVersion[] }) {
  const stored = new Set(versions.map((v) => versionNumber(v.model_version)));
  return (
    <ol className="flex flex-col gap-1.5 text-sm leading-7" data-testid="version-deltas">
      {VERSION_ORDER.map((number) => {
        const note = MODEL_VERSIONS[number];
        return (
          <li key={number}>
            <span className="font-bold text-fg" dir="ltr">
              {number}
            </span>{' '}
            <span className="text-xs text-caption">
              {FATE_WORDS[note.fate]}
              {!stored.has(number) &&
              note.fate !== 'shadow_unstored' &&
              note.fate !== 'never_shipped'
                ? '؛ پیش‌بینی ذخیره‌شده‌ای ندارد'
                : ''}{' '}
              · {note.decision}
            </span>
            <span className="text-fg">: {note.delta}</span>
          </li>
        );
      })}
    </ol>
  );
}

// --- How versions are compared --------------------------------------------------

const METHOD_STEPS: { label: string; detail: string }[] = [
  {
    label: '۱. همان مسابقه‌ها',
    detail: 'فقط مسابقه‌هایی که هر دو نسخه پیش از سوت آغاز پیش‌بینی کرده‌اند',
  },
  {
    label: '۲. آخرین پیش‌بینی هر طرف پیش از شروع',
    detail: 'هر مسابقه یک بار؛ پیش‌بینیِ پس از شروع ذخیره می‌شود و هرگز شمرده نمی‌شود (D-209)',
  },
  { label: '۳. چهار معیار', detail: 'درصد درست، log loss، Brier و RPS روی همان مسابقه‌ها' },
  {
    label: '۴. اختلاف جفتی',
    detail: 'میانگین اختلاف log loss هر مسابقه و بازه‌ی ۹۵٪ آن؛ منفی یعنی نسخه‌ی موضوع بهتر',
  },
  {
    label: '۵. حکم، طبق قاعده',
    detail: 'فقط وقتی شمار کامل است و فقط یک بار، در پایش هفتگی؛ ارتقا با نگهدارنده (D-082)',
  },
];

function MethodDrawing({ layout }: { layout: 'wide' | 'narrow' }) {
  const id = `method-${layout}`;
  const wide = layout === 'wide';
  const W = wide ? 1048 : 360;
  const inner = W - 2 * M;
  const right = W - M;
  const boxW = wide ? (inner - 4 * 34) / 5 : inner;
  const boxes = METHOD_STEPS.map((step) =>
    measure({ label: step.label, details: [step.detail], pills: [], tone: 'step' }, boxW),
  );
  const h = Math.max(...boxes.map((b) => b.h));
  const nodes: ReactNode[] = [];
  let height: number;
  if (wide) {
    boxes.forEach((box, i) => {
      const r = right - i * (boxW + 34);
      nodes.push(<BoxView key={i} box={{ ...box, h }} right={r} top={M} />);
      if (i < boxes.length - 1) {
        nodes.push(
          <Arrow
            key={`a${i}`}
            id={id}
            x1={r - boxW - 4}
            y1={M + h / 2}
            x2={r - boxW - 30}
            y2={M + h / 2}
          />,
        );
      }
    });
    height = M + h + M;
  } else {
    let y = M;
    boxes.forEach((box, i) => {
      nodes.push(<BoxView key={i} box={box} right={right} top={y} />);
      y += box.h;
      if (i < boxes.length - 1) {
        nodes.push(<Arrow key={`a${i}`} id={id} x1={W / 2} y1={y + 2} x2={W / 2} y2={y + 22} />);
        y += 28;
      }
    });
    height = y + M;
  }
  return (
    <svg
      viewBox={`0 0 ${W} ${Math.ceil(height)}`}
      role="img"
      aria-labelledby={`${id}-title`}
      direction="rtl"
      className="block h-auto w-full"
      data-layout={layout}
    >
      <title id={`${id}-title`}>دو نسخه چطور با هم سنجیده می‌شوند: پنج گام</title>
      <defs>
        <marker
          id={`${id}-arrow`}
          viewBox="0 0 10 10"
          refX={9}
          refY={5}
          markerWidth={7}
          markerHeight={7}
          orient="auto"
        >
          <path d="M0 0 L10 5 L0 10 z" className="fill-caption" />
        </marker>
      </defs>
      {nodes}
    </svg>
  );
}

export function MethodSchematic() {
  return (
    <div data-testid="method-schematic">
      <div className="hidden lg:block">
        <MethodDrawing layout="wide" />
      </div>
      <div className="mx-auto max-w-[30rem] lg:hidden">
        <MethodDrawing layout="narrow" />
      </div>
      <ol className="sr-only">
        {METHOD_STEPS.map((step) => (
          <li key={step.label}>
            {step.label}: {step.detail}
          </li>
        ))}
      </ol>
    </div>
  );
}
