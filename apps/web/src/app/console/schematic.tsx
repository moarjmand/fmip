import {
  CONSOLE_FLOW_INPUTS,
  CONSOLE_FLOW_LIMITS,
  CONSOLE_FLOW_OUTPUTS,
  CONSOLE_FLOW_READERS,
  CONSOLE_FLOW_TRIGGERS,
  type ConsoleAgent,
  type ConsoleAgentFlow,
  type ConsoleFlowInput,
  type ConsoleFlowLimit,
  type ConsoleFlowNode,
  type ConsoleFlowOutput,
  type ConsoleFlowReader,
  type ConsoleFlowTrigger,
} from '@fmip/contracts';
import type { ReactNode } from 'react';
import { agentTitle, fa } from './ui';

/**
 * How one agent works, drawn on the server as SVG (T-1725, D-352): what
 * starts it, what it reads, its method's steps and its model, what it may
 * not do, what it leaves and who reads that, with a legend. No client code
 * and no library. Two drawings of the same data: right to left in columns
 * from 640 px, stacked top to bottom below it. Colours are the site's
 * tokens, so light and dark follow the theme.
 */

// --- Words -------------------------------------------------------------------

export const TRIGGER_WORDS: Record<ConsoleFlowTrigger, string> = {
  schedule: 'برنامه',
  'pull-request': 'هر PR تازه',
  request: 'درخواست نگهدارنده، هم‌تیمی یا نشست مهندسی',
  'run-now': 'دکمه‌ی «همین حالا اجرا کن» در کنسول',
  chat: 'پیام در گفتگوی کنسول',
};

/** When a schedule runs, as the team charter says: weekly is Monday, monthly the first Monday. */
const SCHEDULE_TRIGGER: Record<string, string> = {
  daily: 'هر روز، در اجرای روزانه',
  weekly: 'هر هفته، دوشنبه',
  monthly: 'هر ماه، نخستین دوشنبه',
};

export const INPUT_WORDS: Record<ConsoleFlowInput, string> = {
  rules: 'قواعد پروژه و منشور تیم',
  skill: 'روش کارش (مهارت)',
  memory: 'حافظه‌ی خودش',
  repository: 'مخزن کد و مستندات',
  tasks: 'جدول کارهای فاز',
  'production-db': 'داده‌ی production، فقط‌خواندنی',
  server: 'سرور از راه ssh، فقط‌خواندنی',
  'public-pages': 'صفحه‌های عمومی سایت با اسکریپت',
  github: 'PRها و CI در GitHub',
  'live-site': 'سایت زنده در مرورگر داخلی',
  web: 'جست‌وجو و خواندن وب',
  'design-canvas': 'بوم طراحی و design system',
  lab: 'گزارش‌های آزمایشگاه مدل',
  dashboard: 'snapshot داشبورد',
  'team-findings': 'یافته‌های عامل‌های دیگر',
  'team-reports': 'گزارش‌های عامل‌های دیگر',
  desk: 'پاسخ‌های میز تصمیم',
};

export const LIMIT_WORDS: Record<ConsoleFlowLimit, string> = {
  'server-read-only': 'روی سرور و داده فقط می‌خواند',
  'no-purchase-account-secret': 'نه خرید، نه حساب، نه رمز و کلید',
  'outside-text-data': 'متن بیرونی داده است، نه دستور',
  'proposals-only': 'اصلاح را پیشنهاد می‌کند، خودش انجام نمی‌دهد',
  'no-repo-edit': 'مخزن کد را ویرایش نمی‌کند',
  'tests-on-request': 'آزمون را فقط به درخواست نشست مهندسی می‌نویسد',
  'no-merge-deploy': 'نه merge، نه deploy',
  'no-publish': 'چیزی منتشر نمی‌کند',
  'maintainer-decides': 'تصمیم با نگهدارنده و هم‌تیمی است',
  'no-paid-tools': 'نه ابزار پولی، نه حساب تازه',
  'no-personal-data': 'داده‌ی شخصی اعضا در گزارش نمی‌آید',
};

