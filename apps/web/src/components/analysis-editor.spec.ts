import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The analyst's editor and the editorial queue (T-262).
 *
 * The acceptance criterion is **a reviewer sees the submission, the author's
 * record, and the decision history** — and the half that is easiest to lose is
 * the analyst's: a request for changes shown on its own is an instruction with
 * no context, and they would be rewriting from memory.
 *
 * So these read the source for the shape of the two pages, and for the thing
 * neither of them should contain: a decision about who may do what.
 */
const HERE = __dirname;
const EDITOR = readFileSync(join(HERE, 'analysis-editor.tsx'), 'utf8');
const QUEUE = readFileSync(join(HERE, 'analysis-queue.tsx'), 'utf8');
const ACTIONS = readFileSync(join(HERE, '..', 'lib', 'analysis-actions.ts'), 'utf8');
const QUEUE_PAGE = readFileSync(
  join(HERE, '..', 'app', '[locale]', 'admin', 'analysis-reviews', 'page.tsx'),
  'utf8',
);
const EDITOR_PAGE = readFileSync(
  join(HERE, '..', 'app', '[locale]', 'analyses', '[fixtureId]', 'page.tsx'),
  'utf8',
);

describe('the analyst sees what they sent and what was said', () => {
  it('puts the decision history on the same page as the draft', () => {
    // A request for changes shown on its own is an instruction with no context.
    expect(EDITOR).toContain('What you sent, and what was said');
    expect(EDITOR).toContain('workspace.submissions.map');
    expect(EDITOR).toContain('submission.review.reason');
  });

  it('tells waiting apart from decided', () => {
    expect(EDITOR).toContain('data-testid="analysis-attempt-waiting"');
    expect(EDITOR).toContain('data-testid="analysis-attempt-decided"');
    expect(EDITOR).toMatch(/Waiting to be read/);
  });

  it('says where the analysis has got to, for every state', () => {
    for (const state of [
      'draft',
      'submitted',
      'approved',
      'changes_requested',
      'rejected',
      'published',
    ]) {
      expect(EDITOR, `no words for ${state}`).toContain(`${state}:`);
    }
    // Keyed by the contract's union, so a state added without words does not
    // compile.
    expect(EDITOR).toContain("Record<CommunityAnalysisWorkspace['state'], string>");
  });

  it('names every bad field where it went wrong, not in one lump', () => {
    // The API names them all at once; this puts each beside its own input, so
    // an analyst fixes one thing and not four.
    expect(EDITOR).toContain('fields.predicted_outcome');
    expect(EDITOR).toContain('fields.confidence');
    expect(EDITOR).toContain('fields.reasoning');
  });

  it('says out loud why reasoning is required', () => {
    expect(EDITOR).toMatch(/without reasoning is a prediction/i);
  });

  it('treats a missing workspace as a starting point, not an error', () => {
    // 404 means they have not written anything yet. The form renders empty.
    expect(EDITOR_PAGE).toContain('workspace={mine.ok ? mine.data : null}');
  });
});

describe('a reviewer does not decide blind', () => {
  it('shows the author, linked to their record', () => {
    expect(QUEUE).toContain('data-testid="analysis-queue-author"');
    expect(QUEUE).toContain('/u/${encodeURIComponent(authors[index]');
  });

  it('says which attempt this is, when it is not the first', () => {
    // The second time somebody submits the same thing is a different situation
    // from the first.
    expect(QUEUE).toContain('data-testid="analysis-queue-attempt"');
    expect(QUEUE).toContain('submission.attempt > 1');
  });

  it('shows the whole submission, optional fields included, and omits absent ones', () => {
    expect(QUEUE).toContain('submission.reasoning');
    expect(QUEUE).toContain("['lineup_impact', 'Lineup impact']");
    expect(QUEUE).toContain('submission[field] === null ? null');
  });

  it('requires a reason on every decision, including an approval', () => {
    expect(QUEUE).toMatch(/name="reason"[\s\S]{0,120}required/);
    expect(ACTIONS).toMatch(/A decision with no reason cannot be reviewed/);
  });

  it('offers all three decisions', () => {
    for (const decision of ['approved', 'changes_requested', 'rejected']) {
      expect(QUEUE).toContain(`'${decision}'`);
    }
  });

  it('tells unreachable apart from empty, and both from forbidden', () => {
    expect(QUEUE).toContain('data-testid="analysis-queue-unreachable"');
    expect(QUEUE).toContain('data-testid="analysis-queue-empty"');
    // "You may not read this" and "nothing is waiting" are different facts, and
    // a reviewer who saw the second when the first was true would go home.
    expect(QUEUE_PAGE).toContain('data-testid="analysis-queue-forbidden"');
  });
});

describe('the browser decides nothing', () => {
  it('checks no grant, no role and no kick-off', () => {
    const code = (source: string) =>
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\r\n])\s*\/\/.*/g, '$1');
    // All three live in the database and are worded by the API. A copy here
    // would be the one that goes stale first.
    expect(code(ACTIONS)).not.toMatch(/member_may_contribute|hasRole|kickoff|approved_grant/);
    expect(code(EDITOR)).not.toMatch(/hasRole|kickoff/);
    expect(code(QUEUE_PAGE)).not.toMatch(/hasRole\(/);
  });

  it('shows the sentence the API sent rather than composing a second one', () => {
    expect(ACTIONS).toContain('result.error?.message');
    expect(EDITOR).toContain('{saveState.message}');
    expect(QUEUE).toContain('{state.message}');
  });

  it('revalidates both pages, so a decision is visible where it was made', () => {
    expect(ACTIONS).toContain('revalidatePath(`/${locale}/analyses/${fixtureId}`)');
    expect(ACTIONS).toContain('revalidatePath(`/${locale}/admin/analysis-reviews`)');
  });

  it('works without JavaScript: a form per control, no click handlers', () => {
    expect(EDITOR).toContain('<form action={saveAction}');
    expect(QUEUE).toContain('<form action={formAction}');
    expect(EDITOR).not.toMatch(/onClick|useEffect|addEventListener/);
    expect(QUEUE).not.toMatch(/onClick|useEffect|addEventListener/);
  });

  it('uses logical properties only (rule 7)', () => {
    expect(EDITOR).not.toMatch(/\b(ml|mr|pl|pr|text-left|text-right)-/);
    expect(QUEUE).not.toMatch(/\b(ml|mr|pl|pr|text-left|text-right)-/);
  });
});
