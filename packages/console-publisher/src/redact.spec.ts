import type { ConsoleMemoryEntry, ConsoleSnapshot } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  MEMORY_NOTE,
  WITHHELD_NOTE,
  guardText,
  normalId,
  redactSecurityText,
  redactionsIn,
  securityIdsIn,
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
          options: [
            { key: 'now', label: `Now, as ${ACCEPTED} proposes: PROPOSAL-MARK` },
            { key: 'later', label: 'Later' },
          ],
          answer: `Now, as ${ACCEPTED} proposes: PROPOSAL-MARK`,
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
    // Its options and the answer shown (an option's label) too; the question itself stays.
    const option = `[${ACCEPTED} · security · major] Title of ${ACCEPTED} — ${WITHHELD_NOTE}`;
    expect(sent.decisions[0]).toMatchObject({
      title: 'Fix it this week?',
      options: [
        { key: 'now', label: option },
        { key: 'later', label: 'Later' },
      ],
      answer: option,
    });
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
    // The number is read as a number: 011 is the eleventh, 5 the fifth.
    expect(withheldIdsIn('sec-2026-11-19-011 is the eleventh', LEDGER)).toEqual([
      'sec-2026-11-19-11',
    ]);
    expect(normalId('SEC-2026-11-19-5')).toBe(RESOLVED);
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

describe('who may release a security finding (review of #947, rule 1)', () => {
  const by = (agent: string, id: string, status: string, extra: Record<string, unknown> = {}) =>
    finding(id, status, { agent, ...extra });
  const ID = 'sec-2026-11-21-01';
  const withheld = (lines: FindingLine[]) => withholds(securityLedger(lines), ID, 'security');

  it("releases on resolved only when the latest line is the security agent's own", () => {
    expect(withheld([by('security', ID, 'resolved')])).toBe(false);
    // Another agent cannot close a security finding, first or last.
    expect(withheld([by('chief-of-staff', ID, 'resolved')])).toBe(true);
    expect(withheld([by('security', ID, 'open'), by('code-reviewer', ID, 'resolved')])).toBe(true);
    // And any later line reopens one the security agent closed.
    expect(withheld([by('security', ID, 'resolved'), by('chief-of-staff', ID, 'open')])).toBe(true);
    expect(withheld([by('security', ID, 'resolved'), by('security', ID, 'open')])).toBe(true);
    expect(
      withheld([
        by('security', ID, 'open'),
        by('ops-release', ID, 'resolved'),
        by('security', ID, 'resolved'),
      ]),
    ).toBe(false);
  });

  it('keeps the public mark from any line until a later line takes it back', () => {
    const open = (extra: Record<string, unknown> = {}) => by('security', ID, 'open', extra);
    expect(withheld([open({ public: true })])).toBe(false);
    // Whoever wrote the line, and on later lines that do not carry the field.
    expect(withheld([open(), by('chief-of-staff', ID, 'accepted', { public: true })])).toBe(false);
    expect(withheld([open({ public: true }), open(), open()])).toBe(false);
    // Only an explicit false takes it back, and a later true gives it again.
    expect(withheld([open({ public: true }), open({ public: false })])).toBe(true);
    expect(withheld([open({ public: true }), open({ public: false }), open()])).toBe(true);
    expect(withheld([open({ public: false }), open({ public: true })])).toBe(false);
    expect(withheld([open({ public: 'true' }), open({ public: 1 })])).toBe(true);
  });

  it("keeps a finding the security agent's when another agent writes its next line", () => {
    // An id that is not the charter's shape: only the first line says whose it is.
    const lines = [
      by('security', 'hardening-7', 'open'),
      by('ops-release', 'hardening-7', 'resolved'),
    ];
    const ledger = securityLedger(lines);
    expect(withholds(ledger, 'hardening-7', 'ops-release')).toBe(true);
    const sent = snapshotOf(
      {
        generated_at: '2026-11-21T09:00:00.000Z',
        agents: [],
        findings: findingsFrom(lines),
        reports: [],
        brief: { date: '2026-11-21', text: '- hardening-7: EVIDENCE-MARK\n- other' },
        decisions: [],
      },
      ledger,
    );
    expect(sent.findings[0]).toMatchObject({ id: 'hardening-7', detail: null, related: null });
    expect(sent.brief!.text).not.toContain('EVIDENCE-MARK');
    expect(sent.brief!.text).toContain('- other');
  });
});