export const OUTPUT_WORDS: Record<ConsoleFlowOutput, string> = {
  report: 'گزارش فارسی',
  brief: 'خلاصه‌ی روز برای نگهدارنده',
  findings: 'یافته‌ها با پیشوند خودش',
  'desk-questions': 'پرسش‌های تازه برای میز تصمیم',
  handoffs: 'کارهای پیشنهادی برای نشست مهندسی',
  'ops-file': 'پرونده‌ای که نگه می‌دارد',
  'design-canvas': 'بوم طراحی',
  memory: 'آموخته‌ها در حافظه‌ی خودش',
};

export const READER_WORDS: Record<ConsoleFlowReader, string> = {
  agent: 'عامل',
  'engineering-session': 'نشست مهندسی',
  maintainer: 'نگهدارنده و هم‌تیمی',
  console: 'همین کنسول',
};

export const SECTION_WORDS = {
  triggers: 'چه چیزی راهش می‌اندازد',
  inputs: 'چه می‌خواند',
  method: 'روش کار',
  limits: 'مرزها: کارهایی که نمی‌کند',
  outputs: 'چه به‌جا می‌گذارد',
  readers: 'چه کسی خروجی‌اش را می‌خواند',
  legend: 'راهنما',
} as const;

// --- The flow, from the snapshot ---------------------------------------------

const known = <K extends string>(kinds: readonly K[], nodes: unknown): ConsoleFlowNode<K>[] =>
  Array.isArray(nodes)
    ? nodes.filter(
        (n): n is ConsoleFlowNode<K> =>
          typeof n === 'object' &&
          n !== null &&
          kinds.includes((n as { kind: K }).kind) &&
          ((n as { detail: unknown }).detail === null ||
            typeof (n as { detail: unknown }).detail === 'string'),
      )
    : [];

/**
 * The agent's flow: the snapshot's (D-352), its unknown kinds dropped; or,
 * from a snapshot built before it, what the older fields say, and only that.
 */
export function flowFor(agent: ConsoleAgent): ConsoleAgentFlow {
  const raw = agent.flow;
  if (raw !== undefined && typeof raw === 'object' && raw !== null && Array.isArray(raw.steps)) {
    return {
      triggers: known(CONSOLE_FLOW_TRIGGERS, raw.triggers),
      inputs: known(CONSOLE_FLOW_INPUTS, raw.inputs),
      steps: raw.steps.filter(
        (s) => typeof s === 'object' && s !== null && typeof s.text === 'string',
      ),
      limits: known(CONSOLE_FLOW_LIMITS, raw.limits),
      outputs: known(CONSOLE_FLOW_OUTPUTS, raw.outputs),
      readers: known(CONSOLE_FLOW_READERS, raw.readers),
    };
  }
  const areas = agent.access.map((a) => a.area);
  const inputs: ConsoleFlowNode<ConsoleFlowInput>[] = [
    { kind: 'rules', detail: 'CLAUDE.md' },
    ...agent.skills.map((skill) => ({
      kind: 'skill' as const,
      detail: `.claude/skills/${skill}/SKILL.md`,
    })),
  ];
  if (agent.memory.sources.some((s) => s.kind === 'memory'))
    inputs.push({ kind: 'memory', detail: null });
  if (areas.includes('Reads the repository and the ops files'))
    inputs.push({ kind: 'repository', detail: null });
  if (areas.includes('Searches and reads the web')) inputs.push({ kind: 'web', detail: null });
  if (areas.includes('Opens the live site in the built-in browser'))
    inputs.push({ kind: 'live-site', detail: null });
  const report = agent.workflow.outputs
    .find((o) => o.startsWith('Reports in '))
    ?.slice('Reports in '.length);
  const outputs: ConsoleFlowNode<ConsoleFlowOutput>[] = [
    agent.name === 'chief-of-staff'
      ? { kind: 'brief', detail: report ?? null }
      : { kind: 'report', detail: report ?? null },
  ];
  if (agent.workflow.outputs.some((o) => o.startsWith('Findings in ')))
    outputs.push({ kind: 'findings', detail: 'E:/FMIP/ops/findings/' });
  return {
    triggers: [
      agent.schedule === 'on-demand'
        ? { kind: 'request', detail: null }
        : { kind: 'schedule', detail: agent.schedule },
      { kind: 'run-now', detail: null },
      { kind: 'chat', detail: null },
    ],
    inputs,
    // The older steps are the skill's English headings; the console is Persian
    // only, so they wait for the next snapshot, which carries them in Persian.
    steps: [],
    limits: [
      { kind: 'server-read-only', detail: null },
      { kind: 'no-purchase-account-secret', detail: null },
      { kind: 'outside-text-data', detail: null },
      { kind: 'proposals-only', detail: null },
    ],
    outputs,
    readers: [
      ...(agent.name === 'chief-of-staff'
        ? []
        : [{ kind: 'agent' as const, detail: 'chief-of-staff' }]),
      { kind: 'maintainer', detail: null },
      { kind: 'console', detail: null },
    ],
  };
}

