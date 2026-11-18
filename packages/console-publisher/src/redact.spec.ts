import type { ConsoleMemoryEntry, ConsoleSnapshot } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  MEMORY_NOTE,
  WITHHELD_NOTE,
  redactSecurityText,
  securityLedger,
  withheldIdsIn,
  withheldLine,
  withholds,
} from './redact.ts';
import {
  type FindingLine,
  agentOf,
  emptyState,
  findingsFrom,
  parseAgentFile,
  reportsFrom,
  snapshotOf,
} from './snapshot.ts';

/** What must never reach the console: the words of a withheld finding's detail. */
const SECRET = ['EVIDENCE-MARK', 'CAUSE-MARK', 'PROPOSAL-MARK'];

const finding = (
  id: string,
  status: string | undefined,
  extra: Record<string, unknown> = {},
): FindingLine => ({
  file: '2026-11-19.jsonl',
  record: {
    id,
    agent: 'security',
    severity: 'major',
    title: `Title of ${id}`,
    evidence: `EVIDENCE-MARK of ${id}`,
    likely_cause: 'CAUSE-MARK',
    proposal: 'PROPOSAL-MARK',
    ...(status === undefined ? {} : { status }),
    ...extra,
  },
});

const OPEN = 'sec-2026-11-19-01';
const ACCEPTED = 'sec-2026-11-19-02';
const DECIDE = 'sec-2026-11-19-03';
const UNVERIFIED = 'sec-2026-11-19-04';
const RESOLVED = 'sec-2026-11-19-05';
const PUBLIC = 'sec-2026-11-19-06';
const REOPENED = 'sec-2026-11-19-07';
const UNKNOWN = 'sec-2026-11-19-99';

const LINES: FindingLine[] = [
  finding(OPEN, 'new'),
  finding(ACCEPTED, 'accepted'),
  finding(DECIDE, 'decide'),
  finding(UNVERIFIED, 'fixed-unverified'),
  finding(RESOLVED, 'resolved'),
  finding(PUBLIC, 'accepted', { public: true }),
  finding(REOPENED, 'resolved'),
  finding(REOPENED, 'open'),
  // Not the security agent's, and it quotes one that is withheld.
  {
    file: '2026-11-19.jsonl',
    record: {
      id: 'rev-2026-11-19-01',
      agent: 'code-reviewer',
      severity: 'minor',
      title: 'A review',
      evidence: `See ${ACCEPTED}: EVIDENCE-MARK copied here.`,
    },
  },
  {
    file: '2026-11-19.jsonl',
    record: { id: 'ops-2026-11-19-01', agent: 'ops-release', title: 'Disk', evidence: 'df 71%' },
  },
];
const LEDGER = securityLedger(LINES);

const agent = (name: string, memoryEntries: ConsoleMemoryEntry[]) =>
  agentOf(
    {
      file: parseAgentFile(
        `---\nname: ${name}\ndescription: An agent\ntools: Read\nmodel: sonnet\nmemory: project\n---\n\nBody.\n`,
      )!,
      skills: [],
      steps: [],
      memoryEntries,
      findingDays: new Map(),
      reportDays: [],
    },
    emptyState(),
  );

const memory = (owner: string, text: string): ConsoleMemoryEntry => ({
  path: `.claude/agent-memory/${owner}/notes.md`,
  updated_at: '2026-11-19T08:00:00.000Z',
  text,
});

const BRIEF = [
  '# Brief 2026-11-19',
  '',
  '## Ops',
  '',
  '- Disk is fine.',
  `- ${RESOLVED} was re-checked: EVIDENCE-OF-RESOLVED may show.`,
  '',
  '## Security',
  '',
  `- **${ACCEPTED}** (major): EVIDENCE-MARK in the bullet,`,
  '  PROPOSAL-MARK on its second line.',
  '  - CAUSE-MARK in a sub-bullet.',
  '- Headers were checked and are fine.',
  '',
  `### ${OPEN} the open one`,
  '',
  'EVIDENCE-MARK in the section body.',
  '',
  '- PROPOSAL-MARK in a list of the section.',
  '',
  '## Decisions',
  '',
  'Nothing waits.',
].join('\n');

