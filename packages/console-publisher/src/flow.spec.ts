import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type FlowSource,
  STEP_WORDS,
  flowOf,
  flowStepsOf,
  flowsOf,
  parseCharter,
  stepKey,
  stepLabel,
} from './flow.ts';
import { type AgentFile, DEFAULT_SCHEDULES, parseAgentFile, skillsOf } from './snapshot.ts';

/** The console's schematic data (T-1725, D-352), from an agent's file, its skill and the charter. */

const CHARTER = `# Charter

## The finding format

Prefixes: \`ops\` (ops-release), \`mkt\` (marketing-manager), \`seo\` (seo-search).

## Schedules

| Schedule | Agents |
|---|---|
| daily | ops-release, then chief-of-staff |
| weekly (Monday) | seo-search, then marketing-manager (it reads their fresh reports) |
| on demand | code-reviewer |

## The marketing wing (T-1721, D-349)

\`marketing-manager\` owns the growth plan and sets the priorities of \`seo-search\`, who reads
its newest report (\`E:/FMIP/ops/reports/marketing-manager/\`) before its own run.

1. **No paid tools.**
`;

const ROSTER = [
  'ops-release',
  'chief-of-staff',
  'seo-search',
  'marketing-manager',
  'code-reviewer',
];

const agent = (overrides: Partial<AgentFile>): AgentFile => ({
  name: 'ops-release',
  description:
    'Watches production. Use daily, or when the site is slow. Proposes fixes; never changes the server.',
  model: 'sonnet',
  tools: ['Read', 'Grep', 'Glob', 'Bash', 'Write'],
  memory: 'project',
  body: 'First read `.claude/skills/ops-check/SKILL.md`.\n\nYou may run `bash .claude/skills/ops-check/ops-check.sh`. You write only under `E:/FMIP/ops/`.\n\nYou never restart, deploy or edit files on the server.',
  ...overrides,
});

describe('the charter', () => {
  it('reads the schedules, the finding prefixes and the marketing wing', () => {
    const charter = parseCharter(CHARTER, ROSTER);
    expect(charter.schedules).toEqual({
      'ops-release': 'daily',
      'chief-of-staff': 'daily',
      'seo-search': 'weekly',
      'marketing-manager': 'weekly',
      'code-reviewer': 'on-demand',
    });
    expect(charter.prefixes).toEqual({
      'ops-release': 'ops',
      'marketing-manager': 'mkt',
      'seo-search': 'seo',
    });
    expect(charter.wing).toEqual({ manager: 'marketing-manager', members: ['seo-search'] });
  });

  it('says nothing for a charter without those sections', () => {
    expect(parseCharter('# Nothing', ROSTER)).toEqual({
      schedules: {},
      prefixes: {},
      wing: { manager: null, members: [] },
    });
  });
});

describe('the steps of a method', () => {
  it('takes the ### steps under Steps', () => {
    expect(
      flowStepsOf(
        '## Hard rules\n\n1. **Read-only.**\n2. **Secrets.**\n\n## Steps\n\n### 1. Run the invariants\n\n### 2. Triage\n',
        'daily',
      ),
    ).toEqual(['Run the invariants', 'Triage']);
  });

  it("takes the schedule's numbered list, its bold leads first", () => {
    const skill =
      '## Inputs\n\n1. not this\n2. nor this\n\n## A request\n\n1. **Read** it.\n2. Write a row.\n\n## Weekly\n\n1. `bash run.sh check.sql`. It shows:\n2. **Judge,** and write findings.\n';
    expect(flowStepsOf(skill, 'weekly')).toEqual(['bash run.sh check.sql', 'Judge']);
    expect(flowStepsOf(skill, 'monthly')).toEqual(['Read', 'Write a row']);
  });

  it('takes bold bullets when the method has no numbered list, else the headings', () => {
    expect(
      flowStepsOf(
        '## Monthly\n\n- **Costs.** The plan.\n- **Privacy.** Data.\n\n## Rules of this role\n\n- none\n',
        'monthly',
      ),
    ).toEqual(['Costs', 'Privacy']);
    expect(
      flowStepsOf(
        '## On a pull request\n\ntext\n\n## Weekly: the server (ssh)\n\ntext\n\n## The golden set\n',
        'monthly',
      ),
    ).toEqual(['On a pull request', 'Weekly: the server']);
  });

  it('labels a step by its bold lead or first clause, without markdown', () => {
    expect(stepLabel('**Scope.** `git fetch -q origin`, then more.')).toBe('Scope');
    expect(stepLabel('Compare with last week: the numbers.')).toBe('Compare with last week');
    expect(
      stepKey('Write `E:/FMIP/ops/x.md` in Persian, today; and more words here please now'),
    ).toBe('write e fmip ops x md in persian today and more words');
  });
});

