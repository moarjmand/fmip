import type {
  ConsoleAgent,
  ConsoleAgentFlow,
  ConsoleAgentRun,
  ConsoleCommand,
  ConsoleDecision,
  ConsoleFinding,
  ConsoleFindingStatus,
  ConsoleMemoryEntry,
  ConsoleMemorySource,
  ConsoleReport,
  ConsoleSeverity,
  ConsoleSnapshot,
} from '@fmip/contracts';

/**
 * The agents console's snapshot, built on the maintainer's computer (T-1699,
 * D-340): pure functions over what the files say, so they are tested on
 * fixtures and `publish.ts` only reads files and runs `ssh`.
 */

export const SNAPSHOT_SCHEMA = 1;

/**
 * How often each agent runs, as the daily run's prompt and the team charter's
 * "Schedules" have it (D-328, D-339, D-349). Weekly is Monday.
 */
export const DEFAULT_SCHEDULES: Record<string, string> = {
  'data-auditor': 'daily',
  'ops-release': 'daily',
  'qa-engineer': 'daily',
  'content-community': 'daily',
  'social-media': 'daily',
  'chief-of-staff': 'daily',
  'model-scientist': 'weekly',
  'marketing-manager': 'weekly',
  'seo-search': 'weekly',
  'growth-analyst': 'weekly',
  security: 'monthly',
  architect: 'monthly',
  'product-strategist': 'monthly',
  'business-adviser': 'monthly',
  'code-reviewer': 'on-demand',
  designer: 'on-demand',
};

/** Where each agent leaves its reports, relative to the ops folder's parent (`E:/FMIP`). */
export const REPORT_DIRS: Record<string, string> = {
  'data-auditor': 'data-audit/reports',
  'chief-of-staff': 'ops/brief',
};
export const reportDirOf = (agent: string): string => REPORT_DIRS[agent] ?? `ops/reports/${agent}`;

/** What a person changed in the console, kept on the computer between runs. */
export interface ConsoleState {
  agents: Record<string, { paused?: boolean; model?: string; schedule?: string }>;
  answers: Record<string, { answer: string; note: string; by: string; at: string }>;
  runRequests: { id: string; agent: string; requested_by: string; at: string }[];
}

export const emptyState = (): ConsoleState => ({ agents: {}, answers: {}, runRequests: [] });

export interface AgentFile {
  name: string;
  description: string;
  model: string;
  tools: string[];
  memory: string | null;
  body: string;
}

/** An agent's file: its front matter and the instructions under it. */
export function parseAgentFile(text: string): AgentFile | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (match === null) return null;
  const fields = new Map<string, string>();
  for (const line of match[1]!.split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at > 0) fields.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  const name = fields.get('name');
  if (name === undefined || name === '') return null;
  return {
    name,
    description: fields.get('description') ?? '',
    model: fields.get('model') ?? 'inherit',
    tools: (fields.get('tools') ?? '')
      .split(',')
      .map((tool) => tool.trim())
      .filter((tool) => tool !== ''),
    memory: fields.get('memory') ?? null,
    body: match[2] ?? '',
  };
}

const AREAS: { test: (tool: string) => boolean; area: string; level: 'read' | 'write' }[] = [
  {
    test: (t) => ['Read', 'Grep', 'Glob'].includes(t),
    area: 'Reads the repository and the ops files',
    level: 'read',
  },
  {
    test: (t) => ['Write', 'Edit', 'NotebookEdit'].includes(t),
    area: 'Writes its own reports and findings',
    level: 'write',
  },
  {
    test: (t) => t === 'Bash',
    area: 'Runs commands: scripts, git, and the server over ssh (read-only by the charter)',
    level: 'write',
  },
  {
    test: (t) => ['WebSearch', 'WebFetch'].includes(t),
    area: 'Searches and reads the web',
    level: 'read',
  },
  {
    test: (t) => t.startsWith('mcp__Claude_Browser__'),
    area: 'Opens the live site in the built-in browser',
    level: 'read',
  },
  {
    test: (t) => t.startsWith('Artifact'),
    area: 'Reads and writes the claude.ai pages (the desk)',
    level: 'write',
  },
  { test: (t) => t === 'Agent', area: 'Asks other agents', level: 'write' },
  { test: (t) => t === 'Skill', area: 'Uses the team skills', level: 'read' },
];

