import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The conversation surface's guards (T-224).
 *
 * Two promises are checked here, and neither is about markup.
 *
 * **D-053's promise that a surface ships with its exits.** Mute and leave are on
 * this page on the day the page exists, and the route to block and report is on
 * it too — the same check `friend-controls.spec.ts` makes for the social graph.
 *
 * **E22's ordering promise: correct before fast.** The page is a server
 * component and the composer is a form over a server action, so the whole thing
 * works without JavaScript and without a socket. T-230 adds a transport *beside*
 * this; if it ever replaces it, these two assertions are what fail.
 */

const HERE = __dirname;

function source(...parts: string[]): string {
  return readFileSync(join(HERE, ...parts), 'utf8');
}

const CARD = source('conversation.tsx');
const CONTROLS = source('conversation-controls.tsx');
const PAGE = source('..', 'app', '[locale]', 'messages', '[id]', 'page.tsx');
const LIST = source('..', 'app', '[locale]', 'messages', 'page.tsx');

/** Read from the contract rather than typed out here. */
function reactions(): string[] {
  const contract = readFileSync(
    join(HERE, '..', '..', '..', '..', 'packages', 'contracts', 'src', 'conversations.ts'),
    'utf8',
  );
  const list = /export const REACTIONS = \[([^\]]*)\]/.exec(contract)?.[1] ?? '';
  return [...list.matchAll(/'([a-z_]+)'/g)].map((match) => match[1] ?? '');
}

/** The card kinds, read from the contract rather than typed out here. */
function cardKinds(): string[] {
  const contract = readFileSync(
    join(HERE, '..', '..', '..', '..', 'packages', 'contracts', 'src', 'conversations.ts'),
    'utf8',
  );
  const list = /export const CARD_KINDS = \[([^\]]*)\]/.exec(contract)?.[1] ?? '';
  return [...list.matchAll(/'([a-z_]+)'/g)].map((match) => match[1] ?? '');
}

describe('every shared card has somewhere to be rendered', () => {
  it('handles each kind the contract allows, plus the one that no longer resolves', () => {
    for (const kind of cardKinds()) {
      expect(CARD, `no branch renders a ${kind} card`).toContain(`card.kind === '${kind}'`);
    }
    // `gone` is not a kind anybody can share; it is what a card becomes when the
    // thing it names is not there any more, and the message still has to say
    // that somebody shared something.
    expect(CARD).toContain("card.kind === 'gone'");
  });

  it('puts a shared score through the component that cannot render backwards', () => {
    // T-153: `2 – 1` inside a right-to-left paragraph is laid out `1 – 2` by the
    // bidirectional algorithm. It is invisible in review and tells every Arabic
    // reader the wrong result, which is why there is one component for it.
    expect(CARD).toContain('<Score');
    expect(CARD).not.toMatch(/\{card\.score\.home\}\s*[–-]/);
  });

  it('says when a live card last changed', () => {
    // Rule 4: a surface carrying live data carries its freshness with it.
    expect(CARD).toContain('last_updated_at');
  });
});

describe('the way out is on the surface it belongs to', () => {
  it('offers mute and leave', () => {
    expect(CONTROLS).toContain('data-testid="conversation-mute"');
    expect(CONTROLS).toContain('data-testid="conversation-leave"');
    expect(PAGE).toContain('<ConversationExits');
  });

  it('points at the profile, where blocking and reporting already live', () => {
    // Re-implementing them here would give one member two block buttons that
    // could disagree.
    expect(CARD).toMatch(/Blocking and reporting/);
    expect(CARD).toContain('/u/${encodeURIComponent(member.username)}');
  });
});

describe('correct before fast', () => {
  it('renders the conversation on the server', () => {
    // A page that only works once a script has loaded and a socket has opened
    // has made the socket the source of truth by accident.
    expect(PAGE.startsWith("'use client'")).toBe(false);
    expect(LIST.startsWith("'use client'")).toBe(false);
  });

  it('sends through a form over a server action', () => {
    expect(CONTROLS).toContain('<form action={formAction}');
    expect(CONTROLS).toContain('sendMessageAction');
  });
});

describe('reactions, mentions and pins (T-226)', () => {
  it('gives every reaction in the contract a label a reader can see', () => {
    // Adding one to the union and forgetting the label would render an empty
    // button; reading the list from the contract makes that a failing test.
    for (const reaction of reactions()) {
      expect(CONTROLS, `no label for ${reaction}`).toContain(`${reaction}:`);
    }
    expect(reactions().length).toBeGreaterThan(0);
  });

  it('reacts without JavaScript: a form each, and `details` for the rest', () => {
    // The acceptance criterion. A popover would have needed a script and would
    // have made this the first control on the surface that did -- on a page
    // whose whole point is being correct before the socket of T-230 exists.
    expect(CONTROLS).toMatch(/<form action=\{formAction\} className="inline">/);
    expect(CONTROLS).toContain('<details');
    expect(CONTROLS).not.toMatch(/onClick|useEffect|addEventListener/);
  });

  it('shows the pinned messages whatever page is being read', () => {
    expect(PAGE).toContain('data-testid="conversation-pinned"');
    expect(PAGE).toContain('page.pinned');
  });

  it('says who was mentioned beside the message, not inside it', () => {
    // Highlighting `@name` inside the body would mean parsing text the API has
    // already parsed once, and the two could disagree about who was named.
    expect(CARD).toContain('data-testid="message-mentions"');
    expect(CARD).toContain('message.mentions');
    expect(CARD).not.toMatch(/body.*replace\(.*@/);
  });
});

describe('what a conversation says when it has nothing to show', () => {
  it('states each absence rather than rendering nothing', () => {
    for (const testId of ['messages-none', 'conversation-empty']) {
      expect(`${PAGE}${LIST}`).toContain(testId);
    }
  });

  it('renders a removed message as a tombstone, saying who removed it', () => {
    // A message that silently vanished would make the conversation around it
    // unreadable and the moderation record unverifiable.
    expect(CARD).toContain('data-testid="message-removed"');
    expect(CARD).toMatch(/Removed by a moderator/);
    expect(CARD).toMatch(/The author removed this/);
  });
});