describe('an id however it is written (review of #947, rule 3)', () => {
  const DAY = 'sec-2026-11-19';
  const ids = (...numbers: number[]) => numbers.map((n) => `${DAY}-${String(n).padStart(2, '0')}`);
  const redact = (text: string) => redactSecurityText(text, LEDGER);

  it('reads every id of a range', () => {
    for (const text of [
      `${DAY}-05..07`,
      `${DAY}-05...07`,
      `${DAY}-05…07`,
      `${DAY}-05-07`,
      `${DAY}-05–07`,
      `${DAY}-05 — 07`,
      `${DAY}-05 to 07`,
      `${DAY}-05 تا ۰۷`,
      `${DAY}-05 to ${DAY}-07`,
      `${DAY}-07..05`,
    ])
      expect([text, securityIdsIn(text).sort()]).toEqual([text, ids(5, 6, 7)]);
  });

  it('reads every id of a list, and a list after a range', () => {
    for (const text of [
      `${DAY}-05/07`,
      `${DAY}-05/-07`,
      `${DAY}-05, -07`,
      `${DAY}-05, 07`,
      `${DAY}-05، ۰۷`,
      `${DAY}-05 and 07`,
      `${DAY}-05 و 07`,
      `${DAY}-05 & ${DAY}-07`,
    ])
      expect([text, securityIdsIn(text)]).toEqual([text, ids(5, 7)]);
    expect(securityIdsIn(`${DAY}-01..03, 05/07 and -09`)).toEqual(ids(1, 2, 3, 5, 7, 9));
    // A bare number that is not written like the id's own is not one of the list.
    expect(securityIdsIn(`${DAY}-05, 3 containers and 120 requests`)).toEqual(ids(5));
    // Another day's id is its own.
    expect(securityIdsIn(`${DAY}-05, sec-2026-11-20-01`)).toEqual([...ids(5), 'sec-2026-11-20-01']);
  });

  it('redacts the block when ANY id of a range or list is withheld', () => {
    // 05 is resolved and 06 public: both may show. 04 and 07 are withheld.
    const fine = `- ${DAY}-05..06 are closed: EVIDENCE-OF-CLOSED.`;
    expect(redact(fine)).toBe(fine);
    for (const text of [
      `- ${DAY}-05..07 share a cause: CAUSE-MARK.`,
      `- ${DAY}-05/07: CAUSE-MARK.`,
      `- ${DAY}-05, -06, -07: CAUSE-MARK.`,
      `- ${DAY}-06–07: CAUSE-MARK.`,
      `- ${DAY}-04/05: CAUSE-MARK.`,
    ]) {
      const sent = redact(text);
      expect(sent).not.toContain('CAUSE-MARK');
      expect(redactionsIn(sent)).toBe(1);
    }
    // Every withheld id of the range is named in the line, the releasable ones are not.
    expect(withheldIdsIn(`${DAY}-04..07`, LEDGER)).toEqual(ids(4, 7));
    // An id of the range the findings files do not have is withheld too.
    expect(withheldIdsIn(`${DAY}-05..06, 08`, LEDGER)).toEqual(ids(8));
  });

  it('finds an id typed with other dashes, hidden marks or other digits', () => {
    const c = (...codes: number[]) => String.fromCharCode(...codes);
    const dashes = [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212];
    for (const code of dashes) {
      const typed = ACCEPTED.split('-').join(c(code));
      expect([code, withheldIdsIn(`See ${typed}.`, LEDGER)]).toEqual([code, [ACCEPTED]]);
    }
    const hidden = [
      0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066,
      0x2067, 0x2068, 0x2069,
    ];
    for (const code of hidden) {
      // Between the letters, after a dash and around the id.
      const typed = `${c(code)}se${c(code)}c-2026-${c(code)}11-19-0${c(code)}2${c(code)}`;
      expect([code, withheldIdsIn(`See ${typed}.`, LEDGER)]).toEqual([code, [ACCEPTED]]);
    }
    // Persian and Arabic digits.
    const persian = ACCEPTED.replace(/\d/g, (d) => c(0x06f0 + Number(d)));
    const arabic = ACCEPTED.replace(/\d/g, (d) => c(0x0660 + Number(d)));
    expect(withheldIdsIn(`${persian} ${arabic}`, LEDGER)).toEqual([ACCEPTED]);
    const text = `- ${persian}: EVIDENCE-MARK`;
    expect(redact(text)).toBe(
      `- [${ACCEPTED} · security · major] Title of ${ACCEPTED} — ${WITHHELD_NOTE}`,
    );
  });
});

