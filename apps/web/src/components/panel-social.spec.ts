import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Reacting and following on the page (T-252).
 *
 * The acceptance criterion is that neither becomes posting access, and on the
 * page that has a visible form: the reaction row and the follow button appear
 * for **any signed-in member**, including one who cannot post a word. A surface
 * that showed them only to approved contributors would be a second gate nobody
 * decided to create, and it would look perfectly reasonable in review.
 *
 * So these read the source for the shape of the conditions, not for whether the
 * components render.
 */
const HERE = __dirname;
const SOCIAL = readFileSync(join(HERE, 'panel-social.tsx'), 'utf8');
/**
 * The same file with its prose removed.
 *
 * The comments here argue *about* approval at length — "present for an
 * unapproved member" is the point of the surface — so a sweep for those words
 * across the whole file would fail on the explanation of why it passes. Only
 * code is searched, the way the contracts guard does it (T-321).
 */
const SOCIAL_CODE = SOCIAL.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\r\n])\s*\/\/.*/g, '$1');
const PANEL = readFileSync(join(HERE, 'match-panel.tsx'), 'utf8');
const ACTIONS = readFileSync(join(HERE, '..', 'lib', 'panel-social-actions.ts'), 'utf8');
const API = readFileSync(join(HERE, '..', 'lib', 'api.ts'), 'utf8');

describe('reacting is open to members, and looks it', () => {
  it('asks about a session and never about approval', () => {
    // The whole guard. Not `permission.may_post`, not `qualifies`, not
    // `approved`: a member who cannot post still reacts and still follows.
    expect(SOCIAL).toContain('signedIn');
    expect(SOCIAL_CODE).not.toMatch(/may_post|qualifies|approved|contributor_grant/);
    expect(PANEL).toContain('signedIn={me !== null}');
  });

  it('draws the controls from the contract list, not from a list of its own', () => {
    // A second copy of the six would drift, and the copy on the page is the one
    // a member sees.
    expect(SOCIAL).toContain("import { PANEL_REACTIONS } from '@fmip/contracts'");
    expect(SOCIAL).toContain('PANEL_REACTIONS.map');
    expect(SOCIAL).toContain('PANEL_REACTIONS.filter');
  });

  it('shows a guest the counts and no buttons', () => {
    // The counts are part of the public document; hiding them until somebody
    // signs in would make the numbers appear to change when they did.
    expect(SOCIAL).toContain('if (!signedIn)');
    expect(SOCIAL).toMatch(/data-testid=\{`panel-tally-\$\{postId\}`\}/);
    expect(SOCIAL).toMatch(/data-testid=\{`panel-reactions-\$\{postId\}`\}/);
  });

  it('puts the state in the label, not only in a border', () => {
    // A coloured border does not reach a screen reader and neither does a bold
    // count.
    expect(SOCIAL).toContain('aria-pressed={mine}');
    expect(SOCIAL).toContain('aria-label=');
    expect(SOCIAL).toMatch(/mine \? ', yours' : ''/);
  });
});

describe('following a contributor', () => {
  it('is offered to a member who is not the author, and to nobody else', () => {
    expect(PANEL).toContain('me !== null && me !== post.author.username');
    expect(SOCIAL).toContain('aria-pressed={following}');
  });

  it('is fetched once for the page rather than per author', () => {
    // A panel with a dozen contributors would otherwise cost a dozen round
    // trips to draw a dozen buttons.
    expect(API).toContain('fetchFollowedMembers');
    expect(PANEL).toContain('new Set(followed ?? [])');
  });
});

describe('the browser decides nothing', () => {
  it('checks no permission in either action, because there is none to check', () => {
    expect(ACTIONS).not.toMatch(/may_post|qualifies|approved|fetchPanelPermission/);
    // The sentence the API sent, shown as it came. One invented here could
    // disagree with the one derived from what the database refused.
    expect(ACTIONS).toContain('result.error?.message');
  });

  it('uses PUT and DELETE, because both are idempotent', () => {
    expect(ACTIONS).toContain("on ? 'PUT' : 'DELETE'");
    expect(ACTIONS).toMatch(/idempotent/);
  });

  it('revalidates the match page, so a count changes where it was clicked', () => {
    expect(ACTIONS).toContain('revalidatePath(revalidate)');
    expect(ACTIONS).toContain('`/${locale}/match/${fixtureId}`');
  });

  it('works without JavaScript: a form per control, no click handlers', () => {
    expect(SOCIAL).toContain('<form action={formAction}');
    expect(SOCIAL).not.toMatch(/onClick|useEffect|addEventListener/);
  });

  it('uses logical properties only (rule 7)', () => {
    expect(SOCIAL).not.toMatch(/\b(ml|mr|pl|pr|text-left|text-right)-/);
    expect(SOCIAL).toContain('ms-');
  });
});