describe('one agent', () => {
  const charter = parseCharter(CHARTER, ROSTER);
  const source = (file: AgentFile, skillText = '', schedule = 'daily'): FlowSource => ({
    file,
    skills: ['ops-check'],
    skillText,
    schedule,
  });

  it('is started by its schedule, the console and a chat; reads what its tools and scripts reach', () => {
    const flow = flowOf(source(agent({})), charter, ROSTER);
    expect(flow.triggers.map((t) => t.kind)).toEqual(['schedule', 'request', 'run-now', 'chat']);
    expect(flow.triggers[0]!.detail).toBe('daily');
    expect(flow.inputs.map((i) => i.kind)).toEqual([
      'rules',
      'skill',
      'memory',
      'repository',
      'server',
    ]);
    expect(flow.inputs.find((i) => i.kind === 'server')!.detail).toBe('ops-check.sh');
    expect(flow.limits.map((l) => l.kind)).toEqual([
      'server-read-only',
      'no-purchase-account-secret',
      'outside-text-data',
      'proposals-only',
      'no-repo-edit',
      'no-merge-deploy',
    ]);
    expect(flow.outputs).toEqual([
      { kind: 'report', detail: 'E:/FMIP/ops/reports/ops-release/' },
      { kind: 'findings', detail: 'E:/FMIP/ops/findings/ · ops-' },
      { kind: 'memory', detail: '.claude/agent-memory/ops-release/' },
    ]);
  });

  it('never claims a capability its file does not give', () => {
    const flow = flowOf(
      source(agent({ tools: ['Write'], memory: null, body: '' })),
      charter,
      ROSTER,
    );
    expect(flow.inputs.map((i) => i.kind)).toEqual(['rules']);
    expect(flow.outputs.map((o) => o.kind)).toEqual(['report', 'findings']);
    const web = flowOf(
      source(agent({ tools: ['WebSearch', 'mcp__Claude_Browser__navigate', 'Artifact'] })),
      charter,
      ROSTER,
    );
    expect(web.inputs.map((i) => i.kind)).toEqual(
      expect.arrayContaining(['web', 'live-site', 'design-canvas']),
    );
    expect(web.outputs.map((o) => o.kind)).toContain('design-canvas');
  });

  it('is asked for, not scheduled, when it runs on demand; a PR starts a reviewer', () => {
    const flow = flowOf(
      source(
        agent({
          name: 'code-reviewer',
          description: 'Reviews a branch. Use before merging every PR.',
        }),
        '',
        'on-demand',
      ),
      charter,
      ROSTER,
    );
    expect(flow.triggers.map((t) => t.kind)).toEqual([
      'pull-request',
      'request',
      'run-now',
      'chat',
    ]);
  });

  it("keeps the wing's rules for the marketing wing, and the files its skill keeps", () => {
    const skill =
      "## Inputs (read, never change)\n\n- The week's `seo` lines in `E:/FMIP/ops/findings/`.\n\n## The plan: `E:/FMIP/ops/marketing/plan.md`, Persian\n\n1. **Audience.**\n2. **Channels.**\n\nPut it on `E:/FMIP/ops/desk-new.json`.";
    const flow = flowOf(
      source(agent({ name: 'marketing-manager', body: '' }), skill, 'weekly'),
      charter,
      ROSTER,
    );
    expect(flow.limits.map((l) => l.kind)).toEqual(
      expect.arrayContaining(['no-publish', 'no-paid-tools', 'no-personal-data']),
    );
    expect(flow.inputs).toContainEqual({ kind: 'team-findings', detail: 'seo-' });
    expect(flow.outputs).toContainEqual({
      kind: 'ops-file',
      detail: 'E:/FMIP/ops/marketing/plan.md',
    });
    expect(flow.outputs).toContainEqual({
      kind: 'desk-questions',
      detail: 'E:/FMIP/ops/desk-new.json',
    });
    expect(flow.steps).toEqual([
      { text: 'Audience', fa: STEP_WORDS.audience },
      { text: 'Channels', fa: STEP_WORDS.channels },
    ]);
  });

  it('is read by the agents whose inputs name it, the wing, people and the console', () => {
    const flows = flowsOf(
      [
        source(agent({})),
        source(
          agent({ name: 'chief-of-staff', body: '' }),
          '## Inputs\n\n- `E:/FMIP/ops/reports/*/<today>*.md`\n- `E:/FMIP/ops/handoffs/`',
        ),
        source(agent({ name: 'seo-search', body: '' }), '', 'weekly'),
        source(agent({ name: 'marketing-manager', body: '' }), '', 'weekly'),
      ],
      charter,
    );
    expect(flows.get('ops-release')!.readers).toEqual([
      { kind: 'agent', detail: 'chief-of-staff' },
      { kind: 'maintainer', detail: null },
      { kind: 'console', detail: null },
    ]);
    expect(flows.get('seo-search')!.readers.map((r) => r.detail)).toEqual(
      expect.arrayContaining(['chief-of-staff', 'marketing-manager']),
    );
    expect(flows.get('marketing-manager')!.readers.map((r) => r.detail)).toContain('seo-search');
    expect(flows.get('chief-of-staff')!.readers.map((r) => r.kind)).toEqual([
      'engineering-session',
      'maintainer',
      'console',
    ]);
  });
});