/** The agent's tools, grouped into what they let it do. */
export function accessOf(tools: readonly string[]): ConsoleAgent['access'] {
  const groups = new Map<string, { area: string; level: 'read' | 'write'; tools: string[] }>();
  for (const tool of tools) {
    const rule = AREAS.find((r) => r.test(tool)) ?? { area: 'Other tools', level: 'read' as const };
    const group = groups.get(rule.area) ?? { area: rule.area, level: rule.level, tools: [] };
    group.tools.push(tool.replace(/^mcp__Claude_Browser__/, 'browser.'));
    groups.set(rule.area, group);
  }
  return [...groups.values()];
}

/** The skills an agent's instructions name, out of those that exist, in the order it first names them. */
export function skillsOf(body: string, known: readonly string[]): string[] {
  return known
    .filter((skill) => skill !== 'team-charter')
    .map((skill) => ({ skill, at: body.search(new RegExp(`\\b${skill}\\b`)) }))
    .filter(({ at }) => at !== -1)
    .sort((a, b) => a.at - b.at)
    .map(({ skill }) => skill);
}

/** A skill's steps: the `### n. Step` headings under `## Steps`, or its `##` headings when it has none. */
export function stepsOf(skill: string): string[] {
  const lines = skill.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+Steps\b/.test(line));
  if (start !== -1) {
    const steps: string[] = [];
    for (const line of lines.slice(start + 1)) {
      if (/^##\s/.test(line)) break;
      const step = /^###\s+(?:\d+\.\s*)?(.+)$/.exec(line);
      if (step !== null) steps.push(step[1]!.trim());
    }
    if (steps.length > 0) return steps.slice(0, 10);
  }
  return lines
    .map((line) => /^##\s+(.+)$/.exec(line)?.[1]?.trim())
    .filter((heading): heading is string => heading !== undefined && !/^hard rules$/i.test(heading))
    .slice(0, 10);
}

export interface FindingLine {
  file: string;
  record: Record<string, unknown>;
}

const SEVERITIES: ConsoleSeverity[] = ['critical', 'major', 'minor', 'info'];
const STATUSES: ConsoleFindingStatus[] = ['open', 'fixed', 'wontfix', 'duplicate'];
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Every finding once, the latest line of each id winning; files in date order. */
export function findingsFrom(lines: readonly FindingLine[]): ConsoleFinding[] {
  const byId = new Map<string, ConsoleFinding>();
  for (const { file, record } of lines) {
    const id = text(record.id);
    const agent = text(record.agent);
    if (id === '' || agent === '') continue;
    const severity = SEVERITIES.find((s) => s === record.severity) ?? 'info';
    const status = STATUSES.find((s) => s === record.status) ?? 'open';
    const parts = [
      text(record.evidence),
      text(record.likely_cause) === '' ? '' : `Likely cause: ${text(record.likely_cause)}`,
      text(record.proposal) === '' ? '' : `Proposal: ${text(record.proposal)}`,
    ].filter((part) => part !== '');
    const previous = byId.get(id);
    byId.set(id, {
      id,
      agent,
      severity,
      status,
      title: text(record.title) || id,
      opened_at: previous?.opened_at ?? (text(record.first_seen) || file.slice(0, 10)),
      detail: parts.join('\n\n'),
      related: text(record.related) || null,
    });
  }
  return [...byId.values()].sort(
    (a, b) => b.opened_at.localeCompare(a.opened_at) || a.id.localeCompare(b.id),
  );
}

/** One run a day per agent that left a finding or a report that day, newest first. */
export function runsOf(
  agent: string,
  findingDays: ReadonlyMap<string, number>,
  reportDays: readonly string[],
  days = 14,
): ConsoleAgentRun[] {
  const all = new Set([...findingDays.keys(), ...reportDays]);
  return [...all]
    .sort()
    .reverse()
    .slice(0, days)
    .map((day) => ({
      at: `${day}T08:00:00.000Z`,
      status: 'ok' as const,
      findings: findingDays.get(day) ?? 0,
      duration_seconds: null,
    }));
}

export interface ReportFile {
  agent: string;
  name: string;
  text: string;
}

/** Reports newest first: the date from the file's name, the title from its first heading. */
export function reportsFrom(files: readonly ReportFile[], limit = 60): ConsoleReport[] {
  return files
    .map((file) => ({
      agent: file.agent,
      date: /^(\d{4}-\d{2}-\d{2})/.exec(file.name)?.[1] ?? '',
      title: /^#\s+(.+)$/m.exec(file.text)?.[1]?.trim() ?? file.name,
      path: `${reportDirOf(file.agent)}/${file.name}`,
      text: file.text,
    }))
    .filter((report) => report.date !== '')
    .sort((a, b) => b.date.localeCompare(a.date) || a.agent.localeCompare(b.agent))
    .slice(0, limit);
}

export interface DeskQuestion {
  id: string;
  q: string;
  context?: string;
  options?: { key: string; label: string }[];
}

/** The desk's questions with whatever answer they have, from the desk or from the console. */
export function deskDecisions(
  questions: readonly DeskQuestion[],
  deskAnswers: Record<string, { choice: string; at: string; note?: string }>,
  state: ConsoleState,
): ConsoleDecision[] {
  const seen = new Set<string>();
  const out: ConsoleDecision[] = [];
  for (const question of questions) {
    if (seen.has(question.id)) continue;
    seen.add(question.id);
    const options = (question.options ?? []).map((o) => ({ key: o.key, label: o.label }));
    const fromConsole = state.answers[question.id];
    const fromDesk = deskAnswers[question.id];
    const key = fromConsole?.answer ?? fromDesk?.choice ?? null;
    out.push({
      id: question.id,
      title: question.q,
      status: key === null ? 'open' : 'decided',
      summary: question.context ?? '',
      options,
      answer: key === null ? null : (options.find((o) => o.key === key)?.label ?? key),
      decided_by: fromConsole?.by ?? (fromDesk === undefined ? null : 'the decision desk'),
      decided_at: fromConsole?.at ?? fromDesk?.at ?? null,
    });
  }
  return out.sort((a, b) =>
    a.status === b.status ? b.id.localeCompare(a.id) : a.status === 'open' ? -1 : 1,
  );
}

/** The record's newest decisions (`## D-NNN — title` and its status line). */
export function recordedDecisions(markdown: string, limit = 25): ConsoleDecision[] {
  const out: ConsoleDecision[] = [];
  const pattern = /^## (D-\d+) — (.+)$\r?\n\r?\n\*\*Status:\*\* ([^\n]+)/gm;
  for (const match of markdown.matchAll(pattern)) {
    const status = match[3]!.trim();
    out.push({
      id: match[1]!,
      title: match[2]!.trim(),
      status: 'decided',
      summary: status,
      options: [],
      answer: null,
      decided_by: /\(([^)]+)\)/.exec(status)?.[1] ?? null,
      decided_at: /(\d{4}-\d{2}-\d{2})/.exec(status)?.[1] ?? null,
    });
  }
  return out.sort((a, b) => Number(b.id.slice(2)) - Number(a.id.slice(2))).slice(0, limit);
}