describe('fenced code and the section rule (review of #947, rule 3a)', () => {
  const redact = (text: string) => redactSecurityText(text, LEDGER);
  const stub = `[${OPEN} · security · major] Title of ${OPEN} — ${WITHHELD_NOTE}`;

  it('does not end a withheld section at a # line inside a fence', () => {
    for (const fence of ['```', '~~~', '````']) {
      const text = [
        `## ${OPEN}`,
        'EVIDENCE-MARK',
        `${fence}sh`,
        '# a comment, not a heading',
        'CAUSE-MARK',
        '',
        '## also not a heading',
        fence,
        'PROPOSAL-MARK after the fence, still in the section.',
        '## The next section',
        'Stays.',
      ].join('\n');
      expect(redact(text).split('\n')).toEqual([`## ${stub}`, '', '## The next section', 'Stays.']);
    }
  });

  it('keeps a fenced block whole inside the block it belongs to', () => {
    const text = [
      `- ${OPEN}: reached like this:`,
      '  ```',
      '  CAUSE-MARK',
      '',
      '  # PROPOSAL-MARK',
      '  ```',
      '- next item',
      '',
      '```',
      '# a fence of its own, with no id: untouched',
      '',
      '- not an item',
      '```',
    ].join('\n');
    expect(redact(text).split('\n')).toEqual([
      `- ${stub}`,
      '- next item',
      '',
      '```',
      '# a fence of its own, with no id: untouched',
      '',
      '- not an item',
      '```',
    ]);
    // A fence that names a withheld id goes whole, gaps and all.
    const fenced = [
      'Before.',
      '',
      '```',
      'first',
      '',
      `${OPEN} EVIDENCE-MARK`,
      '```',
      '',
      'After.',
    ];
    expect(redact(fenced.join('\n')).split('\n')).toEqual(['Before.', '', stub, '', 'After.']);
  });
});

describe('the other text the publisher uploads (review of #947)', () => {
  it("guards a command's outcome, a request's result and a request's question", () => {
    const outcome = `Failed while reading ${ACCEPTED}: EVIDENCE-MARK`;
    expect(guardText(outcome, LEDGER)).toEqual({
      text: `[${ACCEPTED} · security · major] Title of ${ACCEPTED} — ${WITHHELD_NOTE}`,
      withheld: [ACCEPTED],
    });
    const result = [
      'انجام شد.',
      '',
      '| یافته | وضعیت |',
      '| --- | --- |',
      `| ${RESOLVED} | بسته |`,
      `| ${DECIDE} | CAUSE-MARK |`,
    ].join('\n');
    const guarded = guardText(result, LEDGER);
    expect(guarded.withheld).toEqual([DECIDE]);
    expect(guarded.text).not.toContain('CAUSE-MARK');
    expect(guarded.text).toContain(`| ${RESOLVED} | بسته |`);
    expect(redactionsIn(guarded.text)).toBe(1);
    const question = `آیا ${OPEN} و ${UNVERIFIED} را همین هفته ببندیم؟ PROPOSAL-MARK`;
    expect(guardText(question, LEDGER).withheld).toEqual([OPEN, UNVERIFIED]);
    expect(guardText(question, LEDGER).text).not.toContain('PROPOSAL-MARK');
    // Text that names no withheld finding goes as written.
    const plain = 'Paused: the daily run skips it.';
    expect(guardText(plain, LEDGER)).toEqual({ text: plain, withheld: [] });
  });
});
