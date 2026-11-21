import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConsoleCommand } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  type ConsoleState,
  DEFAULT_SCHEDULES,
  type SyncSteps,
  accessOf,
  agentOf,
  applyCommand,
  deskDecisions,
  emptyState,
  findingsFrom,
  parseAgentFile,
  recordedDecisions,
  reportsFrom,
  skillsOf,
  stepsOf,
  syncCommands,
} from './snapshot.ts';

const AGENT = `---
name: ops-release
description: Watches the server
tools: Read, Grep, Bash, Write, mcp__Claude_Browser__navigate
model: sonnet
memory: project
---

You follow the \`ops-check\` skill; the data-audit skill has the schema.
`;

const SKILL = `# Ops check

## Hard rules

- read-only

## Steps

### 1. Snapshot
### 2. Compare with yesterday
### 3. Findings and report

## Thresholds
`;

function command(overrides: Partial<ConsoleCommand>): ConsoleCommand {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    kind: 'agent.pause',
    target: 'ops-release',
    payload: {},
    status: 'taken',
    requested_by: 'Mostafa',
    requested_at: '2026-11-01T10:00:00.000Z',
    finished_at: null,
    outcome: null,
    ...overrides,
  };
}

describe('an agent file', () => {
  it('reads the front matter and the instructions', () => {
    const file = parseAgentFile(AGENT);
    expect(file).toMatchObject({ name: 'ops-release', model: 'sonnet', memory: 'project' });
    expect(file?.tools).toEqual(['Read', 'Grep', 'Bash', 'Write', 'mcp__Claude_Browser__navigate']);
    expect(parseAgentFile('no front matter')).toBeNull();
  });

  it('groups tools into what they let the agent do', () => {
    expect(accessOf(['Read', 'Grep', 'Bash', 'mcp__Claude_Browser__navigate', 'Mystery'])).toEqual([
      { area: 'Reads the repository and the ops files', level: 'read', tools: ['Read', 'Grep'] },
      {
        area: 'Runs commands: scripts, git, and the server over ssh (read-only by the charter)',
        level: 'write',
        tools: ['Bash'],
      },
      {
        area: 'Opens the live site in the built-in browser',
        level: 'read',
        tools: ['browser.navigate'],
      },
      { area: 'Other tools', level: 'read', tools: ['Mystery'] },
    ]);
  });

  it('names its skills in the order the instructions do, never the charter', () => {
    expect(skillsOf(AGENT, ['data-audit', 'ops-check', 'team-charter', 'fmip-qa'])).toEqual([
      'ops-check',
      'data-audit',
    ]);
  });

  it("takes a skill's steps, or its headings when it has none", () => {
    expect(stepsOf(SKILL)).toEqual(['Snapshot', 'Compare with yesterday', 'Findings and report']);
    expect(stepsOf('# X\n\n## Hard rules\n\n## Read the log\n\n## Report')).toEqual([
      'Read the log',
      'Report',
    ]);
  });
});

