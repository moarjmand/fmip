import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The moderation queue on the web (T-610).
 *
 * The acceptance criterion is **a moderator decides without `curl`**, and the
 * page tells "nothing waiting", "cannot be shown" and "needs the role" apart.
 * These read the source for that shape, and for what the page must not
 * contain: a decision about who may moderate, or a form pre-filled by a model.
 */
const HERE = __dirname;
const QUEUE = readFileSync(join(HERE, 'moderation-queue.tsx'), 'utf8');
const ACTIONS = readFileSync(join(HERE, '..', 'lib', 'moderation-actions.ts'), 'utf8');
const PAGE = readFileSync(
  join(HERE, '..', 'app', '[locale]', 'admin', 'moderation', 'page.tsx'),
  'utf8',
);
const ADMIN = readFileSync(join(HERE, '..', 'app', '[locale]', 'admin', 'page.tsx'), 'utf8');

describe('the moderation queue page', () => {
  it('states three different absences in three different sentences', () => {
    expect(QUEUE).toContain('data-testid="moderation-queue-unreachable"');
    expect(QUEUE).toContain('data-testid="moderation-queue-empty"');
    expect(PAGE).toContain('data-testid="moderation-queue-forbidden"');
    expect(PAGE).toContain('result.status !== 403');
  });

  it('decides once per member, answering every report shown', () => {
    expect(QUEUE).toContain(
      'subject.reports.map((report) => (\n        <input key={report.id} type="hidden" name="report_id"',
    );
    expect(ACTIONS).toContain("formData.getAll('report_id')");
    expect(ACTIONS).toContain("'/admin/moderation/decisions'");
  });

  it('offers every outcome and scope the contract has, with words for each', () => {
    expect(QUEUE).toContain('MODERATION_OUTCOMES.map');
    expect(QUEUE).toContain('SANCTION_SCOPES.map');
    // Keyed by the contract's unions, so a value added without words does not compile.
    expect(QUEUE).toContain('Record<ModerationOutcome, string>');
    expect(QUEUE).toContain('Record<(typeof SANCTION_SCOPES)[number], string>');
  });

  it('asks for a reason, and leaves the rules to the API', () => {
    expect(QUEUE).toContain('name="reason"');
    expect(ACTIONS).toContain("request.reason === ''");
    for (const source of [QUEUE, ACTIONS, PAGE]) {
      expect(source).not.toMatch(/hasRole|roles\.includes|'moderator'/);
    }
  });

  it("labels the assistant's suggestion as a model's and never pre-fills the decision", () => {
    expect(QUEUE).toContain('(a model, not a finding)');
    expect(QUEUE).toContain("useState<ModerationOutcome>('no_action')");
    expect(QUEUE).not.toMatch(/suggestion\.category\)/);
    expect(ACTIONS).toContain("case 'absent':");
    expect(ACTIONS).toContain("case 'failed':");
  });

  it('is linked from the administration area', () => {
    expect(ADMIN).toContain('/admin/moderation`');
  });
});

const HISTORY = readFileSync(join(HERE, 'member-moderation-history.tsx'), 'utf8');
const HISTORY_PAGE = readFileSync(
  join(HERE, '..', 'app', '[locale]', 'admin', 'moderation', '[username]', 'page.tsx'),
  'utf8',
);

describe("one member's moderation history (T-611)", () => {
  it('shows reports, decisions and restrictions on one page', () => {
    for (const part of ['reports', 'decisions', 'sanctions']) {
      expect(HISTORY).toContain(`data-testid="moderation-history-${part}"`);
    }
    expect(QUEUE).toContain('data-testid="moderation-history-link"');
  });

  it('lifts only a restriction in force, and only with a reason', () => {
    expect(HISTORY).toContain('{sanction.active && (');
    expect(HISTORY).toContain('name="reason"');
    expect(ACTIONS).toContain('/lift`');
    expect(ACTIONS).toContain('Say why it is being lifted');
  });

  it('never shows a refusal or a missing member as a clean record', () => {
    for (const state of ['forbidden', 'missing', 'unreachable']) {
      expect(HISTORY_PAGE).toContain(`data-testid="moderation-history-${state}"`);
    }
    expect(HISTORY_PAGE).not.toMatch(/hasRole|'moderator'/);
  });
});
