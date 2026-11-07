import type {
  ConsoleAgentFlow,
  ConsoleFlowInput,
  ConsoleFlowLimit,
  ConsoleFlowNode,
  ConsoleFlowOutput,
  ConsoleFlowReader,
  ConsoleFlowStep,
  ConsoleFlowTrigger,
} from '@fmip/contracts';
import type { AgentFile } from './snapshot.ts';

/**
 * How each agent works, for the console's schematic (T-1725, D-352): pure
 * functions over the agent's file, its skill and the team charter, so every
 * box the console draws is something those files say. What the files do not
 * state is in `FLOW_FALLBACK`, by hand, and nothing beyond it.
 */

// --- The charter ------------------------------------------------------------

export interface Charter {
  /** Each agent's schedule from the charter's "Schedules" table. */
  schedules: Record<string, string>;
  /** Each agent's finding prefix from "The finding format". */
  prefixes: Record<string, string>;
  /** The marketing wing: its manager and the agents it sets priorities for. */
  wing: { manager: string | null; members: string[] };
}

/** A `## heading` section's text, up to the next `## `, or '' when there is none. */
export function sectionOf(markdown: string, heading: RegExp): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s/.test(line) && heading.test(line.slice(3)));
  if (start === -1) return '';
  const end = lines.findIndex((line, i) => i > start && /^##\s/.test(line));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
}

const SCHEDULE_OF = (cell: string): string | null => {
  const word = cell.trim().toLowerCase();
  if (word.startsWith('daily')) return 'daily';
  if (word.startsWith('weekly')) return 'weekly';
  if (word.startsWith('monthly')) return 'monthly';
  if (/^on[ -]demand/.test(word)) return 'on-demand';
  return null;
};

/** The charter's schedules, prefixes and marketing wing, for the agents that exist. */
export function parseCharter(text: string, agents: readonly string[]): Charter {
  const named = (cell: string) =>
    agents.filter((a) => new RegExp(`(^|[^\\w-])${a}([^\\w-]|$)`).test(cell));
  const schedules: Record<string, string> = {};
  for (const row of sectionOf(text, /^Schedules\b/).split(/\r?\n/)) {
    const cells = row.split('|').map((cell) => cell.trim());
    const schedule = cells.length >= 3 ? SCHEDULE_OF(cells[1]!) : null;
    if (schedule === null) continue;
    for (const agent of named(cells[2]!)) schedules[agent] ??= schedule;
  }
  const prefixes: Record<string, string> = {};
  for (const match of sectionOf(text, /^The finding format\b/).matchAll(
    /`([a-z]+)`\s*\(([a-z-]+)\)/g,
  )) {
    if (agents.includes(match[2]!)) prefixes[match[2]!] = match[1]!;
  }
  const wingText =
    sectionOf(text, /^The marketing wing\b/)
      .split(/\r?\n\s*\r?\n/)
      .find((p) => p.trim() !== '') ?? '';
  const manager = /`([a-z-]+)`\s+owns\b/.exec(wingText)?.[1] ?? null;
  const members = [...wingText.matchAll(/`([a-z-]+)`/g)]
    .map((m) => m[1]!)
    .filter((name, i, all) => name !== manager && agents.includes(name) && all.indexOf(name) === i);
  return {
    schedules,
    prefixes,
    wing: { manager: manager !== null && agents.includes(manager) ? manager : null, members },
  };
}

// --- Steps --------------------------------------------------------------------

/** Sections that are rules, inputs or reference, never the method's steps. */
const NOT_STEPS =
  /^(hard rules|rules of this role|the golden set|inputs\b|the schema|adding a check|the labels|the system you design in|what the database|where the site says|what is already posted|practicalities|proposals, never actions|the questions)/i;

