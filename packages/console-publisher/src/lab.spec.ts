import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { labFrom } from './lab.ts';

/**
 * The model lab's ledger file, checked on the computer (T-1752, D-371): an
 * entry with any problem is left out and counted, each problem is named
 * with its entry, and a file that is not a ledger publishes none.
 */

const CHANGED = '2026-11-06T18:00:00.000Z';

const group = (overrides: Record<string, unknown> = {}) => ({
  group: 'football_data',
  label: null,
  result: 'failed',
  matches: 3571,
  matches_total: 5689,
  difference: 0.00065,
  low: -0.00122,
  high: 0.00235,
  reference_log_loss: null,
  tested_log_loss: null,
  worse_divisions: 2,
  divisions: 17,
  worse_in: ['E1', 'SP1'],
  calibration_before: 0.0177,
  calibration_after: 0.0232,
  note: null,
  ...overrides,
});

const entry = (overrides: Record<string, unknown> = {}) => ({
  key: 'coach_quality',
  family: 'مربی',
  phase: 14,
  title: 'کیفیت مربی',
  technical: 'coach_quality',
  kind: 'input',
  why: 'مربی بهتر باید نتیجه‌ی بهتری بگیرد.',
  data: 'فصل ۲۰۲۴/۲۵',
  against: 'dixon-coles-elo@0.7.0',
  groups: [group()],
  verdict: 'rejected',
  reason: 'در هر دو گروه بدتر کرد.',
  decisions: ['D-310', 'D-335'],
  task: 'T-1658',
  decided_on: '2026-11-01',
  due_on: null,
  reports: ['E:/FMIP/lab-local/reports/cq-fd'],
  missing: [],
  ...overrides,
});

const ledger = (entries: unknown[], extra: Record<string, unknown> = {}) => ({
  schema: 1,
  updated_at: '2026-11-05T10:00:00.000Z',
  entries,
  judgements: [],
  ...extra,
});

