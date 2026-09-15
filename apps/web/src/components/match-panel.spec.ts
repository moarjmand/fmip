import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The public match discussion on the page (T-251).
 *
 * The acceptance criterion is **a guest reads; an unapproved member cannot post
 * and is told why**, and the frontend is where both halves are lost most
 * cheaply. Not by a bug: by a guard somebody adds for a good reason and nobody
 * notices has made the discussion private, or by a compose box that simply is
 * not rendered, which is a gate that never explains itself.
 *
 * So these read the source. A render test would prove the components work; what
 * is worth guarding here is that the *structure* keeps its promises — that the
 * panel is not inside a signed-in branch, and that no refusal path renders
 * nothing.
 */
const HERE = __dirname;
const PANEL = readFileSync(join(HERE, 'match-panel.tsx'), 'utf8');
const ACTIONS = readFileSync(join(HERE, '..', 'lib', 'panel-actions.ts'), 'utf8');
const API = readFileSync(join(HERE, '..', 'lib', 'api.ts'), 'utf8');
const MATCH = readFileSync(
  join(HERE, '..', 'app', '[locale]', 'match', '[id]', 'page.tsx'),
  'utf8',
);

describe('a guest reads', () => {
  it('renders the panel outside the signed-in branch beside it', () => {
    // The reason this file exists. `MatchThreads` on the same page *is* inside
    // `me !== null`, correctly — a match thread happens inside a group, and a
    // guest is in none. It is the obvious thing to copy, and copying it would
    // have made the public discussion private with nobody deciding to.
    //
    // Asserted as an ordering rather than by matching braces, which would be
    // fragile enough to pass for the wrong reason: the panel comes **before**
    // the guard opens, so it cannot be inside it. Moving the panel below the
    // guard fails this test and should — whoever does it has to show the panel
    // is still outside by some other means.
    const panelAt = MATCH.indexOf('<MatchPanel');
    const guardAt = MATCH.indexOf('{me !== null && (');
    expect(panelAt).toBeGreaterThan(0);
    expect(
      guardAt,
      'the me !== null guard is gone; this test no longer proves anything',
    ).toBeGreaterThan(0);
    expect(panelAt).toBeLessThan(guardAt);
  });

  it('renders the posts without consulting the viewer', () => {
    // The panel *does* take `me` now, to decide whether to draw reaction
    // buttons and a follow control (T-252) — so the guard cannot be "no session
    // reaches it" any more. The property that still matters is this one: inside
    // the component that renders the list, the viewer is only ever passed down,
    // never branched on. The per-post checks are in `Post`, and they choose
    // controls rather than whether the post appears.
    const body = PANEL.slice(PANEL.indexOf('export function MatchPanel'));
    expect(body).toContain('page.posts.map');
    expect(body).not.toMatch(/viewer\s*[!=]==/);
    expect(body).not.toMatch(/me\s*[!=]==/);
    // The branches it does take are about the page: could it be fetched, and is
    // it empty.
    expect(body).toContain('!reachable || page === null');
    expect(body).toContain('page.posts.length === 0');
    // And the third state T-253 added, which is about the match rather than
    // about the reader.
    expect(body).toContain("page.state === 'none'");
  });

  it('tells a match with no discussion apart from one nobody has posted on', () => {
    // Two different facts, two different testids, two different sentences. One
    // is a match nobody opened a panel on; the other is one where nobody has
    // spoken yet, and only the second is something a reader can act on (rule 3).
    expect(PANEL).toContain('data-testid="panel-none"');
    expect(PANEL).toContain('data-testid="panel-empty"');
    expect(PANEL).toMatch(/Nobody has opened a discussion/);
    expect(PANEL).toMatch(/Nobody has posted about this match yet/);
    expect(PANEL).toMatch(/This discussion is closed/);
  });

  it('fetches the discussion without a session, and the permission with one', () => {
    // Two calls rather than one, so the panel is the same document for
    // everybody and only the viewer's half is viewer-specific.
    expect(API).toMatch(/fetchMatchPanel\([\s\S]{0,200}?apiRequest<MatchPanelPage>/);
    expect(API).not.toMatch(/fetchMatchPanel[\s\S]{0,300}?cookie/);
    expect(API).toMatch(/fetchPanelPermission[\s\S]{0,300}?cookie/);
    expect(MATCH).toContain('fetchMatchPanel(id)');
    expect(MATCH).toContain('fetchPanelPermission(id, cookie)');
  });

  it('never hides the posts behind a permission', () => {
    // The posts and the compose box are rendered from different values, and
    // nothing reads `permission` to decide whether to show the list.
    const posts = PANEL.indexOf('page.posts.map');
    const permissionGate = PANEL.indexOf('permission !== null && permission.may_post');
    expect(posts).toBeGreaterThan(0);
    expect(permissionGate).toBeGreaterThan(posts);
  });
});

describe('an unapproved member is told why', () => {
  it('says something for every refusal the contract can produce', () => {
    // Keyed by the contract's union, so adding a refusal and forgetting its
    // words does not compile. A member refused with no explanation is the
    // failure this surface exists to prevent.
    for (const refusal of [
      'no_panel',
      'panel_closed',
      'not_signed_in',
      'not_approved',
      'paused',
      'withdrawn',
      'restricted',
    ]) {
      expect(PANEL, `no words for ${refusal}`).toContain(`${refusal}:`);
    }
    expect(PANEL).toContain("Record<PanelPermission['refusal'] & string, string>");
    expect(PANEL).toContain('data-testid="panel-refusal"');
  });

  it('separates falling short from qualifying and waiting', () => {
    // "You need a rating of 70" said to a member who has 82 is worse than
    // silence. The two states render differently.
    expect(PANEL).toContain('data-testid="panel-shortfalls"');
    expect(PANEL).toContain('data-testid="panel-qualifies"');
    expect(PANEL).toMatch(/person&rsquo;s decision and has not been\s*\n?\s*made yet/);
  });

  it('shows the refusal the server worded rather than composing a second one', () => {
    // A message invented here could disagree with the API's, and the API's is
    // the one derived from what the database actually refused.
    expect(PANEL).toContain('{state.message}');
    expect(ACTIONS).toContain('result.error?.message');
    // No permission check in the action: the browser's copy of a rule is the
    // one that goes stale first.
    expect(ACTIONS).not.toMatch(/may_post|qualifies|fetchPanelPermission/);
  });
});

describe('what a post carries, and what a removal leaves behind', () => {
  it('shows the author standing beside every post', () => {
    // Blueprint 10.2: on a public panel it is the only thing separating an
    // approved contributor's opinion from anybody else's.
    expect(PANEL).toMatch(/<Standing\s+author=\{post\.author\}/);
    // Both marks, and they are chosen by the same expression: a contributor
    // whose approval has since ended is shown as former rather than as approved.
    // Hiding their post would rewrite the record; still calling them approved
    // would be false (rule 3).
    expect(PANEL).toContain("'panel-author-approved' : 'panel-author-former'");
    expect(PANEL).toContain('data-testid="panel-author-unrated"');
  });

  it('keeps a removed post as a tombstone that says which kind of removal it was', () => {
    expect(PANEL).toContain('data-testid="panel-post-removed"');
    expect(PANEL).toMatch(/The author removed this post/);
    expect(PANEL).toMatch(/A moderator removed this post/);
  });

  it('states unreachable apart from empty', () => {
    expect(PANEL).toContain('data-testid="panel-unreachable"');
    expect(PANEL).toContain('data-testid="panel-empty"');
  });

  it('says how many posts there are when a page is not all of them', () => {
    expect(PANEL).toContain('data-testid="panel-more"');
    expect(PANEL).toContain('page.total');
  });
});

describe('the surface works the way the rest of the app does', () => {
  it('posts through a form and a server action, with no click handler', () => {
    expect(PANEL).toContain('<form action={formAction}');
    expect(PANEL).not.toMatch(/onClick|useEffect|addEventListener/);
  });

  it('revalidates the match page, so a contributor sees what they posted', () => {
    // The panel is a server component reading a public document. Without this
    // the post lands and nothing on the page changes.
    expect(ACTIONS).toContain('revalidatePath(`/${locale}/match/${fixtureId}`)');
  });

  it('uses logical properties only (rule 7)', () => {
    expect(PANEL).not.toMatch(/\b(ml|mr|pl|pr|left|right|text-left|text-right)-/);
  });
});