/** A list item's short name: its bold lead, else its first clause, without markdown. */
export function stepLabel(item: string): string {
  const bold = /^\*\*(.+?)\*\*/.exec(item.trim());
  const raw = bold !== null ? bold[1]! : (item.split(/(?<=[^.]\.)\s|:\s|;\s/)[0] ?? item);
  const label = raw
    .replace(/`/g, '')
    .replace(/\*\*/g, '')
    .replace(/[\s.,:;]+$/, '')
    .trim();
  return label.length > 90 ? `${label.slice(0, 89).trimEnd()}…` : label;
}

interface Section {
  heading: string;
  body: string[];
}

function sections(markdown: string): Section[] {
  const out: Section[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading !== null) out.push({ heading: heading[1]!.trim(), body: [] });
    else out.at(-1)?.body.push(line);
  }
  return out;
}

const numbered = (body: string[]) =>
  body
    .map((line) => /^\d+\.\s+(.+)$/.exec(line)?.[1])
    .filter((item): item is string => item !== undefined);
const boldBullets = (body: string[]) =>
  body
    .map((line) => /^-\s+(\*\*.+)$/.exec(line)?.[1])
    .filter((item): item is string => item !== undefined);
const subheadings = (body: string[]) =>
  body
    .map((line) => /^###\s+(?:\d+\.\s*)?(.+)$/.exec(line)?.[1])
    .filter((item): item is string => item !== undefined);

/**
 * The method's steps from an agent's skill (D-349's `stepsOf`, made to find
 * the method's own list): the `###` steps under `## Steps`; else the
 * numbered list of the section named for its schedule ("Daily", "Weekly"…),
 * or of the first section that is a method; else that section's bold
 * bullets; else the method sections' headings. `headings` forces the last.
 */
export function flowStepsOf(skill: string, schedule: string, headings = false): string[] {
  const all = sections(skill);
  const method = all.filter((s) => !NOT_STEPS.test(s.heading));
  if (!headings) {
    const steps = all.find((s) => /^steps\b/i.test(s.heading));
    if (steps !== undefined) {
      const found = subheadings(steps.body);
      const list = found.length > 0 ? found : numbered(steps.body);
      if (list.length > 0) return list.map(stepLabel).slice(0, 8);
    }
    const scheduled = method.find((s) =>
      s.heading.toLowerCase().includes(schedule.replace('-', ' ')),
    );
    const ordered =
      scheduled === undefined ? method : [scheduled, ...method.filter((s) => s !== scheduled)];
    for (const pick of [numbered, boldBullets]) {
      for (const section of ordered) {
        const list = pick(section.body);
        if (list.length >= 2) return list.map(stepLabel).slice(0, 8);
      }
    }
  }
  return all
    .filter((s) => !/^(hard rules|rules of this role|the golden set)/i.test(s.heading))
    .map((s) =>
      s.heading
        .replace(/:\s*`.*$/, '')
        .replace(/\s*\([^)]*\)\s*$/, '')
        .replace(/`/g, '')
        .trim(),
    )
    .slice(0, 8);
}

/** A step's key in `STEP_WORDS`: its first twelve words, lower case, without punctuation. */
export const stepKey = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 12)
    .join(' ');

/**
 * Each step's Persian, keyed by `stepKey` of the step as the skill writes
 * it (technical words stay English). A step whose skill changed shows as
 * written until it is added here; a publisher test reads the real skills and
 * fails on such a step.
 */
export const STEP_WORDS: Record<string, string> = {
  // architect \u00b7 fmip-architecture
  'read what exists narrowly':
    '\u062e\u0648\u0627\u0646\u062f\u0646 \u0647\u062f\u0641\u0645\u0646\u062f \u0622\u0646\u0686\u0647 \u0647\u0633\u062a (\u0646\u0642\u0634\u0647\u200c\u06cc \u067e\u0631\u0648\u0698\u0647\u060c \u0645\u0639\u0645\u0627\u0631\u06cc)',
  'state the problem':
    '\u0628\u06cc\u0627\u0646 \u0645\u0633\u0626\u0644\u0647 \u0628\u0627 \u0634\u0627\u0647\u062f\u0634',
  'two or three options':
    '\u062f\u0648 \u06cc\u0627 \u0633\u0647 \u06af\u0632\u06cc\u0646\u0647 \u0628\u0627 \u0647\u0632\u06cc\u0646\u0647 \u0648 \u067e\u06cc\u0627\u0645\u062f \u0647\u0631\u06a9\u062f\u0627\u0645',
  'a recommendation':
    '\u067e\u06cc\u0634\u0646\u0647\u0627\u062f \u0648 \u067e\u06cc\u0634\u200c\u0646\u0648\u06cc\u0633 \u062a\u0635\u0645\u06cc\u0645 (D-xxx)',
  'what to ask the maintainer':
    '\u067e\u0631\u0633\u0634\u200c\u0647\u0627\u06cc\u06cc \u06a9\u0647 \u0628\u0627\u06cc\u062f \u0627\u0632 \u0646\u06af\u0647\u062f\u0627\u0631\u0646\u062f\u0647 \u067e\u0631\u0633\u06cc\u062f',
  // business-adviser \u00b7 business-advice
  'the licence register':
    '\u062f\u0641\u062a\u0631 \u0645\u062c\u0648\u0632\u0647\u0627\u06cc \u0645\u0646\u0627\u0628\u0639 \u062f\u0627\u062f\u0647\u060c \u062e\u0628\u0631 \u0648 \u062a\u0635\u0648\u06cc\u0631',
  costs:
    '\u0647\u0632\u06cc\u0646\u0647\u200c\u0647\u0627 \u0648 \u0631\u0648\u0646\u062f\u0634\u0627\u0646',
  privacy:
    '\u062d\u0631\u06cc\u0645 \u062e\u0635\u0648\u0635\u06cc \u0627\u0639\u0636\u0627 (UK GDPR)',
  // chief-of-staff \u00b7 daily-brief
  inputs:
    '\u062e\u0648\u0627\u0646\u062f\u0646 \u0648\u0631\u0648\u062f\u06cc\u200c\u0647\u0627: \u06cc\u0627\u0641\u062a\u0647\u200c\u0647\u0627\u060c \u06af\u0632\u0627\u0631\u0634\u200c\u0647\u0627\u060c PR\u0647\u0627 \u0648 \u06a9\u0627\u0631\u0647\u0627\u06cc \u0628\u0627\u0632',
  'the decision desk':
    '\u0645\u06cc\u0632 \u062a\u0635\u0645\u06cc\u0645: \u067e\u0627\u0633\u062e\u200c\u0647\u0627 \u0648 \u067e\u0631\u0633\u0634\u200c\u0647\u0627\u06cc \u062a\u0627\u0632\u0647',
  'the decisions ledger':
    '\u062f\u0641\u062a\u0631 \u062a\u0635\u0645\u06cc\u0645\u200c\u0647\u0627',
  'the brief':
    '\u0646\u0648\u0634\u062a\u0646 \u062e\u0644\u0627\u0635\u0647\u200c\u06cc \u0631\u0648\u0632 \u062f\u0631 \u06cc\u06a9 \u0635\u0641\u062d\u0647',
  'saturday the weekly':
    '\u0634\u0646\u0628\u0647\u200c\u0647\u0627: \u0645\u0631\u0648\u0631 \u0647\u0641\u062a\u06af\u06cc\u060c \u0628\u0631\u0646\u0627\u0645\u0647 \u0648 \u0631\u06cc\u0633\u06a9\u200c\u0647\u0627',
  // code-reviewer \u00b7 fmip-review
  scope: '\u062f\u0627\u0645\u0646\u0647\u200c\u06cc \u062a\u063a\u06cc\u06cc\u0631 (git diff)',
  'mechanical checks':
    '\u0628\u0631\u0631\u0633\u06cc\u200c\u0647\u0627\u06cc \u062e\u0648\u062f\u06a9\u0627\u0631 (review-checks.sh)',
  'read the diff':
    '\u062e\u0648\u0627\u0646\u062f\u0646 diff\u060c \u0641\u0627\u06cc\u0644 \u0628\u0647 \u0641\u0627\u06cc\u0644',
  'run what proves it cheaply':
    '\u0627\u062c\u0631\u0627\u06cc \u0627\u0631\u0632\u0627\u0646\u200c\u062a\u0631\u06cc\u0646 \u0622\u0632\u0645\u0648\u0646\u06cc \u06a9\u0647 \u062f\u0631\u0633\u062a\u06cc \u0631\u0627 \u0646\u0634\u0627\u0646 \u062f\u0647\u062f',
  verdict:
    '\u062d\u06a9\u0645 \u0646\u0647\u0627\u06cc\u06cc: APPROVE \u06cc\u0627 CHANGES REQUESTED',
  // content-community \u00b7 content-watch
  'bash claude skills data audit run sh claude skills content watch content':
    '\u0627\u062c\u0631\u0627\u06cc \u067e\u0631\u0633\u200c\u0648\u062c\u0648\u0647\u0627\u06cc \u0641\u0642\u0637\u200c\u062e\u0648\u0627\u0646\u062f\u0646\u06cc content-watch.sql',
  'read en news and fa news the first 30 headlines each through':
    '\u062e\u0648\u0627\u0646\u062f\u0646 \u06f3\u06f0 \u062a\u06cc\u062a\u0631 \u0627\u0648\u0644 \u062e\u0628\u0631\u0647\u0627\u06cc en \u0648 fa \u062f\u0631 \u0645\u0631\u0648\u0631\u06af\u0631 \u062f\u0627\u062e\u0644\u06cc',
  'write findings prefix cnt for':
    '\u0646\u0648\u0634\u062a\u0646 \u06cc\u0627\u0641\u062a\u0647\u200c\u0647\u0627 (\u067e\u06cc\u0634\u0648\u0646\u062f cnt)',
  // data-auditor \u00b7 data-audit
  'run the invariants':
    '\u0627\u062c\u0631\u0627\u06cc \u0628\u0631\u0631\u0633\u06cc\u200c\u0647\u0627\u06cc \u062b\u0627\u0628\u062a \u062f\u0627\u062f\u0647 (invariants)',
  triage:
    '\u062f\u0633\u062a\u0647\u200c\u0628\u0646\u062f\u06cc \u0648 \u0627\u0648\u0644\u0648\u06cc\u062a\u200c\u0628\u0646\u062f\u06cc \u0622\u0646\u0686\u0647 \u067e\u06cc\u062f\u0627 \u0634\u062f',
  'spot check the live site':
    '\u0633\u0646\u062c\u0634 \u0646\u0645\u0648\u0646\u0647\u200c\u0627\u06cc \u0633\u0627\u06cc\u062a \u0632\u0646\u062f\u0647',
  'findings and report':
    '\u06cc\u0627\u0641\u062a\u0647\u200c\u0647\u0627 \u0648 \u06af\u0632\u0627\u0631\u0634',
  // designer \u00b7 fmip-design
  'read the request the page as it is today the live site':
    '\u062e\u0648\u0627\u0646\u062f\u0646 \u062f\u0631\u062e\u0648\u0627\u0633\u062a\u060c \u0635\u0641\u062d\u0647\u200c\u06cc \u0627\u0645\u0631\u0648\u0632 (\u0647\u0631 \u062f\u0648 \u0632\u0628\u0627\u0646) \u0648 \u062f\u0627\u062f\u0647\u200c\u0627\u0634',
  'draw it on a design canvas the artifact tool':
    '\u0637\u0631\u0627\u062d\u06cc \u0631\u0648\u06cc \u0628\u0648\u0645 Design (\u0627\u0628\u0632\u0627\u0631 Artifact)',
  'write beside it what changes for the user which components and tokens':
    '\u0646\u0648\u0634\u062a\u0646 \u0622\u0646\u0686\u0647 \u0628\u0631\u0627\u06cc \u06a9\u0627\u0631\u0628\u0631 \u0639\u0648\u0636 \u0645\u06cc\u200c\u0634\u0648\u062f\u060c \u0628\u0627 \u0627\u062c\u0632\u0627 \u0648 \u062a\u0648\u06a9\u0646\u200c\u0647\u0627',
  'the maintainer approves the design before it is built':
    '\u062a\u0623\u06cc\u06cc\u062f \u0646\u06af\u0647\u062f\u0627\u0631\u0646\u062f\u0647 \u067e\u06cc\u0634 \u0627\u0632 \u0633\u0627\u062e\u062a',
  // growth-analyst \u00b7 growth-funnel
  'bash claude skills data audit run sh claude skills growth funnel growth':
    '\u0627\u062c\u0631\u0627\u06cc \u067e\u0631\u0633\u200c\u0648\u062c\u0648\u0647\u0627\u06cc \u0641\u0642\u0637\u200c\u062e\u0648\u0627\u0646\u062f\u0646\u06cc growth-funnel.sql',
  'compare with last week s report e fmip ops reports growth analyst':
    '\u0645\u0642\u0627\u06cc\u0633\u0647 \u0628\u0627 \u06af\u0632\u0627\u0631\u0634 \u0647\u0641\u062a\u0647\u200c\u06cc \u067e\u06cc\u0634 \u0648 snapshot \u062f\u0627\u0634\u0628\u0648\u0631\u062f',
  'read the marketing calendar':
    '\u062e\u0648\u0627\u0646\u062f\u0646 \u062a\u0642\u0648\u06cc\u0645 \u0628\u0627\u0632\u0627\u0631\u06cc\u0627\u0628\u06cc',
  'write findings prefix gro':
    '\u0646\u0648\u0634\u062a\u0646 \u06cc\u0627\u0641\u062a\u0647\u200c\u0647\u0627 (\u067e\u06cc\u0634\u0648\u0646\u062f gro)',
  // marketing-manager \u00b7 marketing-plan
  audience:
    '\u0645\u062e\u0627\u0637\u0628: \u062f\u0648 \u06cc\u0627 \u0633\u0647 \u06af\u0631\u0648\u0647',
  'positioning and message': '\u062c\u0627\u06cc\u06af\u0627\u0647 \u0648 \u067e\u06cc\u0627\u0645',
  channels: '\u06a9\u0627\u0646\u0627\u0644\u200c\u0647\u0627',
  'campaign calendar':
    '\u062a\u0642\u0648\u06cc\u0645 \u06a9\u0645\u067e\u06cc\u0646 \u0686\u0647\u0627\u0631 \u0647\u0641\u062a\u0647\u200c\u06cc \u0622\u06cc\u0646\u062f\u0647',
  measures:
    '\u0633\u0646\u062c\u0647\u200c\u0647\u0627 \u0648 \u062e\u0637 \u067e\u0627\u06cc\u0647',
  // model-scientist \u00b7 model-watch
  'bash claude skills data audit run sh claude skills model watch model':
    '\u0627\u062c\u0631\u0627\u06cc \u067e\u0631\u0633\u200c\u0648\u062c\u0648\u0647\u0627\u06cc \u0641\u0642\u0637\u200c\u062e\u0648\u0627\u0646\u062f\u0646\u06cc model-watch.sql',
  'judge and write findings prefix mod for':
    '\u062f\u0627\u0648\u0631\u06cc \u0648 \u0646\u0648\u0634\u062a\u0646 \u06cc\u0627\u0641\u062a\u0647\u200c\u0647\u0627 (\u067e\u06cc\u0634\u0648\u0646\u062f mod)',
  'write e fmip ops reports model scientist date md in persian':
    '\u0646\u0648\u0634\u062a\u0646 \u06af\u0632\u0627\u0631\u0634 \u0641\u0627\u0631\u0633\u06cc: \u062c\u062f\u0648\u0644 \u0646\u0633\u062e\u0647\u200c\u0647\u0627 \u0648 \u062d\u06a9\u0645\u200c\u0647\u0627',
  'record every verdict in the lab s ledger':
    '\u062b\u0628\u062a \u0647\u0631 \u062d\u06a9\u0645 \u062f\u0631 \u062f\u0641\u062a\u0631 \u0622\u0632\u0645\u0627\u06cc\u0634\u06af\u0627\u0647 (ledger.json) \u0648 \u0627\u062c\u0631\u0627\u06cc lab-check',
  // ops-release \u00b7 ops-check
  'bash claude skills ops check ops check sh':
    '\u0627\u062c\u0631\u0627\u06cc ops-check.sh (snapshot \u0641\u0642\u0637\u200c\u062e\u0648\u0627\u0646\u062f\u0646\u06cc \u0633\u0631\u0648\u0631)',
  'compare with the newest snapshot from an earlier utc day and for':
    '\u0645\u0642\u0627\u06cc\u0633\u0647 \u0628\u0627 snapshot \u0631\u0648\u0632 \u067e\u06cc\u0634 \u0648 \u0631\u0648\u0646\u062f\u0647\u0627 (\u062f\u06cc\u0633\u06a9\u060c build cache)',
  'judge each section against the thresholds below':
    '\u0633\u0646\u062c\u0634 \u0647\u0631 \u0628\u062e\u0634 \u0628\u0627 \u0622\u0633\u062a\u0627\u0646\u0647\u200c\u0647\u0627',
  'write e fmip ops reports ops release date md in persian':
    '\u0646\u0648\u0634\u062a\u0646 \u06af\u0632\u0627\u0631\u0634 \u0641\u0627\u0631\u0633\u06cc \u0628\u0627 \u0686\u0631\u0627\u063a \u0648\u0636\u0639\u06cc\u062a',
  // product-strategist \u00b7 product-strategy
  'read docs product blueprint md and the current phase s task files':
    '\u062e\u0648\u0627\u0646\u062f\u0646 blueprint \u0645\u062d\u0635\u0648\u0644 \u0648 \u062c\u062f\u0648\u0644 \u06a9\u0627\u0631\u0647\u0627\u06cc \u0641\u0627\u0632 \u062c\u0627\u0631\u06cc',
  'write it as a task row in english even inside a persian':
    '\u0646\u0648\u0634\u062a\u0646 \u062f\u0631\u062e\u0648\u0627\u0633\u062a \u0628\u0647 \u0634\u06a9\u0644 \u06cc\u06a9 \u0631\u062f\u06cc\u0641 \u06a9\u0627\u0631 \u0628\u0627 \u0645\u0639\u06cc\u0627\u0631 \u067e\u0630\u06cc\u0631\u0634',
  'list what must be decided and by whom':
    '\u0622\u0646\u0686\u0647 \u0628\u0627\u06cc\u062f \u062a\u0635\u0645\u06cc\u0645 \u06af\u0631\u0641\u062a\u0647 \u0634\u0648\u062f \u0648 \u0628\u0647 \u062f\u0633\u062a \u0686\u0647 \u06a9\u0633\u06cc',
  'say what it is worth':
    '\u0627\u0631\u0632\u0634 \u06a9\u0627\u0631: \u0686\u0647 \u06a9\u0633\u06cc \u0633\u0648\u062f \u0645\u06cc\u200c\u0628\u0631\u062f \u0648 \u0627\u0631\u0632\u0627\u0646\u200c\u062a\u0631\u06cc\u0646 \u0646\u0633\u062e\u0647',
  // qa-engineer \u00b7 fmip-qa
  'a on a pull request':
    '\u0627\u0644\u0641. \u0631\u0648\u06cc \u0647\u0631 PR: \u0622\u0632\u0645\u0648\u0646\u200c\u0647\u0627\u06cc \u062a\u063a\u06cc\u06cc\u0631',
  'b the daily smoke walk':
    '\u0628. \u06af\u0634\u062a \u0631\u0648\u0632\u0627\u0646\u0647 \u062f\u0631 \u0633\u0627\u06cc\u062a \u0632\u0646\u062f\u0647',
  'c release screenshots':
    '\u062c. \u0627\u0633\u06a9\u0631\u06cc\u0646\u200c\u0634\u0627\u062a\u200c\u0647\u0627\u06cc \u067e\u06cc\u0634 \u0627\u0632 \u0627\u0646\u062a\u0634\u0627\u0631',
  report: '\u06af\u0632\u0627\u0631\u0634',
  // security \u00b7 fmip-security
  'on a pull request':
    '\u0631\u0648\u06cc \u0647\u0631 PR: \u067e\u0631\u0633\u0634\u200c\u0647\u0627\u06cc \u0627\u0645\u0646\u06cc\u062a\u06cc',
  'weekly the server and the site':
    '\u0628\u0631\u0631\u0633\u06cc \u062f\u0648\u0631\u0647\u200c\u0627\u06cc \u0633\u0631\u0648\u0631 \u0648 \u0633\u0627\u06cc\u062a (server-hardening.sh)',
  // seo-search \u00b7 search-visibility
  'bash claude skills product strategy seo check sh':
    '\u0627\u062c\u0631\u0627\u06cc seo-check.sh: robots\u060c sitemap \u0648 \u0635\u0641\u062d\u0647\u200c\u0647\u0627\u06cc \u06a9\u0644\u06cc\u062f\u06cc',
  'bash claude skills search visibility structured data sh':
    '\u0627\u062c\u0631\u0627\u06cc structured-data.sh: \u062f\u0627\u062f\u0647\u200c\u06cc \u0633\u0627\u062e\u062a\u0627\u0631\u06cc\u0627\u0641\u062a\u0647\u200c\u06cc \u0647\u0631 \u0635\u0641\u062d\u0647',
  'keywords per language':
    '\u06a9\u0644\u06cc\u062f\u0648\u0627\u0698\u0647\u200c\u0647\u0627 \u0628\u0631\u0627\u06cc \u0647\u0631 \u0632\u0628\u0627\u0646',
  'ai answer visibility':
    '\u062f\u06cc\u062f\u0647\u200c\u0634\u062f\u0646 \u062f\u0631 \u067e\u0627\u0633\u062e\u200c\u0647\u0627\u06cc \u0647\u0648\u0634 \u0645\u0635\u0646\u0648\u0639\u06cc',
  'write findings prefix seo with the exact url in evidence':
    '\u0646\u0648\u0634\u062a\u0646 \u06cc\u0627\u0641\u062a\u0647\u200c\u0647\u0627 (\u067e\u06cc\u0634\u0648\u0646\u062f seo) \u0628\u0627 URL \u062f\u0642\u06cc\u0642',
  // social-media \u00b7 social-drafts
  'bash claude skills data audit run sh claude skills social drafts social':
    '\u0627\u062c\u0631\u0627\u06cc \u067e\u0631\u0633\u200c\u0648\u062c\u0648\u0647\u0627\u06cc \u0641\u0642\u0637\u200c\u062e\u0648\u0627\u0646\u062f\u0646\u06cc social-drafts.sql',
  'is there anything worth posting':
    '\u0622\u06cc\u0627 \u0627\u0645\u0631\u0648\u0632 \u0686\u06cc\u0632\u06cc \u0627\u0631\u0632\u0634 \u067e\u0633\u062a \u062f\u0627\u0631\u062f\u061f',
  'read the facts from the live site in the built in browser':
    '\u062e\u0648\u0627\u0646\u062f\u0646 \u0648\u0627\u0642\u0639\u06cc\u062a\u200c\u0647\u0627 \u0627\u0632 \u0633\u0627\u06cc\u062a \u0632\u0646\u062f\u0647 \u062f\u0631 \u0645\u0631\u0648\u0631\u06af\u0631 \u062f\u0627\u062e\u0644\u06cc',
  'write the drafts':
    '\u0646\u0648\u0634\u062a\u0646 \u067e\u06cc\u0634\u200c\u0646\u0648\u06cc\u0633\u200c\u0647\u0627 \u0628\u0631\u0627\u06cc \u062a\u0623\u06cc\u06cc\u062f \u0646\u06af\u0647\u062f\u0627\u0631\u0646\u062f\u0647',
  'findings prefix soc only for what stops a good draft':
    '\u06cc\u0627\u0641\u062a\u0647\u200c\u0647\u0627 (\u067e\u06cc\u0634\u0648\u0646\u062f soc) \u0641\u0642\u0637 \u0628\u0631\u0627\u06cc \u0622\u0646\u0686\u0647 \u062c\u0644\u0648\u06cc \u067e\u06cc\u0634\u200c\u0646\u0648\u06cc\u0633 \u062e\u0648\u0628 \u0631\u0627 \u0645\u06cc\u200c\u06af\u06cc\u0631\u062f',
};

const hasLatin = (text: string) => /[A-Za-z]/.test(text);

/** A step with its Persian: from `STEP_WORDS`, or itself when it is already Persian. */
export function stepOf(text: string): ConsoleFlowStep {
  return { text, fa: STEP_WORDS[stepKey(text)] ?? (hasLatin(text) ? null : text) };
}

// --- The flow -----------------------------------------------------------------

/** What the files do not say, by hand (D-352); never a capability the agent lacks. */
export const FLOW_FALLBACK: Record<
  string,
  {
    headings?: boolean;
    inputs?: ConsoleFlowNode<ConsoleFlowInput>[];
    outputs?: ConsoleFlowNode<ConsoleFlowOutput>[];
  }
> = {
  // The brief's skill lists the brief's sections; its method is its sections.
  'chief-of-staff': {
    headings: true,
    // The charter's folders: "raid.md  risks, assumptions, issues, dependencies (chief of staff)".
    outputs: [{ kind: 'ops-file', detail: 'E:/FMIP/ops/raid.md' }],
  },
  // Skills of several modes whose scheduled one is a table, not a list: the modes are the steps.
  'qa-engineer': { headings: true },
  security: { headings: true },
};

export interface FlowSource {
  file: AgentFile;
  skills: string[];
  /** The agent's own method: its first skill's text, or '' when it has none. */
  skillText: string;
  schedule: string;
}

const node = <K extends string>(kind: K, detail: string | null = null): ConsoleFlowNode<K> => ({
  kind,
  detail,
});

const unique = <K extends string>(nodes: ConsoleFlowNode<K>[]): ConsoleFlowNode<K>[] =>
  nodes.filter((n, i) => nodes.findIndex((m) => m.kind === n.kind && m.detail === n.detail) === i);

const oneLine = (text: string) => text.replace(/\s+/g, ' ');

/** The paragraphs of an agent's file that say what it never does, each on one line. */
const forbidden = (file: AgentFile): string =>
  [
    file.description,
    ...file.body.split(/\r?\n\s*\r?\n/).filter((p) => /\b(never|must not)\b/i.test(p)),
  ]
    .map(oneLine)
    .join('\n');

const has = (text: string, ...needles: string[]) => needles.filter((n) => text.includes(n));

/** Other agents whose reports a skill names (`E:/FMIP/ops/reports/<agent>/`), `*` for all of them. */
function reportsRead(source: FlowSource, roster: readonly string[]): string[] {
  const named = [...source.skillText.matchAll(/E:\/FMIP\/ops\/reports\/([a-z*-]+)\//g)].map(
    (m) => m[1]!,
  );
  if (/E:\/FMIP\/data-audit\/reports\//.test(source.skillText)) named.push('data-auditor');
  if (named.includes('*')) return ['*'];
  return named.filter(
    (a, i) => a !== source.file.name && roster.includes(a) && named.indexOf(a) === i,
  );
}

const ALL_FINDINGS = 'E:/FMIP/ops/findings/';

/**
 * Other agents' findings a skill reads, from the bullets of its "Inputs"
 * section that speak of findings: the prefixes they name (`gro-, seo-`), or
 * every agent's when a bullet names the findings folder without a prefix.
 */
function findingsRead(skillText: string, charter: Charter): string | null {
  const bullets = sectionOf(skillText, /^Inputs\b/)
    .split(/\r?\n(?=- )/)
    .filter((b) => /^- /.test(b) && /findings/i.test(b));
  const known = new Set(Object.values(charter.prefixes));
  const prefixes: string[] = [];
  for (const bullet of bullets) {
    const named = [...bullet.matchAll(/`([a-z]+)`/g)].map((m) => m[1]!).filter((p) => known.has(p));
    if (named.length === 0 && bullet.includes(ALL_FINDINGS)) return ALL_FINDINGS;
    for (const p of named) if (!prefixes.includes(p)) prefixes.push(p);
  }
  return prefixes.length === 0 ? null : prefixes.map((p) => `${p}-`).join(', ');
}

/** Everything but who reads it: that needs every agent's inputs (`readersOf`). */
export function flowOf(
  source: FlowSource,
  charter: Charter,
  roster: readonly string[],
): ConsoleAgentFlow {
  const { file, skillText } = source;
  const text = oneLine(`${file.body}\n${skillText}`);
  const tools = file.tools;
  const fallback = FLOW_FALLBACK[file.name] ?? {};
  const wing = charter.wing.manager === file.name || charter.wing.members.includes(file.name);

  const triggers: ConsoleFlowNode<ConsoleFlowTrigger>[] = [];
  if (source.schedule !== 'on-demand') triggers.push(node('schedule', source.schedule));
  if (/\bUse (on|before merging) every PR\b/.test(file.description))
    triggers.push(node('pull-request'));
  if (
    source.schedule === 'on-demand' ||
    /\bUse\b[^.]*\b(before|on|when|whenever|for)\b/.test(file.description)
  ) {
    triggers.push(node('request'));
  }
  triggers.push(node('run-now'), node('chat'));

  const inputs: ConsoleFlowNode<ConsoleFlowInput>[] = [
    node('rules', 'CLAUDE.md · .claude/skills/team-charter/SKILL.md'),
    // A skill it uses, not a folder of the same name (`E:/FMIP/data-audit/`).
    ...source.skills
      .filter((skill) => file.body.includes(`skills/${skill}/`))
      .map((skill) => node('skill' as const, `.claude/skills/${skill}/SKILL.md`)),
  ];
  if (file.memory !== null) inputs.push(node('memory', `.claude/agent-memory/${file.name}/`));
  if (tools.some((t) => ['Read', 'Grep', 'Glob'].includes(t))) inputs.push(node('repository'));
  if (/task (tables|files)|phase files|04-tasks/i.test(text))
    inputs.push(node('tasks', 'docs/04-tasks-phase-*.md'));
  if (text.includes('data-audit/run.sh')) inputs.push(node('production-db', 'data-audit/run.sh'));
  const serverScripts = has(text, 'ops-check.sh', 'server-hardening.sh', 'check-setup.sh');
  if (serverScripts.length > 0) inputs.push(node('server', serverScripts.join(' · ')));
  const pageScripts = has(text, 'seo-check.sh', 'structured-data.sh');
  if (pageScripts.length > 0) inputs.push(node('public-pages', pageScripts.join(' · ')));
  if (/\bgh pr\b/.test(file.body)) inputs.push(node('github', 'gh pr'));
  if (tools.some((t) => t.startsWith('mcp__Claude_Browser__')))
    inputs.push(node('live-site', 'traveltohormuz.ir'));
  if (tools.some((t) => t === 'WebSearch' || t === 'WebFetch')) inputs.push(node('web'));
  if (tools.includes('Artifact')) inputs.push(node('design-canvas'));
  if (text.includes('lab-local')) inputs.push(node('lab', 'E:/FMIP/lab-local/'));
  if (text.includes('dashboard/out/snapshot.json'))
    inputs.push(node('dashboard', 'E:/FMIP/dashboard/out/snapshot.json'));
  const findings = findingsRead(skillText, charter);
  if (findings !== null) inputs.push(node('team-findings', findings));
  const read = reportsRead(source, roster);
  if (read.length > 0) inputs.push(node('team-reports', read.join(', ')));
  if (skillText.includes('E:/FMIP/ops/desk/')) inputs.push(node('desk', 'E:/FMIP/ops/desk/'));

  const never = forbidden(file);
  const limits: ConsoleFlowNode<ConsoleFlowLimit>[] = [
    node('server-read-only'),
    node('no-purchase-account-secret'),
    node('outside-text-data'),
    node('proposals-only'),
  ];
  if (/tests? (in a branch )?only when/i.test(`${file.description}\n${file.body}`))
    limits.push(node('tests-on-request'));
  else if (
    /\b(edit|change)(s|ing)?\b[^.]*\b(repository|code)\b|read-only on the code/i.test(never) ||
    /\bwrites? only (under|your|its)\b/i.test(oneLine(file.body))
  ) {
    limits.push(node('no-repo-edit'));
  }
  if (/\b(merge|deploy)\b/i.test(never)) limits.push(node('no-merge-deploy'));
  if (wing || /\bpublish/i.test(never)) limits.push(node('no-publish'));
  if (
    /decision desk|decide for the maintainer|are the maintainer's|frame every decision|leaves the decision|never decide/i.test(
      text,
    )
  ) {
    limits.push(node('maintainer-decides'));
  }
  if (wing) limits.push(node('no-paid-tools'), node('no-personal-data'));

  const reportDir =
    file.name === 'data-auditor'
      ? 'data-audit/reports'
      : file.name === 'chief-of-staff'
        ? 'ops/brief'
        : `ops/reports/${file.name}`;
  const outputs: ConsoleFlowNode<ConsoleFlowOutput>[] = [
    reportDir === 'ops/brief'
      ? node('brief', 'E:/FMIP/ops/brief/')
      : node('report', `E:/FMIP/${reportDir}/`),
  ];
  const prefix = charter.prefixes[file.name];
  if (prefix !== undefined) outputs.push(node('findings', `E:/FMIP/ops/findings/ · ${prefix}-`));
  if (skillText.includes('desk-new.json'))
    outputs.push(node('desk-questions', 'E:/FMIP/ops/desk-new.json'));
  if (skillText.includes('E:/FMIP/ops/handoffs/'))
    outputs.push(node('handoffs', 'E:/FMIP/ops/handoffs/'));
  // Files the skill keeps: a heading that names one, "Keep `…`", or a bold lead followed by one.
  const kept = [
    ...skillText.matchAll(/^##[^\n`]*`(E:\/FMIP\/ops\/[^`\s]+\.md)`/gm),
    ...skillText.matchAll(/\bKeep\s+`(E:\/FMIP\/ops\/[^`\s]+\.md)`/g),
    ...skillText.matchAll(/^-\s+\*\*[^*\n]+\*\*\s*`(E:\/FMIP\/ops\/[^`\s]+\.md)`/gm),
    ...skillText.matchAll(/^-\s+[^`\n]{0,60}\bregister\b\W{0,6}`(E:\/FMIP\/ops\/[^`\s]+\.md)`/gm),
  ]
    .map((m) => m[1]!)
    .filter((path) => !/\/(reports|brief|findings|handoffs)\//.test(path));
  for (const path of kept) outputs.push(node('ops-file', path));
  if (tools.includes('Artifact')) outputs.push(node('design-canvas'));
  if (file.memory !== null) outputs.push(node('memory', `.claude/agent-memory/${file.name}/`));

  return {
    triggers,
    inputs: unique([...inputs, ...(fallback.inputs ?? [])]),
    steps: flowStepsOf(skillText || file.body, source.schedule, fallback.headings).map(stepOf),
    limits: unique(limits),
    outputs: unique([...outputs, ...(fallback.outputs ?? [])]),
    readers: [],
  };
}

/**
 * Who reads an agent's output: every other agent whose inputs name its
 * reports (or all reports), the marketing wing's manager and members as the
 * charter pairs them, the engineering session where it hands work over, and
 * always the people and the console.
 */
export function readersOf(
  name: string,
  flows: ReadonlyMap<string, ConsoleAgentFlow>,
  charter: Charter,
): ConsoleFlowNode<ConsoleFlowReader>[] {
  const readers: ConsoleFlowNode<ConsoleFlowReader>[] = [];
  for (const [other, flow] of flows) {
    if (other === name) continue;
    const reports = flow.inputs.find((i) => i.kind === 'team-reports')?.detail?.split(', ') ?? [];
    const findings = flow.inputs.find((i) => i.kind === 'team-findings')?.detail ?? null;
    const prefix = charter.prefixes[name];
    const readsFindings =
      findings !== null &&
      (findings === ALL_FINDINGS ||
        (prefix !== undefined && findings.split(', ').includes(`${prefix}-`)));
    if (reports.includes('*') || reports.includes(name) || readsFindings) {
      readers.push(node('agent', other));
    }
  }
  const { manager, members } = charter.wing;
  if (manager !== null && members.includes(name)) readers.push(node('agent', manager));
  if (name === manager) for (const member of members) readers.push(node('agent', member));
  const own = flows.get(name);
  if (
    own?.outputs.some((o) => o.kind === 'handoffs') ||
    own?.triggers.some((t) => t.kind === 'pull-request')
  ) {
    readers.push(node('engineering-session'));
  }
  readers.push(node('maintainer'), node('console'));
  return unique(readers);
}

/** Every agent's flow, readers included. */
export function flowsOf(
  sources: readonly FlowSource[],
  charter: Charter,
): Map<string, ConsoleAgentFlow> {
  const roster = sources.map((s) => s.file.name);
  const flows = new Map(sources.map((s) => [s.file.name, flowOf(s, charter, roster)] as const));
  for (const [name, flow] of flows) flow.readers = readersOf(name, flows, charter);
  return flows;
}