describe('the ledger file', () => {
  it('publishes a clean ledger as it is, with nothing skipped', () => {
    const read = labFrom(ledger([entry()]), CHANGED);
    expect(read.problems).toEqual([]);
    expect(read.lab).toEqual({
      schema: 1,
      updated_at: '2026-11-05T10:00:00.000Z',
      skipped: 0,
      entries: [entry()],
      judgements: [],
    });
  });

  it("takes the file's own time when the ledger names none", () => {
    const read = labFrom(ledger([entry()], { updated_at: undefined }), CHANGED);
    expect(read.lab?.updated_at).toBe(CHANGED);
  });

  it('publishes none when the file is not a ledger', () => {
    expect(labFrom([], CHANGED)).toEqual({
      lab: null,
      problems: ['The ledger is not a JSON object.'],
    });
    expect(labFrom(ledger([], { schema: 3 }), CHANGED).lab).toBeNull();
    expect(labFrom({ schema: 1, entries: {} }, CHANGED).lab).toBeNull();
  });

  it('leaves out an entry with a problem, counts it and names the problem', () => {
    const read = labFrom(
      ledger([
        entry(),
        entry({ key: 'xg_form', verdict: 'promising' }),
        entry({ key: 'Rest Days' }),
        entry({ key: 'no_reason', reason: '' }),
        entry({ key: 'coach_quality', title: 'دوباره' }),
      ]),
      CHANGED,
    );
    expect(read.lab?.entries.map((e) => e.key)).toEqual(['coach_quality']);
    expect(read.lab?.skipped).toBe(4);
    expect(read.problems).toEqual([
      'xg_form: verdict is not one of adopted, rejected, insufficient, parked, running, scheduled, not_run',
      'Rest Days: key may hold only a-z, 0-9 and _',
      'no_reason: reason is missing',
      'coach_quality: the key is used twice',
    ]);
  });

  it('holds the figures to each other: an interval, a share, a count', () => {
    const bad = (overrides: Record<string, unknown>) =>
      labFrom(ledger([entry({ groups: [group(overrides)] })]), CHANGED);
    expect(bad({ low: 0.01, high: -0.01, difference: 0 }).problems).toContain(
      'coach_quality, group 1: the interval is upside down',
    );
    expect(bad({ difference: 0.5 }).problems).toEqual([
      'coach_quality, group 1: the difference is outside its own interval',
    ]);
    expect(bad({ high: null }).problems).toEqual([
      'coach_quality, group 1: an interval needs both its ends',
    ]);
    expect(bad({ matches: 6000 }).problems).toEqual([
      'coach_quality, group 1: more matches read than the window holds',
    ]);
    expect(bad({ worse_divisions: 18, worse_in: [] }).problems).toEqual([
      'coach_quality, group 1: worse in more divisions than it was judged in',
    ]);
    expect(bad({ worse_divisions: 3 }).problems).toEqual([
      'coach_quality, group 1: worse_in does not name as many divisions as worse_divisions counts',
    ]);
    expect(bad({ difference: '0.00065' }).problems).toEqual([
      'coach_quality, group 1: difference is not a number',
    ]);
    expect(bad({ group: 'the big leagues' }).lab?.skipped).toBe(1);
  });

  it('asks a verdict for its decision and its day, and a running test for the day it is judged', () => {
    const problems = (overrides: Record<string, unknown>) =>
      labFrom(ledger([entry(overrides)]), CHANGED).problems;
    expect(problems({ decisions: [] })).toEqual(['coach_quality: names no decision']);
    expect(problems({ decisions: ['the maintainer'] })).toEqual([
      'coach_quality: decision "the maintainer" is not an id like D-329',
    ]);
    expect(problems({ decided_on: null })).toEqual([
      'coach_quality: has a verdict and no day it was decided (decided_on)',
    ]);
    expect(problems({ verdict: 'scheduled', decided_on: null })).toEqual([
      'coach_quality: is scheduled and says no day it is judged (due_on)',
    ]);
    expect(problems({ verdict: 'scheduled', decided_on: null, due_on: '2027-01-05' })).toEqual([]);
    // A signal seen and not yet formulated has no decision of its own.
    expect(problems({ verdict: 'parked', decisions: [], decided_on: null })).toEqual([]);
  });

  it('keeps a recorded judgement only when it is whole', () => {
    const judgement = {
      model_version: 'dixon-coles-elo@0.7.0',
      rule: 'D-336',
      condition: 'no_worse',
      result: 'met',
      judged_on: '2026-11-09',
      matches: 352,
      text: 'بدتر نیست.',
      report: null,
    };
    const read = labFrom(
      ledger([entry()], { judgements: [judgement, { ...judgement, judged_on: 'Monday' }] }),
      CHANGED,
    );
    expect(read.lab?.judgements).toEqual([judgement]);
    expect(read.problems).toEqual([
      'judgement 2: judged_on is not a day (YYYY-MM-DD)',
      'judgement 2: says no day it was judged (judged_on)',
    ]);
  });
});

describe("the ledger's first edition (2026-11-06)", () => {
  it('passes the check whole: 67 entries, nothing left out, no problem', () => {
    const raw: unknown = JSON.parse(
      readFileSync(new URL('../fixtures/model-lab-ledger.json', import.meta.url), 'utf8'),
    );
    const read = labFrom(raw, CHANGED);
    expect(read.problems).toEqual([]);
    expect(read.lab?.entries).toHaveLength(67);
    expect(read.lab?.skipped).toBe(0);
    // A candidate still being judged carries counts only (D-336's one look, D-371).
    const running = read.lab?.entries.find((e) => e.key === 'version_0_7_0_shadow');
    expect(running?.verdict).toBe('running');
    for (const group of running?.groups ?? []) {
      expect(group).toMatchObject({ difference: null, low: null, high: null });
    }
  });
});