describe('findings', () => {
  it('keeps each id once, the latest line winning, and its first day', () => {
    const findings = findingsFrom([
      {
        file: '2026-10-31.jsonl',
        record: {
          id: 'ops-1',
          agent: 'ops-release',
          severity: 'major',
          title: 'Disk',
          evidence: 'df 71%',
          first_seen: '2026-10-31',
        },
      },
      {
        file: '2026-11-01.jsonl',
        record: {
          id: 'ops-1',
          agent: 'ops-release',
          severity: 'minor',
          status: 'fixed',
          title: 'Disk',
          evidence: 'df 57%',
          proposal: 'prune',
        },
      },
      { file: '2026-11-01.jsonl', record: { id: 'x', agent: '' } },
      // The charter's words (T-1870): resolved and accepted close a finding.
      { file: '2026-11-01.jsonl', record: { id: 'r', agent: 'qa-engineer', status: 'resolved' } },
      { file: '2026-11-01.jsonl', record: { id: 'a', agent: 'security', status: 'accepted' } },
      {
        file: '2026-11-01.jsonl',
        record: { id: 'u', agent: 'qa-engineer', status: 'fixed-unverified' },
      },
      { file: '2026-11-01.jsonl', record: { id: 'd', agent: 'data-auditor', status: 'decide' } },
      {
        file: '2026-11-01.jsonl',
        record: { id: 'qa-1', agent: 'qa-engineer', severity: 'loud', title: 'A page' },
      },
    ]);
    expect(findings).toHaveLength(6);
    expect(['r', 'a', 'u', 'd'].map((id) => findings.find((f) => f.id === id)?.status)).toEqual([
      'fixed',
      'wontfix',
      'open',
      'open',
    ]);
    expect(findings.find((f) => f.id === 'ops-1')).toMatchObject({
      severity: 'minor',
      status: 'fixed',
      opened_at: '2026-10-31',
      detail: 'df 57%\n\nProposal: prune',
    });
    expect(findings.find((f) => f.id === 'qa-1')).toMatchObject({
      severity: 'info',
      status: 'open',
      opened_at: '2026-11-01',
    });
  });
});

describe('reports and decisions', () => {
  it('dates reports by their name and titles them by their first heading', () => {
    const reports = reportsFrom([
      { agent: 'ops-release', name: '2026-10-31.md', text: '# Ops 31 Oct\n\nfine' },
      { agent: 'data-auditor', name: '2026-11-01.md', text: 'no heading' },
      { agent: 'ops-release', name: 'notes.md', text: '# Undated' },
    ]);
    expect(reports.map((r) => [r.agent, r.date, r.title, r.path])).toEqual([
      ['data-auditor', '2026-11-01', '2026-11-01.md', 'data-audit/reports/2026-11-01.md'],
      ['ops-release', '2026-10-31', 'Ops 31 Oct', 'ops/reports/ops-release/2026-10-31.md'],
    ]);
  });

  it('marks a desk question decided by the desk or by the console, open questions first', () => {
    const state = emptyState();
    state.answers['d-2'] = {
      answer: 'b',
      note: '',
      by: 'Teammate',
      at: '2026-11-01T11:00:00.000Z',
    };
    const decisions = deskDecisions(
      [
        { id: 'd-1', q: 'One?', options: [{ key: 'a', label: 'Yes' }] },
        { id: 'd-2', q: 'Two?', options: [{ key: 'b', label: 'Later' }] },
        { id: 'd-3', q: 'Three?' },
        { id: 'd-1', q: 'One again' },
      ],
      { 'd-1': { choice: 'a', at: '2026-10-31T20:00:00.000Z' } },
      state,
    );
    expect(decisions.map((d) => [d.id, d.status, d.answer, d.decided_by])).toEqual([
      ['d-3', 'open', null, null],
      ['d-2', 'decided', 'Later', 'Teammate'],
      ['d-1', 'decided', 'Yes', 'the decision desk'],
    ]);
  });

  it('reads the newest recorded decisions', () => {
    const md = `## D-338 — Fold the rail\n\n**Status:** Accepted · 2026-11-01 (the maintainer) · **Task:** T-1693\n\n## D-339 — Wave three\n\n**Status:** Accepted · 2026-11-01 (the desk)\n`;
    expect(recordedDecisions(md).map((d) => [d.id, d.title, d.decided_at, d.decided_by])).toEqual([
      ['D-339', 'Wave three', '2026-11-01', 'the desk'],
      ['D-338', 'Fold the rail', '2026-11-01', 'the maintainer'],
    ]);
  });
});