function snapshot(): ConsoleSnapshot {
  return snapshotOf(
    {
      generated_at: '2026-11-19T09:00:00.000Z',
      agents: [
        agent('security', [memory('security', 'How the guard is bypassed: EVIDENCE-MARK.')]),
        agent('chief-of-staff', [
          memory('chief-of-staff', `Baseline: 3 findings a day.\n\n- ${DECIDE}: CAUSE-MARK noted.`),
        ]),
      ],
      findings: findingsFrom(LINES),
      reports: reportsFrom([
        { agent: 'security', name: '2026-11-19.md', text: '# Weekly check\n\nEVIDENCE-MARK.' },
        { agent: 'chief-of-staff', name: '2026-11-19.md', text: BRIEF },
        { agent: 'ops-release', name: '2026-11-19.md', text: '# Ops\n\nAll containers are up.' },
      ]),
      brief: { date: '2026-11-19', text: BRIEF },
      decisions: [
        {
          id: 'q-1',
          title: 'Fix it this week?',
          status: 'open',
          summary: `About ${UNVERIFIED}: PROPOSAL-MARK.`,
          options: [],
          answer: null,
          decided_by: null,
          decided_at: null,
        },
      ],
    },
    LEDGER,
  );
}

describe('which security findings are withheld (T-1879, rule 1)', () => {
  it('releases only a resolved one or one marked public, by its latest line', () => {
    const withheld = (id: string) => withholds(LEDGER, id, 'security');
    expect([OPEN, ACCEPTED, DECIDE, UNVERIFIED, REOPENED, UNKNOWN].map(withheld)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect([RESOLVED, PUBLIC].map(withheld)).toEqual([false, false]);
    // No status, a word the charter does not have, and `public` that is not exactly true.
    const odd = securityLedger([
      finding('sec-2026-11-20-01', undefined),
      finding('sec-2026-11-20-02', 'fixed'),
      finding('sec-2026-11-20-03', 'accepted', { public: 'yes' }),
    ]);
    for (const id of odd.keys()) expect(withholds(odd, id, 'security')).toBe(true);
    // The id's shape is enough, whoever wrote the line; another agent's finding is not ours.
    expect(withholds(LEDGER, UNKNOWN, 'chief-of-staff')).toBe(true);
    expect(withholds(LEDGER, 'ops-2026-11-19-01', 'ops-release')).toBe(false);
  });
});

describe('the snapshot as it leaves the computer (T-1879)', () => {
  const sent = snapshot();
  const whole = JSON.stringify(sent);

  it('bypass (a): an accepted, decide or unverified security finding keeps no detail', () => {
    const byId = new Map(sent.findings.map((f) => [f.id, f]));
    for (const id of [OPEN, ACCEPTED, DECIDE, UNVERIFIED, REOPENED]) {
      expect(byId.get(id)).toMatchObject({
        id,
        agent: 'security',
        severity: 'major',
        title: `Title of ${id}`,
        detail: null,
        related: null,
      });
    }
    expect(byId.get(ACCEPTED)?.status).toBe('wontfix');
    expect(byId.get(RESOLVED)?.detail).toContain(`EVIDENCE-MARK of ${RESOLVED}`);
    expect(byId.get(PUBLIC)?.detail).toContain(`EVIDENCE-MARK of ${PUBLIC}`);
    expect(byId.get('ops-2026-11-19-01')?.detail).toBe('df 71%');
    // Another agent's finding that quotes a withheld one loses the quote.
    expect(byId.get('rev-2026-11-19-01')?.detail).toContain(WITHHELD_NOTE);
    expect(byId.get('rev-2026-11-19-01')?.detail).not.toContain('EVIDENCE-MARK');
  });

  it('bypass (b): the brief loses every part that names a withheld finding', () => {
    const brief = sent.brief!.text;
    for (const secret of SECRET) expect(brief).not.toContain(secret);
    expect(brief.split('\n')).toEqual([
      '# Brief 2026-11-19',
      '',
      '## Ops',
      '',
      '- Disk is fine.',
      `- ${RESOLVED} was re-checked: EVIDENCE-OF-RESOLVED may show.`,
      '',
      '## Security',
      '',
      `- [${ACCEPTED} · security · major] Title of ${ACCEPTED} — ${WITHHELD_NOTE}`,
      '- Headers were checked and are fine.',
      '',
      `### [${OPEN} · security · major] Title of ${OPEN} — ${WITHHELD_NOTE}`,
      '',
      '## Decisions',
      '',
      'Nothing waits.',
    ]);
    // The brief is also the chief of staff's report: the same text, the same rule.
    const report = sent.reports.find((r) => r.agent === 'chief-of-staff')!;
    expect(report.text).toBe(brief);
  });

  it("bypass (d): the security agent's memory and reports go out empty", () => {
    const security = sent.agents.find((a) => a.name === 'security')!;
    expect(security.memory.entries).toEqual([
      {
        path: '.claude/agent-memory/security/',
        updated_at: '2026-11-19T09:00:00.000Z',
        text: MEMORY_NOTE,
      },
    ]);
    expect(sent.reports.find((r) => r.agent === 'security')).toMatchObject({
      title: 'Weekly check',
      text: '',
    });
    // Another agent's memory and a desk question's context follow the text rule.
    const chief = sent.agents.find((a) => a.name === 'chief-of-staff')!;
    expect(chief.memory.entries[0]!.text).toBe(
      `Baseline: 3 findings a day.\n\n- [${DECIDE} · security · major] Title of ${DECIDE} — ${WITHHELD_NOTE}`,
    );
    expect(sent.decisions[0]!.summary).toBe(
      `[${UNVERIFIED} · security · major] Title of ${UNVERIFIED} — ${WITHHELD_NOTE}`,
    );
    expect(sent.reports.find((r) => r.agent === 'ops-release')!.text).toBe(
      '# Ops\n\nAll containers are up.',
    );
  });

  it('carries no detail of a withheld finding anywhere', () => {
    // The only marks left are the resolved and the public finding's own.
    const marks = whole.match(/(?:EVIDENCE|CAUSE|PROPOSAL)-MARK(?: of sec-[0-9-]+)?/g) ?? [];
    const allowed = new Set([
      `EVIDENCE-MARK of ${RESOLVED}`,
      `EVIDENCE-MARK of ${PUBLIC}`,
      'CAUSE-MARK',
      'PROPOSAL-MARK',
    ]);
    for (const mark of marks) expect(allowed.has(mark)).toBe(true);
    // Two releasable findings, each with one cause and one proposal: nothing else.
    expect(marks.filter((m) => m === 'CAUSE-MARK')).toHaveLength(2);
    expect(marks.filter((m) => m === 'PROPOSAL-MARK')).toHaveLength(2);
    expect(marks.filter((m) => m.startsWith('EVIDENCE-MARK'))).toHaveLength(2);
  });
});

describe('the text rule (T-1879, rule 3)', () => {
  const redact = (text: string) => redactSecurityText(text, LEDGER);

  it('returns text that names no withheld finding exactly as it was', () => {
    const text = `# Title\r\n\r\n- ${RESOLVED} and ${PUBLIC} are fine.\r\n- ops-2026-11-19-01\r\n`;
    expect(redact(text)).toBe(text);
    expect(withheldIdsIn(text, LEDGER)).toEqual([]);
  });

  it('finds an id in any case, in Persian digits, and one the findings files do not have', () => {
    expect(withheldIdsIn(`SEC-2026-11-19-01, ${UNKNOWN}`, LEDGER)).toEqual([OPEN, UNKNOWN]);
    expect(withheldIdsIn('یافته‌ی sec-۲۰۲۶-۱۱-۱۹-۰۲ باز است', LEDGER)).toEqual([ACCEPTED]);
    expect(withheldIdsIn('sec-2026-11-19-011 is another id', LEDGER)).toEqual([
      'sec-2026-11-19-011',
    ]);
    // An unknown id shows the id alone: there is no severity or title to give.
    expect(withheldLine([UNKNOWN], LEDGER)).toBe(`[${UNKNOWN} · security] — ${WITHHELD_NOTE}`);
  });

  it('redacts a list item with what is indented under it, and leaves its neighbours', () => {
    const text = [
      '- before',
      `- ${ACCEPTED}: EVIDENCE-MARK`,
      '',
      '  A loose paragraph of the item: CAUSE-MARK.',
      '',
      '      code under it: PROPOSAL-MARK',
      '- after',
    ].join('\n');
    expect(redact(text).split('\n')).toEqual([
      '- before',
      `- [${ACCEPTED} · security · major] Title of ${ACCEPTED} — ${WITHHELD_NOTE}`,
      '- after',
    ]);
  });

  it('redacts a table row alone and a paragraph whole', () => {
    const text = [
      '| id | severity | note |',
      '| --- | --- | --- |',
      `| ${DECIDE} | major | EVIDENCE-MARK |`,
      '| ops-2026-11-19-01 | minor | disk |',
      '',
      `The weakness ${OPEN} is this:`,
      'EVIDENCE-MARK on the next line of the paragraph.',
      '',
      'An unrelated paragraph.',
    ].join('\n');
    expect(redact(text).split('\n')).toEqual([
      '| id | severity | note |',
      '| --- | --- | --- |',
      `| [${DECIDE} · security · major] Title of ${DECIDE} — ${WITHHELD_NOTE} |`,
      '| ops-2026-11-19-01 | minor | disk |',
      '',
      `[${OPEN} · security · major] Title of ${OPEN} — ${WITHHELD_NOTE}`,
      '',
      'An unrelated paragraph.',
    ]);
  });

  it('takes the list a redacted paragraph introduced, tight or after a gap', () => {
    for (const gap of [[], ['']]) {
      const text = [
        `**${ACCEPTED}** (major):`,
        ...gap,
        '- Where: EVIDENCE-MARK',
        '- Why: CAUSE-MARK',
        '',
        '- Fix: PROPOSAL-MARK',
        '',
        'The next paragraph stays.',
      ].join('\n');
      expect(redact(text).split('\n')).toEqual([
        `[${ACCEPTED} · security · major] Title of ${ACCEPTED} — ${WITHHELD_NOTE}`,
        '',
        'The next paragraph stays.',
      ]);
    }
  });

  it('drops a section whose heading names one, up to the next heading of its level', () => {
    const text = [
      '## Findings',
      `### ${OPEN} (major)`,
      'EVIDENCE-MARK',
      '#### Detail',
      'CAUSE-MARK',
      '### Another finding',
      'Stays.',
    ].join('\n');
    expect(redact(text).split('\n')).toEqual([
      '## Findings',
      `### [${OPEN} · security · major] Title of ${OPEN} — ${WITHHELD_NOTE}`,
      '',
      '### Another finding',
      'Stays.',
    ]);
  });

  it('bypass (c): a chat reply that quotes a withheld finding loses the quote before upload', () => {
    const reply = [
      'سلام. سه یافته‌ی امنیتی باز است.',
      '',
      `- ${ACCEPTED}: the weakness is reached like this: EVIDENCE-MARK, PROPOSAL-MARK.`,
      `- ${RESOLVED}: fixed and re-checked.`,
    ].join('\n');
    const sent = redact(reply);
    for (const secret of SECRET) expect(sent).not.toContain(secret);
    expect(sent.split('\n')).toEqual([
      'سلام. سه یافته‌ی امنیتی باز است.',
      '',
      `- [${ACCEPTED} · security · major] Title of ${ACCEPTED} — ${WITHHELD_NOTE}`,
      `- ${RESOLVED}: fixed and re-checked.`,
    ]);
    expect(withheldIdsIn(reply, LEDGER)).toEqual([ACCEPTED]);
  });
});