export interface AgentInputs {
  file: AgentFile;
  skills: string[];
  steps: string[];
  memoryEntries: ConsoleMemoryEntry[];
  findingDays: ReadonlyMap<string, number>;
  reportDays: string[];
  /** How it works, for the console's schematic (`flow.ts`, D-352). */
  flow?: ConsoleAgentFlow;
}

/** One agent as the console shows it, its file and its history put together. */
export function agentOf(inputs: AgentInputs, state: ConsoleState): ConsoleAgent {
  const { file } = inputs;
  const override = state.agents[file.name] ?? {};
  const access = accessOf(file.tools);
  const sources: ConsoleMemorySource[] = [
    { kind: 'instructions', label: 'Its instructions', path: `.claude/agents/${file.name}.md` },
    { kind: 'project', label: 'The project rules', path: 'CLAUDE.md' },
    { kind: 'charter', label: 'The team charter', path: '.claude/skills/team-charter/SKILL.md' },
    ...inputs.skills.map((skill) => ({
      kind: 'skill' as const,
      label: `Skill: ${skill}`,
      path: `.claude/skills/${skill}/SKILL.md`,
    })),
    { kind: 'history', label: 'Its past findings', path: 'E:/FMIP/ops/findings/' },
    { kind: 'history', label: 'Its past reports', path: `E:/FMIP/${reportDirOf(file.name)}/` },
  ];
  if (file.memory !== null) {
    sources.push({
      kind: 'memory',
      label: 'Its own memory',
      path: `.claude/agent-memory/${file.name}/`,
    });
  }
  const outputs = [
    file.name === 'chief-of-staff'
      ? 'The daily brief and the desk questions'
      : 'Findings in E:/FMIP/ops/findings/',
    `Reports in E:/FMIP/${reportDirOf(file.name)}/`,
  ];
  return {
    name: file.name,
    description: file.description,
    model: override.model ?? file.model,
    tools: file.tools,
    access,
    skills: inputs.skills,
    schedule: override.schedule ?? DEFAULT_SCHEDULES[file.name] ?? 'on-demand',
    paused: override.paused ?? false,
    workflow: {
      inputs: [
        'The project rules and the charter',
        ...access.filter((a) => a.level === 'read').map((a) => a.area),
      ],
      steps: inputs.steps,
      outputs,
    },
    ...(inputs.flow === undefined ? {} : { flow: inputs.flow }),
    memory: { sources, entries: inputs.memoryEntries },
    runs: runsOf(file.name, inputs.findingDays, inputs.reportDays),
  };
}