describe('an agent in the snapshot', () => {
  it('carries its access, memory sources, steps, runs and the console overrides', () => {
    const state = emptyState();
    state.agents['ops-release'] = { paused: true, model: 'opus' };
    const agent = agentOf(
      {
        file: parseAgentFile(AGENT)!,
        skills: ['ops-check'],
        steps: stepsOf(SKILL),
        memoryEntries: [],
        findingDays: new Map([['2026-11-01', 3]]),
        reportDays: ['2026-10-31', '2026-11-01'],
      },
      state,
    );
    expect(agent).toMatchObject({ model: 'opus', paused: true, schedule: 'daily' });
    expect(agent.memory.sources.map((s) => s.kind)).toEqual([
      'instructions',
      'project',
      'charter',
      'skill',
      'history',
      'history',
      'memory',
    ]);
    expect(agent.runs.map((r) => [r.at.slice(0, 10), r.findings])).toEqual([
      ['2026-11-01', 3],
      ['2026-10-31', 0],
    ]);
    expect(agent.workflow.steps).toHaveLength(3);
  });
});

describe("the team's own files", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.claude');
  const known = readdirSync(join(root, 'skills')).sort();
  const files = readdirSync(join(root, 'agents'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => parseAgentFile(readFileSync(join(root, 'agents', name), 'utf8')));

  it('parses every agent file and gives each a schedule', () => {
    expect(files.every((file) => file !== null)).toBe(true);
    const unscheduled = files
      .map((file) => file!.name)
      .filter((name) => DEFAULT_SCHEDULES[name] === undefined);
    expect(unscheduled.sort()).toEqual([]);
  });

  it('shows the marketing wing (D-349) with its schedule, skill, steps and report folder', () => {
    const wing = {
      'marketing-manager': { schedule: 'weekly', skills: ['marketing-plan'] },
      'seo-search': { schedule: 'weekly', skills: ['search-visibility'] },
      'social-media': { schedule: 'daily', skills: ['social-drafts', 'data-audit'] },
      'growth-analyst': { schedule: 'weekly', skills: ['growth-funnel', 'data-audit'] },
    };
    for (const [name, expected] of Object.entries(wing)) {
      const file = files.find((f) => f?.name === name);
      expect(file, name).toBeDefined();
      const skills = skillsOf(file!.body, known);
      const steps = stepsOf(readFileSync(join(root, 'skills', skills[0]!, 'SKILL.md'), 'utf8'));
      const agent = agentOf(
        { file: file!, skills, steps, memoryEntries: [], findingDays: new Map(), reportDays: [] },
        emptyState(),
      );
      expect(agent).toMatchObject({ name, schedule: expected.schedule, skills: expected.skills });
      expect(agent.model).toBe('sonnet');
      expect(agent.memory.sources.map((s) => s.kind)).toContain('memory');
      expect(agent.workflow.steps.length).toBeGreaterThan(2);
      expect(agent.workflow.outputs).toContain(`Reports in E:/FMIP/ops/reports/${name}/`);
      expect(agent.access.some((a) => a.area === 'Writes its own reports and findings')).toBe(true);
    }
  });
});

describe('commands on the computer', () => {
  const agents = ['ops-release'];

  it('applies a pause, a model, a schedule and an answer at once', () => {
    let state = emptyState();
    for (const [cmd, outcome] of [
      [command({ kind: 'agent.pause' }), 'Paused'],
      [command({ kind: 'agent.model', payload: { model: 'haiku' } }), 'Runs on haiku'],
      [command({ kind: 'agent.schedule', payload: { schedule: 'weekly' } }), 'Scheduled weekly'],
    ] as const) {
      const applied = applyCommand(state, cmd, agents);
      expect(applied).toMatchObject({ finish: true, status: 'done' });
      expect(applied.outcome).toContain(outcome);
      state = applied.state;
    }
    expect(state.agents['ops-release']).toEqual({
      paused: true,
      model: 'haiku',
      schedule: 'weekly',
    });

    const answered = applyCommand(
      state,
      command({ kind: 'decision.answer', target: 'd-1', payload: { answer: 'a' } }),
      agents,
    );
    expect(answered.state.answers['d-1']).toMatchObject({ answer: 'a', by: 'Mostafa' });
    expect(answered.state.agents['d-1']).toBeUndefined();
  });

  it('keeps a run waiting, and fails a command for an agent it does not have', () => {
    const run = applyCommand(emptyState(), command({ kind: 'agent.run' }), agents);
    expect(run.finish).toBe(false);
    expect(run.state.runRequests).toHaveLength(1);
    const missing = applyCommand(
      emptyState(),
      command({ kind: 'agent.pause', target: 'ghost' }),
      agents,
    );
    expect(missing).toMatchObject({ finish: true, status: 'failed' });
    expect(missing.state.agents).toEqual({});
  });
});