// --- Labels --------------------------------------------------------------------

type Tone = 'trigger' | 'input' | 'output' | 'reader' | 'limit';

interface Item {
  label: string;
  /** A path, a script or an id, drawn left to right; or Persian words (`detailRtl`). */
  detail: string | null;
  detailRtl?: boolean;
  tone: Tone;
}

const triggerItem = (n: ConsoleFlowNode<ConsoleFlowTrigger>): Item => ({
  label:
    n.kind === 'schedule'
      ? (SCHEDULE_TRIGGER[n.detail ?? ''] ?? TRIGGER_WORDS.schedule)
      : TRIGGER_WORDS[n.kind],
  detail: null,
  tone: 'trigger',
});

function inputItem(n: ConsoleFlowNode<ConsoleFlowInput>): Item {
  if (n.kind === 'team-reports' && n.detail !== null) {
    const names = n.detail.split(', ');
    return {
      label: INPUT_WORDS[n.kind],
      detail: names.includes('*') ? 'همه‌ی عامل‌ها' : names.map(agentTitle).join('، '),
      detailRtl: true,
      tone: 'input',
    };
  }
  return { label: INPUT_WORDS[n.kind], detail: n.detail, tone: 'input' };
}

const outputItem = (n: ConsoleFlowNode<ConsoleFlowOutput>): Item => ({
  label: OUTPUT_WORDS[n.kind],
  detail: n.detail,
  tone: 'output',
});

const readerItem = (n: ConsoleFlowNode<ConsoleFlowReader>): Item =>
  n.kind === 'agent' && n.detail !== null
    ? { label: agentTitle(n.detail), detail: n.detail, tone: 'reader' }
    : { label: READER_WORDS[n.kind], detail: null, tone: 'reader' };

// --- Geometry ------------------------------------------------------------------

const LABEL = 12.5;
const DETAIL = 10.5;
const LH = 17;
const DLH = 14;
const PAD = 8;
const GAP = 8;
const HEAD = 26;

/** A rough width: Persian letters join narrow, Latin capitals are wide. */
export function textWidth(text: string, size: number): number {
  let em = 0;
  for (const ch of text) {
    if (/\s/.test(ch)) em += 0.3;
    else if (/[\u0600-\u06ff]/.test(ch)) em += 0.48;
    else if (/[A-Z]/.test(ch)) em += 0.66;
    else em += 0.56;
  }
  return em * size;
}

/** Lines of at most `width`, broken after a space or a slash; a word longer than a line is cut. */
export function wrap(text: string, width: number, size: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const token of text.split(/(?<=[ /])/)) {
    if (line !== '' && textWidth(line + token, size) > width) {
      lines.push(line.trimEnd());
      line = '';
    }
    let rest = token;
    while (textWidth(rest, size) > width) {
      let cut = rest.length;
      while (cut > 1 && textWidth(rest.slice(0, cut), size) > width) cut -= 1;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line += rest;
  }
  if (line.trim() !== '') lines.push(line.trimEnd());
  return lines;
}