export function snapshotOf(parts: Omit<ConsoleSnapshot, 'schema'>): ConsoleSnapshot {
  return { schema: SNAPSHOT_SCHEMA, ...parts };
}

/**
 * A command applied to the console's state on the computer. A pause, a model,
 * a schedule and an answer are done at once; a run waits for the daily run,
 * or the console's hourly sync, to start the agent (`finish` false).
 */
export function applyCommand(
  state: ConsoleState,
  command: ConsoleCommand,
  agents: readonly string[],
): { state: ConsoleState; finish: boolean; status: 'done' | 'failed'; outcome: string } {
  const next: ConsoleState = structuredClone(state);
  const isAgent = agents.includes(command.target);
  const agent = (next.agents[command.target] ??= {});
  const failed = (outcome: string) => ({ state, finish: true, status: 'failed' as const, outcome });
  switch (command.kind) {
    case 'agent.pause':
    case 'agent.resume':
      if (!isAgent) return failed(`No agent ${command.target} on the computer.`);
      agent.paused = command.kind === 'agent.pause';
      return {
        state: next,
        finish: true,
        status: 'done',
        outcome: agent.paused
          ? 'Paused: the daily run skips it.'
          : 'Resumed: the daily run runs it again.',
      };
    case 'agent.model':
      if (!isAgent) return failed(`No agent ${command.target} on the computer.`);
      agent.model = command.payload.model;
      return {
        state: next,
        finish: true,
        status: 'done',
        outcome: `Runs on ${command.payload.model} from its next run.`,
      };
    case 'agent.schedule':
      if (!isAgent) return failed(`No agent ${command.target} on the computer.`);
      agent.schedule = command.payload.schedule;
      return {
        state: next,
        finish: true,
        status: 'done',
        outcome: `Scheduled ${command.payload.schedule}.`,
      };
    case 'agent.run':
      if (!isAgent) return failed(`No agent ${command.target} on the computer.`);
      next.runRequests.push({
        id: command.id,
        agent: command.target,
        requested_by: command.requested_by,
        at: command.requested_at,
      });
      return {
        state: next,
        finish: false,
        status: 'done',
        outcome: 'Waiting for the next sync to start it.',
      };
    case 'decision.answer':
      delete next.agents[command.target];
      next.answers[command.target] = {
        answer: command.payload.answer ?? '',
        note: command.payload.note ?? '',
        by: command.requested_by,
        at: command.requested_at,
      };
      return {
        state: next,
        finish: true,
        status: 'done',
        outcome: 'Answer recorded for the daily run.',
      };
  }
}
