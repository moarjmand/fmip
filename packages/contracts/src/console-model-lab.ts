/**
 * The model lab's ledger (T-1752, D-371): everything ever tested on the
 * forecast model -- an input, a set of constants, a whole version -- with why
 * it was tried, on what data, the measured effect, the verdict and the
 * decision that recorded it. The verdicts are the decisions' (D-139, D-329,
 * D-335, ...); this is their structured twin, kept by the model scientist in
 * one file on the maintainer's computer, where the lab runs, and carried to
 * the console inside the snapshot (`ConsoleSnapshot.model_lab`). The console
 * computes nothing from it and judges nothing: it shows what the file says,
 * and says so when the file is missing.
 *
 * The words (`title`, `why`, `data`, `reason`, `note`, a judgement's `text`)
 * are Persian, as the console is; `technical`, versions, decisions and paths
 * are left to right.
 */

export const CONSOLE_LAB_SCHEMA = 1;

/**
 * What became of a test. `insufficient`: too few matches to judge (D-139's
 * 300). `parked`: seen, not formulated yet. `scheduled`: written before its
 * matches exist (D-334). `not_run`: decided against without a run.
 */
export const CONSOLE_LAB_VERDICTS = [
  'adopted',
  'rejected',
  'insufficient',
  'parked',
  'running',
  'scheduled',
  'not_run',
] as const;
export type ConsoleLabVerdict = (typeof CONSOLE_LAB_VERDICTS)[number];

/** What was tested: a new input, tuned constants, a whole version, or a control that must fail. */
export const CONSOLE_LAB_KINDS = ['input', 'constants', 'version', 'control'] as const;
export type ConsoleLabKind = (typeof CONSOLE_LAB_KINDS)[number];

/** D-139 judges the football-data leagues and our own records separately; cups are the cross-league fit. */
export const CONSOLE_LAB_GROUPS = ['football_data', 'our_records', 'cross_league', 'all'] as const;
export type ConsoleLabGroupKey = (typeof CONSOLE_LAB_GROUPS)[number];

export const CONSOLE_LAB_GROUP_RESULTS = ['passed', 'failed', 'insufficient', 'not_judged'] as const;
export type ConsoleLabGroupResult = (typeof CONSOLE_LAB_GROUP_RESULTS)[number];

export const CONSOLE_LAB_ENTRIES_MAX = 200;
export const CONSOLE_LAB_TEXT_MAX = 1200;

/** One group of matches a test was judged on. Every number is the report's, or null. */
export interface ConsoleLabGroup {
  group: ConsoleLabGroupKey;
  /** What narrows the group, in words: a season, a machine, a band. */
  label: string | null;
  result: ConsoleLabGroupResult;
  /** Matches the tested thing could be read on, and every match of the window. */
  matches: number | null;
  matches_total: number | null;
  /** Log loss with it minus without it, per match; negative is better. */
  difference: number | null;
  /** The difference's 95% interval. */
  low: number | null;
  high: number | null;
  /** Log loss without it (the reference) and with it, where the report gives them. */
  reference_log_loss: number | null;
  tested_log_loss: number | null;
  /** Divisions it was worse in, of how many, and which (their codes). */
  worse_divisions: number | null;
  divisions: number | null;
  worse_in: string[];
  /** Calibration error without it and with it. */
  calibration_before: number | null;
  calibration_after: number | null;
  /** Anything the numbers do not say, in a sentence. */
  note: string | null;
}

export interface ConsoleLabEntry {
  /** Stable, unique: `rest_days`, `xg_form`, ... */
  key: string;
  /** The question it belongs to, in words; entries of one family are read together. */
  family: string;
  /** The project phase it was tested in, or null. */
  phase: number | null;
  title: string;
  technical: string;
  kind: ConsoleLabKind;
  /** Why it was tried. */
  why: string;
  /** On what data: the store, the window, the history. */
  data: string;
  /** The model version it was judged against, or null where there was none. */
  against: string | null;
  groups: ConsoleLabGroup[];
  verdict: ConsoleLabVerdict;
  /** The verdict's reason in one or two sentences. */
  reason: string;
  /** The decisions that recorded it, `D-329`. */
  decisions: string[];
  task: string | null;
  /** The day of the verdict, `YYYY-MM-DD`; null while it runs. */
  decided_on: string | null;
  /** `running` and `scheduled`: the day it is judged. */
  due_on: string | null;
  /** The lab's report files, as paths on the computer. */
  reports: string[];
  /** What no stored source gives for this entry, said instead of guessed (rule 3). */
  missing: string[];
}

/**
 * One promotion condition's recorded look (D-336's amendment: each is
 * judged once, by the weekly watch, and that verdict stands).
 */
export interface ConsoleLabJudgement {
  model_version: string;
  rule: string;
  /** `no_worse`, `better_than_chance`, `paired_improvement`, in the rule's own words. */
  condition: string;
  result: 'met' | 'not_met';
  judged_on: string;
  matches: number | null;
  /** The verdict with its figures, as the weekly report wrote it. */
  text: string;
  report: string | null;
}

export interface ConsoleModelLab {
  schema: number;
  /** When the ledger file was last changed. */
  updated_at: string;
  entries: ConsoleLabEntry[];
  judgements: ConsoleLabJudgement[];
}