describe("the team's own files", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.claude');
  const skillNames = readdirSync(join(root, 'skills')).sort();
  const files = readdirSync(join(root, 'agents'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => parseAgentFile(readFileSync(join(root, 'agents', name), 'utf8'))!);
  const charter = parseCharter(
    readFileSync(join(root, 'skills', 'team-charter', 'SKILL.md'), 'utf8'),
    files.map((f) => f.name),
  );
  const flows = flowsOf(
    files.map((file) => {
      const skills = skillsOf(file.body, skillNames);
      return {
        file,
        skills,
        skillText: readFileSync(join(root, 'skills', skills[0]!, 'SKILL.md'), 'utf8'),
        schedule: charter.schedules[file.name] ?? 'on-demand',
      };
    }),
    charter,
  );

  it('schedules every agent in the charter as the console does', () => {
    for (const file of files)
      expect(charter.schedules[file.name], file.name).toBe(DEFAULT_SCHEDULES[file.name]);
    expect(charter.wing).toEqual({
      manager: 'marketing-manager',
      members: ['seo-search', 'social-media', 'growth-analyst'],
    });
  });

  it('gives every agent triggers, inputs, Persian steps, limits, outputs and readers', () => {
    expect(flows.size).toBe(files.length);
    for (const [name, flow] of flows) {
      expect(
        flow.triggers.map((t) => t.kind),
        name,
      ).toEqual(expect.arrayContaining(['run-now', 'chat']));
      expect(flow.inputs.filter((i) => i.kind !== 'rules').length, name).toBeGreaterThan(0);
      expect(flow.steps.length, name).toBeGreaterThan(1);
      // A step without Persian means its skill changed: add it to STEP_WORDS.
      expect(
        flow.steps.filter((s) => s.fa === null).map((s) => stepKey(s.text)),
        name,
      ).toEqual([]);
      expect(
        flow.limits.map((l) => l.kind),
        name,
      ).toContain('server-read-only');
      expect(
        flow.outputs.some((o) => o.kind === 'report' || o.kind === 'brief'),
        name,
      ).toBe(true);
      expect(
        flow.readers.map((r) => r.kind),
        name,
      ).toEqual(expect.arrayContaining(['maintainer', 'console']));
    }
  });

  it('draws the chief of staff reading everyone and the wing reading its manager', () => {
    for (const [name, flow] of flows) {
      if (name === 'chief-of-staff') continue;
      expect(flow.readers, name).toContainEqual({ kind: 'agent', detail: 'chief-of-staff' });
    }
    expect(flows.get('chief-of-staff')!.outputs.map((o) => o.kind)).toEqual(
      expect.arrayContaining(['brief', 'desk-questions', 'handoffs']),
    );
    for (const member of ['seo-search', 'social-media', 'growth-analyst']) {
      expect(flows.get(member)!.readers, member).toContainEqual({
        kind: 'agent',
        detail: 'marketing-manager',
      });
      expect(flows.get('marketing-manager')!.readers).toContainEqual({
        kind: 'agent',
        detail: member,
      });
    }
  });

  it('reads the web, the live site or a canvas only where the tools allow it', () => {
    for (const file of files) {
      const kinds = flows.get(file.name)!.inputs.map((i) => i.kind);
      expect(kinds.includes('web'), file.name).toBe(
        file.tools.some((t) => t === 'WebSearch' || t === 'WebFetch'),
      );
      expect(kinds.includes('live-site'), file.name).toBe(
        file.tools.some((t) => t.startsWith('mcp__Claude_Browser__')),
      );
      expect(kinds.includes('design-canvas'), file.name).toBe(file.tools.includes('Artifact'));
    }
  });
});
