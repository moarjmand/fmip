import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConsoleCommand } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCHEDULES,
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
      {
        file: '2026-11-01.jsonl',
        record: { id: 'qa-1', agent: 'qa-engineer', severity: 'loud', title: 'A page' },
      },
    ]);
    expect(findings).toHaveLength(2);
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
