import { describe, expect, it } from 'vitest';
import { checkSnapshot } from './console-rules';
import { checkModelLab } from './model-lab-rules';

/**
 * The model lab's ledger at the server's edge (T-1752, D-371): a ledger that
 * is not one is dropped whole, an entry the console cannot name is dropped,
 * and nothing is repaired -- a figure that is not a number is null.
 */

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
  worse_divisions: 8,
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

const lab = (overrides: Record<string, unknown> = {}) => ({
  schema: 1,
  updated_at: '2026-11-06T18:00:00.000Z',
  skipped: 0,
  entries: [entry()],
  judgements: [],
  ...overrides,
});

describe('the ledger a snapshot carries', () => {
  it('passes a whole ledger through unchanged', () => {
    expect(checkModelLab(lab())).toEqual(lab());
  });

  it('is none when the envelope is not a ledger', () => {
    expect(checkModelLab(undefined)).toBeNull();
    expect(checkModelLab(null)).toBeNull();
    expect(checkModelLab(lab({ schema: 2 }))).toBeNull();
    expect(checkModelLab(lab({ entries: 'all of them' }))).toBeNull();
    expect(checkModelLab(lab({ updated_at: 'yesterday' }))).toBeNull();
  });

  it('drops an entry it cannot name, and a second one with the same key', () => {
    const checked = checkModelLab(
      lab({
        entries: [
          entry(),
          entry({ title: 'دومی با همان کلید' }),
          entry({ key: 'rest days' }),
          entry({ key: 'xg_form', verdict: 'promising' }),
          entry({ key: 'null_control', kind: 'trick' }),
          entry({ key: 'no_title', title: '' }),
          'not an entry',
        ],
      }),
    );
    expect(checked?.entries.map((e) => e.key)).toEqual(['coach_quality']);
    expect(checked?.entries[0]?.title).toBe('کیفیت مربی');
    // Six left out here, on top of the two the computer already left out.
    expect(checked?.skipped).toBe(6);
    expect(checkModelLab(lab({ skipped: 2 }))?.skipped).toBe(2);
  });

  it('keeps a number only when it is one, and never invents the other', () => {
    const checked = checkModelLab(
      lab({
        entries: [
          entry({
            groups: [
              group({ difference: '0.00065', low: Number.NaN, matches: -4, worse_divisions: 2.5 }),
              group({ group: 'the big leagues' }),
              group({ group: 'our_records', result: 'won' }),
            ],
            decisions: ['D-335', 'the maintainer said so', 'D-1'],
            decided_on: 'last week',
            phase: 'fourteen',
          }),
        ],
      }),
    );
    const only = checked?.entries[0];
    expect(only?.groups).toHaveLength(1);
    expect(only?.groups[0]).toMatchObject({
      difference: null,
      low: null,
      high: 0.00235,
      matches: null,
      matches_total: 5689,
      worse_divisions: null,
    });
    expect(only?.decisions).toEqual(['D-335', 'D-1']);
    expect(only?.decided_on).toBeNull();
    expect(only?.phase).toBeNull();
  });

  it('cuts a text at the limit', () => {
    const checked = checkModelLab(lab({ entries: [entry({ reason: 'ب'.repeat(5000) })] }));
    expect(checked?.entries[0]?.reason).toHaveLength(1201);
  });

  it('keeps a recorded judgement only with its version, its day, its result and its words', () => {
    const judgement = {
      model_version: 'dixon-coles-elo@0.7.0',
      rule: 'D-336',
      condition: 'no_worse',
      result: 'met',
      judged_on: '2026-11-09',
      matches: 352,
      text: 'بدتر نیست.',
      report: 'E:/FMIP/ops/reports/model-scientist/2026-11-09.md',
    };
    const checked = checkModelLab(
      lab({
        judgements: [
          judgement,
          { ...judgement, result: 'probably' },
          { ...judgement, judged_on: null },
          { ...judgement, text: '' },
        ],
      }),
    );
    expect(checked?.judgements).toEqual([judgement]);
  });
});

describe('a snapshot with a ledger', () => {
  const snapshot = (model_lab: unknown) => ({
    schema: 1,
    generated_at: '2026-11-06T18:00:00.000Z',
    agents: [],
    findings: [],
    reports: [],
    brief: null,
    decisions: [],
    ...(model_lab === undefined ? {} : { model_lab }),
  });

  it('loads with its ledger checked', () => {
    const checked = checkSnapshot(snapshot(lab()));
    expect(checked.ok && checked.snapshot.model_lab?.entries).toHaveLength(1);
  });

  it('still loads when the ledger is not one: the page then says it was not supplied', () => {
    const broken = checkSnapshot(snapshot({ schema: 1, entries: null }));
    expect(broken.ok && broken.snapshot.model_lab).toBeNull();
    const absent = checkSnapshot(snapshot(undefined));
    expect(absent.ok && absent.snapshot.model_lab).toBeNull();
  });
});