interface Box extends Item {
  lines: string[];
  detailLines: string[];
  w: number;
  h: number;
}

function measure(item: Item, w: number): Box {
  const lines = wrap(item.label, w - 2 * PAD, LABEL);
  const detailLines = item.detail === null ? [] : wrap(item.detail, w - 2 * PAD, DETAIL);
  return {
    ...item,
    lines,
    detailLines,
    w,
    h: 2 * PAD + lines.length * LH + detailLines.length * DLH,
  };
}

const TONE: Record<Tone, string> = {
  trigger: 'fill-surface stroke-accent',
  input: 'fill-surface-raised stroke-caption',
  output: 'fill-surface-raised stroke-success',
  reader: 'fill-canvas stroke-muted',
  limit: 'fill-canvas stroke-warning',
};

/** A box drawn with its inline-start edge (the right, in Persian) at `right`. */
function BoxView({ box, right, top }: { box: Box; right: number; top: number }) {
  const x = right - box.w;
  return (
    <g>
      <rect
        x={x}
        y={top}
        width={box.w}
        height={box.h}
        rx={6}
        className={TONE[box.tone]}
        strokeWidth={1.25}
        strokeDasharray={box.tone === 'limit' ? '4 3' : undefined}
      />
      {box.lines.map((line, i) => (
        <text
          key={`l${i}`}
          x={right - PAD}
          y={top + PAD + 12.5 + i * LH}
          direction="rtl"
          textAnchor="start"
          fontSize={LABEL}
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
          direction={box.detailRtl === true ? 'rtl' : 'ltr'}
          textAnchor={box.detailRtl === true ? 'start' : 'end'}
          unicodeBidi="isolate"
          fontSize={DETAIL}
          className="fill-muted"
        >
          {/* A path's slashes and dots stay in place inside the right-to-left page. */}
          {box.detailRtl === true ? line : `⁦${line}⁩`}
        </text>
      ))}
    </g>
  );
}

/** Where each of a stack of heights starts, from `top`, with `gap` between. */
function stack(heights: number[], top: number, gap: number): number[] {
  const tops: number[] = [];
  let y = top;
  for (const h of heights) {
    tops.push(y);
    y += h + gap;
  }
  return tops;
}

interface Column {
  title: string;
  boxes: Box[];
  w: number;
  h: number;
}

