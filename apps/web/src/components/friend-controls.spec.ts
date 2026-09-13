import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The exits guard (T-202, D-053).
 *
 * D-053 says every conversational surface ships with block, mute, leave and
 * report already built, rather than in a later epic. That is a promise about
 * every surface Phase 3 adds, and a promise nothing checks is a sentence in a
 * document. This is the first of the checks: on the one surface that exists so
 * far, the member's way out is present in every state they can be in.
 *
 * It reads the source rather than rendering it, the same way the rule-6 guard
 * does (`three-products.spec.ts`): what it is asserting is the *shape* of the
 * component — which branches exist and what they contain — and that survives a
 * refactor of the markup.
 */

const HERE = __dirname;

function source(file: string): string {
  return readFileSync(join(HERE, file), 'utf8');
}

const CONTROLS = source('friend-controls.tsx');

/**
 * The states a viewer can be in, from `@fmip/contracts`. Read from the contract
 * rather than typed out here, so that adding a state to the union and
 * forgetting the component is a failing test rather than a state that silently
 * renders nothing.
 */
function friendStatuses(): string[] {
  const contract = readFileSync(
    join(HERE, '..', '..', '..', '..', 'packages', 'contracts', 'src', 'social.ts'),
    'utf8',
  );
  const union = /export type FriendStatus =([\s\S]*?);/.exec(contract)?.[1] ?? '';
  return [...union.matchAll(/'([a-z_]+)'/g)].map((match) => match[1] ?? '');
}

describe('the way out is always there', () => {
  it('offers a block or an unblock in every state but the viewer’s own profile', () => {
    // `self` is the exception and the only one: there is nobody to block.
    const needsAnExit = friendStatuses().filter((status) => status !== 'self');
    expect(needsAnExit.length).toBeGreaterThan(0);

    for (const status of needsAnExit) {
      const branch = new RegExp(`status === '${status}' && \\(([\\s\\S]*?)\\n\\s*\\)\\}`).exec(
        CONTROLS,
      )?.[1];
      expect(branch, `no branch renders the ${status} state`).toBeDefined();
      // Either the block control or, when they have already blocked, the
      // unblock that undoes it. A state with neither is a member who can see
      // another member and cannot get away from them.
      expect(branch, `the ${status} state offers no way out`).toMatch(/\{block\}|friend-unblock/);
    }
  });

  it('keeps the exit when the other member is the one who acted', () => {
    // `unavailable` means the other member has blocked the viewer. Taking the
    // viewer's own block away because of that would let one member decide what
    // controls the other one has.
    const branch = /status === 'unavailable' && \(([\s\S]*?)\n\s*\)\}/.exec(CONTROLS)?.[1];
    expect(branch).toMatch(/\{block\}/);
  });
});

describe('what the controls never say', () => {
  it('never tells a member that somebody blocked them', () => {
    // The contract returns `unavailable` rather than `blocked_by` for this
    // reason; a component that then wrote the sentence out would undo it.
    expect(CONTROLS).not.toMatch(/blocked you|has blocked|they blocked/i);
  });

  it('names the viewer’s own block plainly, because it is theirs to undo', () => {
    expect(CONTROLS).toMatch(/You blocked @\{username\}/);
  });
});

describe('the friends page', () => {
  const PAGE = readFileSync(join(HERE, '..', 'app', '[locale]', 'friends', 'page.tsx'), 'utf8');

  it('states the absence of each section rather than rendering nothing', () => {
    // The lesson of T-137: a section that disappears when it is empty leaves a
    // reader unable to tell whether there is nothing to show or whether the
    // page failed to ask. It matters more here, where an empty requests list
    // is a claim about what another member did or did not do.
    for (const testId of ['requests-none', 'friends-none', 'blocks-none']) {
      expect(PAGE).toContain(testId);
    }
  });

  it('puts the block list where a member can find it', () => {
    // A block a member cannot find is a block they cannot lift.
    expect(PAGE).toContain('data-testid="block-list"');
    expect(PAGE).toMatch(/does not restore a friendship the block ended/);
  });
});
