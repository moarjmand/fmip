import { describe, expect, it } from 'vitest';
import {
  aboutPatch,
  favouriteValue,
  historyActionKey,
  historyValues,
  inviteLinkUrl,
  linkRequest,
  parseFavourite,
  parsePolicy,
} from './group-settings';

/**
 * The owner's settings, read from their forms (T-1026). Each case is a way a
 * form could send something the member did not mean -- a favourite cleared
 * by a select that was never shown, a policy nobody chose -- and the answer
 * is always to send what the form carried and let the API refuse the rest.
 */

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

const TEAM = '00000000-0000-4000-8000-000000000601';

describe('the favourite, by id (rule 1)', () => {
  it('round-trips a club and a competition through the select', () => {
    expect(parseFavourite(favouriteValue({ type: 'team', id: TEAM }))).toEqual({
      type: 'team',
      id: TEAM,
    });
    expect(parseFavourite('competition:abc')).toEqual({ type: 'competition', id: 'abc' });
  });

  it('clears on the empty choice', () => {
    expect(favouriteValue(null)).toBe('');
    expect(parseFavourite('')).toBeNull();
  });

  it('does not repair a value it does not understand', () => {
    expect(parseFavourite('nonsense')).toEqual({ type: '', id: 'nonsense' });
  });
});

describe('the language-and-favourite patch', () => {
  it('sends the favourite only when the form carried its select', () => {
    expect(aboutPatch(form({ language: 'pt' }))).toEqual({ language: 'pt' });
    expect(aboutPatch(form({ language: '', favourite: '' }))).toEqual({
      language: null,
      favourite: null,
    });
    expect(aboutPatch(form({ language: 'en', favourite: `team:${TEAM}` }))).toEqual({
      language: 'en',
      favourite: { type: 'team', id: TEAM },
    });
  });
});

describe('who may invite', () => {
  it('passes a known policy and nothing else', () => {
    expect(parsePolicy('members')).toBe('members');
    expect(parsePolicy('everyone')).toBeUndefined();
    expect(parsePolicy(null)).toBeUndefined();
  });
});

describe('a new link', () => {
  it("uses the API's defaults when a field is missing or not a whole number", () => {
    expect(linkRequest(form({}))).toEqual({ expires_in_hours: 168, max_uses: 25 });
    expect(linkRequest(form({ expires_in_hours: '24', max_uses: '3' }))).toEqual({
      expires_in_hours: 24,
      max_uses: 3,
    });
    expect(linkRequest(form({ expires_in_hours: '1.5', max_uses: '-2' }))).toEqual({
      expires_in_hours: 168,
      max_uses: 25,
    });
  });

  it('points at the page that previews and follows it', () => {
    expect(inviteLinkUrl('https://example.test', 'en', 'a/b')).toBe(
      'https://example.test/en/group-invite/a%2Fb',
    );
  });
});

describe('the history, in words', () => {
  it('names the actions it knows and calls the rest a change', () => {
    expect(historyActionKey('user_group.invite_policy')).toBe(
      'groupSettings.history.action.invitePolicy',
    );
    expect(historyActionKey('user_group.rules')).toBe('groupSettings.history.action.rules');
    expect(historyActionKey('moderation.group_close')).toBe('groupSettings.history.action.other');
  });

  it('shows a policy by its label and every other value as the log holds it', () => {
    expect(historyValues(null)).toEqual([]);
    expect(
      historyValues({ invite_policy: 'owner', version: 2, closed_at: null, extra: { a: 1 } }),
    ).toEqual([
      { field: 'invite_policy', value: 'owner', policy: 'owner' },
      { field: 'version', value: '2', policy: null },
      { field: 'closed_at', value: '—', policy: null },
      { field: 'extra', value: '{"a":1}', policy: null },
    ]);
  });
});