describe('sync, with stand-ins for the server and the files (T-1878)', () => {
  const agents = ['ops-release'];
  const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

  /** Stand-ins that record what happened in order; `finish` fails for the ids in `down`. */
  function standIns(taken: ConsoleCommand[], down: readonly string[] = [], publishFails = false) {
    const log: string[] = [];
    const saved: ConsoleState[] = [];
    const steps: SyncSteps = {
      load: () => {
        log.push('load');
        return emptyState();
      },
      take: () => {
        log.push('take');
        return taken;
      },
      save: (state) => {
        log.push('save');
        saved.push(structuredClone(state));
      },
      finish: (id, status) => {
        log.push(`finish ${id.slice(-1)} ${status}`);
        if (down.includes(id)) throw new Error('ssh fmip-prod failed: refused');
      },
      publish: () => {
        log.push('publish');
        if (publishFails) throw new Error('ssh fmip-prod failed: timed out');
      },
    };
    return { steps, log, saved };
  }

  const taken = [
    command({ id: ID(1), kind: 'agent.pause' }),
    command({ id: ID(2), kind: 'agent.model', payload: { model: 'haiku' } }),
    command({ id: ID(3), kind: 'agent.run' }),
    command({ id: ID(4), kind: 'agent.pause', target: 'ghost' }),
  ];

  it('saves what was applied before it reports anything back', () => {
    const { steps, log, saved } = standIns(taken);
    const { state, failures } = syncCommands(steps, agents);
    expect(failures).toEqual([]);
    expect(log).toEqual([
      'load',
      'take',
      'save',
      'finish 1 done',
      'finish 2 done',
      'finish 4 failed',
      'publish',
    ]);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual(state);
    expect(state.agents['ops-release']).toEqual({ paused: true, model: 'haiku' });
    expect(state.runRequests.map((r) => r.id)).toEqual([ID(3)]);
  });

  it('survives a report that fails: state saved, the next command still reported, the failure named', () => {
    const { steps, log, saved } = standIns(taken, [ID(1)]);
    const { state, failures } = syncCommands(steps, agents);
    // The first report failed; the second and the fourth were still sent, and the snapshot published.
    expect(log).toEqual([
      'load',
      'take',
      'save',
      'finish 1 done',
      'finish 2 done',
      'finish 4 failed',
      'publish',
    ]);
    expect(saved[0]!.agents['ops-release']).toEqual({ paused: true, model: 'haiku' });
    expect(saved[0]!.runRequests).toHaveLength(1);
    expect(state).toEqual(saved[0]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(ID(1));
    expect(failures[0]).toContain('did not reach the server');
  });

  it('keeps the saved state when every report and the publish fail', () => {
    const { steps, log, saved } = standIns(taken, [ID(1), ID(2), ID(4)], true);
    const { failures } = syncCommands(steps, agents);
    expect(log.indexOf('save')).toBeLessThan(log.indexOf('finish 1 done'));
    expect(saved).toHaveLength(1);
    expect(failures).toHaveLength(4);
    expect(failures.at(-1)).toContain('not published');
  });

  it('leaves out a command without a UUID id and one of a kind it does not know, and says so', () => {
    const odd = [
      command({ id: `${ID(1)}; x` }),
      command({ id: ID(2), kind: 'agent.dance' as ConsoleCommand['kind'] }),
      command({ id: ID(3), kind: 'agent.pause' }),
    ];
    const { steps, log } = standIns(odd);
    const { state, failures } = syncCommands(steps, agents);
    expect(state.agents['ops-release']).toEqual({ paused: true });
    expect(log).toEqual(['load', 'take', 'save', 'finish 2 failed', 'finish 3 done', 'publish']);
    expect(failures).toHaveLength(2);
    expect(failures[0]).toContain('without a UUID id');
    expect(failures[1]).toContain(ID(2));
  });
});

describe("a person's triage in the snapshot and in sync (T-1907, D-456 point 2)", () => {
  const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
  const line = (file: string, record: Record<string, unknown>) => ({
    file: `${file}.jsonl`,
    record: { agent: 'ops-release', severity: 'major', title: 'Disk', ...record },
  });
  const lines = [
    line('2026-11-01', { id: 'p', status: 'new', evidence: 'df 91%', proposal: 'prune' }),
    line('2026-11-02', {
      id: 'p',
      status: 'planned',
      by: 'mostafa',
      evidence: 'Accepted on the agents console by mostafa.',
      proposal: 'prune',
      task: 'T-1946',
    }),
    line('2026-11-01', { id: 'r', status: 'open', evidence: 'slow page' }),
    line('2026-11-02', {
      id: 'r',
      status: 'rejected',
      by: 'teammate',
      evidence: 'Rejected: «not ours»',
    }),
    line('2026-11-02', { id: 's', status: 'snoozed', by: 'mostafa', until: '2026-11-10' }),
    // A snooze that names no day was never put off; one written by hand without `by` is read too.
    line('2026-11-02', { id: 'n', status: 'snoozed', by: 'mostafa' }),
    line('2026-11-02', { id: 'h', status: 'snoozed', until: '2026-11-10', evidence: 'by hand' }),
    line('2026-11-02', { id: 'a', status: 'accepted', evidence: 'known' }),
  ];
  const on = (day: string) => new Map(findingsFrom(lines, day).map((f) => [f.id, f]));

  it('carries planned, rejected and snoozed, with the task, the day and who decided', () => {
    const findings = on('2026-11-03');
    expect(findings.get('p')).toMatchObject({
      status: 'planned',
      task: 'T-1946',
      triaged_by: 'mostafa',
      until: null,
      opened_at: '2026-11-01',
      // What the agent saw stays; the person's line is added, not put in its place.
      detail: 'df 91%\n\nProposal: prune\n\nTriage: Accepted on the agents console by mostafa.',
    });
    expect(findings.get('r')).toMatchObject({
      status: 'rejected',
      triaged_by: 'teammate',
      task: null,
      detail: 'slow page\n\nTriage: Rejected: «not ours»',
    });
    expect(findings.get('s')).toMatchObject({
      status: 'snoozed',
      until: '2026-11-10',
      triaged_by: 'mostafa',
    });
    expect(findings.get('h')).toMatchObject({
      status: 'snoozed',
      until: '2026-11-10',
      triaged_by: null,
      detail: 'by hand',
    });
    expect(findings.get('n')).toMatchObject({ status: 'open', until: null, triaged_by: null });
    // The charter's `accepted` is still "known, nothing to do", never `planned`.
    expect(findings.get('a')).toMatchObject({ status: 'wontfix', triaged_by: null });
  });

  it('reads a snoozed finding as open again from its day, with a fixed clock', () => {
    expect(on('2026-11-09').get('s')).toMatchObject({ status: 'snoozed', until: '2026-11-10' });
    expect(on('2026-11-10').get('s')).toMatchObject({
      status: 'open',
      until: null,
      triaged_by: null,
    });
    expect(on('2027-01-01').get('s')?.status).toBe('open');
    // A rejected or planned finding does not come back by the calendar.
    expect(on('2027-01-01').get('r')?.status).toBe('rejected');
    expect(on('2027-01-01').get('p')?.status).toBe('planned');
  });

  const reject = command({
    id: ID(1),
    kind: 'finding.reject',
    target: 'ops-2026-11-01-01',
    payload: { reason: 'not ours' },
    requested_by: 'Mostafa A',
    requested_by_username: 'mostafa',
  });
  const snooze = command({
    id: ID(2),
    kind: 'finding.snooze',
    target: 'ops-2026-11-01-02',
    payload: { until: '2026-12-01' },
    requested_by_username: 'teammate',
  });

  it('keeps a triage command in the state until it is written, without touching an agent', () => {
    const applied = applyCommand(emptyState(), reject, ['ops-release']);
    expect(applied).toMatchObject({ finish: false, status: 'done' });
    expect(applied.state.triage).toEqual([
      {
        id: ID(1),
        kind: 'finding.reject',
        finding: 'ops-2026-11-01-01',
        reason: 'not ours',
        until: '',
        by: 'mostafa',
        at: '2026-11-01T10:00:00.000Z',
      },
    ]);
    expect(applied.state.agents).toEqual({});
    // A state file from before T-1907 has no list yet.
    const old = { agents: {}, answers: {}, runRequests: [] } as unknown as ConsoleState;
    expect(applyCommand(old, snooze, []).state.triage).toMatchObject([
      { kind: 'finding.snooze', until: '2026-12-01', by: 'teammate' },
    ]);
  });

  it('saves the commands before a line is written, and the state without them before any is reported', () => {
    const log: string[] = [];
    const saved: ConsoleState[] = [];
    const steps: SyncSteps = {
      load: () => emptyState(),
      take: () => [reject, command({ id: ID(3), kind: 'agent.pause' }), snooze],
      save: (state) => {
        log.push(`save ${state.triage.length}`);
        saved.push(structuredClone(state));
      },
      triage: (state) => {
        log.push(`triage ${state.triage.map((t) => t.id.slice(-1)).join(',')}`);
        return {
          state: { ...state, triage: [] },
          reports: [
            { id: ID(1), status: 'done', outcome: 'Rejected, with the reason.' },
            { id: ID(2), status: 'failed', outcome: 'The computer could not write it: closed' },
          ],
        };
      },
      finish: (id, status) => {
        log.push(`finish ${id.slice(-1)} ${status}`);
      },
      publish: (state) => {
        log.push(`publish ${state.triage.length}`);
      },
    };
    const { state, failures } = syncCommands(steps, ['ops-release']);
    expect(failures).toEqual([]);
    expect(log).toEqual([
      'save 2',
      'triage 1,2',
      'save 0',
      'finish 3 done',
      'finish 1 done',
      'finish 2 failed',
      'publish 0',
    ]);
    expect(saved[0]?.triage.map((t) => t.id)).toEqual([ID(1), ID(2)]);
    expect(state.triage).toEqual([]);
  });

  it('keeps the commands for the next sync when writing them throws, and still publishes', () => {
    const log: string[] = [];
    const steps: SyncSteps = {
      load: () => emptyState(),
      take: () => [reject],
      save: (state) => {
        log.push(`save ${state.triage.length}`);
      },
      triage: () => {
        throw new Error('the findings folder is not there');
      },
      finish: () => {
        log.push('finish');
      },
      publish: () => {
        log.push('publish');
      },
    };
    const { state, failures } = syncCommands(steps, []);
    expect(failures).toEqual([
      'The triage commands were not written: the findings folder is not there',
    ]);
    expect(log).toEqual(['save 1', 'publish']);
    expect(state.triage).toHaveLength(1);

    // The next sync takes nothing new and writes what was kept.
    const next: SyncSteps = {
      ...steps,
      load: () => state,
      take: () => [],
      triage: (held) => ({
        state: { ...held, triage: [] },
        reports: [{ id: ID(1), status: 'done', outcome: 'Rejected, with the reason.' }],
      }),
    };
    log.length = 0;
    expect(syncCommands(next, []).failures).toEqual([]);
    expect(log).toEqual(['save 1', 'save 0', 'finish', 'publish']);
  });
});
