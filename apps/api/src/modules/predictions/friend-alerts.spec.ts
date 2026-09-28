import { describe, expect, it } from 'vitest';
import { NOTIFICATION_DEFAULTS, NOTIFICATION_TEXT, notificationLine } from '@fmip/contracts';
import { type FriendAlertPorts, friendAlertKey, friendAlerts } from './internal/friend-alerts';

/**
 * "A friend predicted a match you follow" (T-832, D-100): to the friends who
 * care about the match, only where the predictor's own visibility lets them
 * read the prediction (D-063), one per friend per match, and never the pick.
 */
const FIXTURE = 'fixture-1';
const ME = 'me';

function ports(overrides: Partial<FriendAlertPorts> = {}): FriendAlertPorts & {
  asked: string[];
} {
  const asked: string[] = [];
  return {
    asked,
    friendIds: () => Promise.resolve(['a', 'b', 'c', 'd']),
    // b does not follow the match and did not predict it.
    interested: (_fixture, ids) => Promise.resolve(ids.filter((id) => id !== 'b')),
    mayRead: (_predictor, viewer) => {
      asked.push(viewer);
      return Promise.resolve(true);
    },
    ...overrides,
  };
}

describe('friendAlerts', () => {
  it('tells each friend who follows or predicted the match, sourced and keyed per match', async () => {
    const alerts = await friendAlerts(ports(), ME, FIXTURE);
    expect(alerts.map((a) => a.userId)).toEqual(['a', 'c', 'd']);
    expect(alerts[0]).toEqual({
      userId: 'a',
      kind: 'friend_predicted',
      subjectType: 'fixture',
      subjectId: FIXTURE,
      sourceId: ME,
      dedupeKey: `friend_predicted:${FIXTURE}:${ME}`,
    });
  });

  it("asks the predictor's visibility about every recipient, and sends nothing it refuses", async () => {
    const p = ports({ mayRead: (_p, viewer) => Promise.resolve(viewer !== 'c') });
    const alerts = await friendAlerts(p, ME, FIXTURE);
    expect(alerts.map((a) => a.userId)).toEqual(['a', 'd']);
    // A private history: nobody is told.
    const none = await friendAlerts(ports({ mayRead: () => Promise.resolve(false) }), ME, FIXTURE);
    expect(none).toEqual([]);
  });

  it('asks only about friends who care about the match', async () => {
    const p = ports();
    await friendAlerts(p, ME, FIXTURE);
    expect(p.asked).toEqual(['a', 'c', 'd']);
  });

  it('with no friends, asks nothing else', async () => {
    let interestedAsked = false;
    const p = ports({
      friendIds: () => Promise.resolve([]),
      interested: () => {
        interestedAsked = true;
        return Promise.resolve([]);
      },
    });
    expect(await friendAlerts(p, ME, FIXTURE)).toEqual([]);
    expect(interestedAsked).toBe(false);
  });

  it('is one key per friend per match, so a revision or a retry reaches nobody twice', () => {
    expect(friendAlertKey(FIXTURE, ME)).toBe(friendAlertKey(FIXTURE, ME));
    expect(friendAlertKey(FIXTURE, ME)).not.toBe(friendAlertKey('fixture-2', ME));
  });
});

describe('the friend_predicted kind', () => {
  it('is opt-in and says that a friend predicted, never what', () => {
    expect(NOTIFICATION_DEFAULTS.friend_predicted).toBe(false);
    const line = notificationLine({ kind: 'friend_predicted', source: 'alice' });
    expect(line).toBe(`alice ${NOTIFICATION_TEXT.friend_predicted.text}`);
    expect(line).not.toMatch(/\d|home|away|draw/i);
  });
});