function column(title: string, items: Item[], w: number): Column {
  const boxes = items.map((item) => measure(item, w));
  const h = HEAD + boxes.reduce((sum, b) => sum + b.h, 0) + GAP * Math.max(0, boxes.length - 1);
  return { title, boxes, w, h };
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

function ColumnView({
  col,
  right,
  top,
  section,
}: {
  col: Column;
  right: number;
  top: number;
  section: string;
}) {
  const tops = stack(
    col.boxes.map((b) => b.h),
    top + HEAD,
    GAP,
  );
  return (
    <g data-section={section}>
      <Title text={col.title} right={right} y={top + 15} />
      {col.boxes.map((box, i) => (
        <BoxView key={i} box={box} right={right} top={tops[i]!} />
      ))}
    </g>
  );
}

/** Chips placed from the inline start, wrapping to a new row. */
interface Band {
  title: string;
  chips: { box: Box; dx: number; dy: number }[];
  w: number;
  h: number;
}

function band(title: string, items: Item[], w: number): Band {
  const inner = w - 2 * PAD;
  const chips: Band['chips'] = [];
  let dx = 0;
  let dy = 0;
  let row = 0;
  for (const item of items) {
    const cw = Math.min(inner, textWidth(item.label, LABEL) + 2 * PAD + 6);
    const box = measure(item, cw);
    if (dx > 0 && dx + cw > inner) {
      dx = 0;
      dy += row + GAP;
      row = 0;
    }
    chips.push({ box, dx, dy });
    dx += cw + GAP;
    row = Math.max(row, box.h);
  }
  return { title, chips, w, h: HEAD + dy + row + PAD };
}

function BandView({
  b,
  right,
  top,
  section,
  framed,
}: {
  b: Band;
  right: number;
  top: number;
  section: string;
  framed: boolean;
}) {
  return (
    <g data-section={section}>
      {framed && (
        <rect
          x={right - b.w}
          y={top}
          width={b.w}
          height={b.h}
          rx={10}
          className="fill-none stroke-warning"
          strokeWidth={1}
          strokeDasharray="6 4"
        />
      )}
      <Title text={b.title} right={right - (framed ? PAD : 0)} y={top + 17} />
      {b.chips.map((chip, i) => (
        <BoxView key={i} box={chip.box} right={right - PAD - chip.dx} top={top + HEAD + chip.dy} />
      ))}
    </g>
  );
}

/** The agent itself: its name and model, and its method's steps in order. */
interface Core {
  w: number;
  h: number;
  title: string;
  model: string;
  steps: { n: string; lines: string[]; h: number }[];
}

const STEP_INDENT = 30;

function core(agent: ConsoleAgent, flow: ConsoleAgentFlow, w: number): Core {
  const steps = flow.steps.map((step, i) => {
    const lines = wrap(step.fa ?? step.text, w - 2 * PAD - STEP_INDENT, LABEL);
    return { n: fa(i + 1), lines, h: Math.max(22, lines.length * LH + 5) };
  });
  const list = steps.reduce((sum, s) => sum + s.h, 0) + 10 * Math.max(0, steps.length - 1);
  return {
    w,
    h: PAD + 20 + 20 + 26 + (steps.length === 0 ? LH : list) + PAD + 4,
    title: agentTitle(agent.name),
    model: agent.model,
    steps,
  };
}

function CoreView({ c, right, top }: { c: Core; right: number; top: number }) {
  const y = top + PAD + 66;
  const tops = stack(
    c.steps.map((s) => s.h),
    y,
    10,
  );
  return (
    <g data-section="method">
      <rect
        x={right - c.w}
        y={top}
        width={c.w}
        height={c.h}
        rx={10}
        className="fill-surface stroke-brand"
        strokeWidth={2}
      />
      <text
        x={right - PAD - 4}
        y={top + PAD + 15}
        direction="rtl"
        textAnchor="start"
        fontSize={15}
        fontWeight={700}
        className="fill-fg"
      >
        {c.title}
      </text>
      <text
        x={right - PAD - 4}
        y={top + PAD + 35}
        direction="rtl"
        textAnchor="start"
        fontSize={12}
        className="fill-muted"
        data-part="model"
      >
        {`مدل: ${c.model}`}
      </text>
      <Title text={SECTION_WORDS.method} right={right - PAD - 4} y={top + PAD + 58} />
      {c.steps.length === 0 ? (
        <text
          x={right - PAD - 4}
          y={y + 12}
          direction="rtl"
          textAnchor="start"
          fontSize={LABEL}
          className="fill-caption"
        >
          گام‌ها با به‌روزرسانی بعدی رایانه دیده می‌شوند.
        </text>
      ) : (
        c.steps.map((step, i) => {
          const at = tops[i]!;
          const cx = right - PAD - 11;
          return (
            <g key={i} data-part="step">
              {i > 0 && (
                <line
                  x1={cx}
                  y1={at - 10}
                  x2={cx}
                  y2={at}
                  className="stroke-brand"
                  strokeWidth={1.5}
                />
              )}
              <circle cx={cx} cy={at + 11} r={10} className="fill-brand" />
              <text
                x={cx}
                y={at + 15}
                textAnchor="middle"
                fontSize={11}
                fontWeight={700}
                className="fill-on-brand"
              >
                {step.n}
              </text>
              {step.lines.map((line, j) => (
                <text
                  key={j}
                  x={right - PAD - STEP_INDENT}
                  y={at + 15 + j * LH}
                  direction="rtl"
                  textAnchor="start"
                  fontSize={LABEL}
                  className="fill-fg"
                >
                  {line}
                </text>
              ))}
            </g>
          );
        })
      )}
    </g>
  );
}

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

const LEGEND: { tone: Tone | 'step' | 'arrow'; label: string }[] = [
  { tone: 'trigger', label: 'آغازگر' },
  { tone: 'input', label: 'ورودی' },
  { tone: 'step', label: 'گام روش' },
  { tone: 'output', label: 'خروجی' },
  { tone: 'reader', label: 'خواننده' },
  { tone: 'limit', label: 'مرز' },
  { tone: 'arrow', label: 'جهت کار' },
];

function legend(w: number): {
  h: number;
  rows: { label: string; tone: string; dx: number; dy: number }[];
} {
  const rows: { label: string; tone: string; dx: number; dy: number }[] = [];
  let dx = 0;
  let dy = 0;
  for (const entry of LEGEND) {
    const ew = 26 + textWidth(entry.label, 11.5) + 18;
    if (dx > 0 && dx + ew > w) {
      dx = 0;
      dy += 20;
    }
    rows.push({ label: entry.label, tone: entry.tone, dx, dy });
    dx += ew;
  }
  return { h: HEAD + dy + 16, rows };
}

function LegendView({ id, w, right, top }: { id: string; w: number; right: number; top: number }) {
  const { rows } = legend(w);
  return (
    <g data-section="legend">
      <Title text={SECTION_WORDS.legend} right={right} y={top + 15} />
      {rows.map((row) => {
        const x = right - row.dx;
        const y = top + HEAD + row.dy;
        return (
          <g key={row.label}>
            {row.tone === 'arrow' ? (
              <Arrow id={id} x1={x} y1={y + 5} x2={x - 20} y2={y + 5} />
            ) : row.tone === 'step' ? (
              <circle cx={x - 8} cy={y + 5} r={6} className="fill-brand" />
            ) : (
              <rect
                x={x - 20}
                y={y}
                width={20}
                height={11}
                rx={3}
                className={TONE[row.tone as Tone]}
                strokeWidth={1.25}
                strokeDasharray={row.tone === 'limit' ? '3 2' : undefined}
              />
            )}
            <text
              x={x - 26}
              y={y + 9.5}
              direction="rtl"
              textAnchor="start"
              fontSize={11.5}
              className="fill-muted"
            >
              {row.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

// --- The two drawings ------------------------------------------------------------

const M = 16;

function Drawing({
  agent,
  flow,
  layout,
}: {
  agent: ConsoleAgent;
  flow: ConsoleAgentFlow;
  layout: 'wide' | 'narrow';
}) {
  const id = `schematic-${agent.name.replace(/[^a-z0-9-]/g, '')}-${layout}`;
  const wide = layout === 'wide';
  const W = wide ? 1048 : 360;
  const inner = W - 2 * M;
  const right = W - M;
  const triggers = band(SECTION_WORDS.triggers, flow.triggers.map(triggerItem), inner);
  const limits = band(
    SECTION_WORDS.limits,
    flow.limits.map((n) => ({ label: LIMIT_WORDS[n.kind], detail: null, tone: 'limit' as const })),
    inner,
  );
  const leg = legend(inner);
  const parts: ReactNode[] = [];
  let y = M;
  parts.push(
    <BandView key="t" b={triggers} right={right} top={y} section="triggers" framed={false} />,
  );
  y += triggers.h;

  if (wide) {
    // Right to left: inputs, the agent, outputs, readers.
    const widths = [230, 270, 230, 190];
    const gap = (inner - widths.reduce((a, b) => a + b, 0)) / 3;
    const ins = column(SECTION_WORDS.inputs, flow.inputs.map(inputItem), widths[0]!);
    const c = core(agent, flow, widths[1]!);
    const outs = column(SECTION_WORDS.outputs, flow.outputs.map(outputItem), widths[2]!);
    const reads = column(SECTION_WORDS.readers, flow.readers.map(readerItem), widths[3]!);
    const rights = [right];
    for (let i = 1; i < 4; i += 1) rights.push(rights[i - 1]! - widths[i - 1]! - gap);
    const top = y + 30;
    const coreTop = top + HEAD;
    const coreMid = rights[1]! - widths[1]! / 2;
    parts.push(<Arrow key="a0" id={id} x1={coreMid} y1={y + 2} x2={coreMid} y2={coreTop - 3} />);
    parts.push(<ColumnView key="i" col={ins} right={rights[0]!} top={top} section="inputs" />);
    parts.push(<CoreView key="c" c={c} right={rights[1]!} top={coreTop} />);
    parts.push(<ColumnView key="o" col={outs} right={rights[2]!} top={top} section="outputs" />);
    parts.push(<ColumnView key="r" col={reads} right={rights[3]!} top={top} section="readers" />);
    const heights = [ins.h, c.h + HEAD, outs.h, reads.h];
    for (let i = 0; i < 3; i += 1) {
      const ay = top + HEAD + Math.min(heights[i]!, heights[i + 1]!, 120) / 2 - 6;
      const from = rights[i]! - widths[i]! - 4;
      parts.push(<Arrow key={`g${i}`} id={id} x1={from} y1={ay} x2={rights[i + 1]! + 4} y2={ay} />);
    }
    y = top + Math.max(...heights) + 24;
  } else {
    // Top to bottom, each part as wide as the phone.
    const down = (key: string) => {
      parts.push(<Arrow key={key} id={id} x1={W / 2} y1={y + 2} x2={W / 2} y2={y + 24} />);
      y += 30;
    };
    down('d0');
    const ins = column(SECTION_WORDS.inputs, flow.inputs.map(inputItem), inner);
    parts.push(<ColumnView key="i" col={ins} right={right} top={y} section="inputs" />);
    y += ins.h;
    down('d1');
    const c = core(agent, flow, inner);
    parts.push(<CoreView key="c" c={c} right={right} top={y} />);
    y += c.h;
    down('d2');
    const outs = column(SECTION_WORDS.outputs, flow.outputs.map(outputItem), inner);
    parts.push(<ColumnView key="o" col={outs} right={right} top={y} section="outputs" />);
    y += outs.h;
    down('d3');
    const reads = column(SECTION_WORDS.readers, flow.readers.map(readerItem), inner);
    parts.push(<ColumnView key="r" col={reads} right={right} top={y} section="readers" />);
    y += reads.h + 24;
  }

  parts.push(<BandView key="l" b={limits} right={right} top={y} section="limits" framed />);
  y += limits.h + 20;
  parts.push(<LegendView key="g" id={id} w={inner} right={right} top={y} />);
  y += leg.h + M;

  return (
    <svg
      viewBox={`0 0 ${W} ${Math.ceil(y)}`}
      role="img"
      aria-labelledby={`${id}-title ${id}-desc`}
      direction="rtl"
      className="block h-auto w-full"
      data-layout={layout}
    >
      <title id={`${id}-title`}>{`چطور ${agentTitle(agent.name)} کار می‌کند`}</title>
      <desc id={`${id}-desc`}>
        {`${fa(flow.triggers.length)} آغازگر، ${fa(flow.inputs.length)} ورودی، ${fa(flow.steps.length)} گام، ${fa(flow.limits.length)} مرز، ${fa(flow.outputs.length)} خروجی و ${fa(flow.readers.length)} خواننده.`}
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
      {parts}
    </svg>
  );
}

/** The agent page's schematic: columns from 640 px, stacked below (Tailwind's `sm`). */
export function AgentSchematic({ agent }: { agent: ConsoleAgent }) {
  const flow = flowFor(agent);
  return (
    <div data-testid="schematic">
      <div className="hidden sm:block">
        <Drawing agent={agent} flow={flow} layout="wide" />
      </div>
      <div className="sm:hidden">
        <Drawing agent={agent} flow={flow} layout="narrow" />
      </div>
    </div>
  );
}
