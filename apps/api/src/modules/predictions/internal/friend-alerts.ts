/**
 * "A friend predicted a match you follow" (blueprint 8.1, T-832, D-099), as
 * a function over three questions so the rule can be tested without a
 * database: who the predictor's friends are, which of them care about this
 * match, and whether each may read the predictor's predictions.
 *
 * **Visibility is the friend's own setting, asked of the profile boundary
 * per recipient** (D-063): a friend whose history is `private` is announced
 * to nobody, and nothing here decides it a second way. The notification
 * says *that* they predicted, never *what* -- the pick stays where their
 * setting already shows it, on their profile.
 */
export interface FriendAlertPorts {
  /** The predictor's friends. */
  friendIds(userId: string): Promise<string[]>;
  /** Of `userIds`, the live accounts that follow either team or the competition, or predicted this match. */
  interested(fixtureId: string, userIds: string[]): Promise<string[]>;
  /** Whether `viewerId` may read `predictorId`'s predictions (their `prediction_history_visibility`). */
  mayRead(predictorId: string, viewerId: string): Promise<boolean>;
}

export interface FriendAlert {
  userId: string;
  kind: 'friend_predicted';
  subjectType: 'fixture';
  subjectId: string;
  sourceId: string;
  /** One per friend per match, however many times the prediction is revised. */
  dedupeKey: string;
}

export function friendAlertKey(fixtureId: string, predictorId: string): string {
  return `friend_predicted:${fixtureId}:${predictorId}`;
}

/** The notifications a first prediction on a match should raise, one per friend who may be told. */
export async function friendAlerts(
  ports: FriendAlertPorts,
  predictorId: string,
  fixtureId: string,
): Promise<FriendAlert[]> {
  const friends = (await ports.friendIds(predictorId)).filter((id) => id !== predictorId);
  if (friends.length === 0) return [];
  const interested = await ports.interested(fixtureId, friends);
  const alerts: FriendAlert[] = [];
  for (const userId of interested) {
    if (!(await ports.mayRead(predictorId, userId))) continue;
    alerts.push({
      userId,
      kind: 'friend_predicted',
      subjectType: 'fixture',
      subjectId: fixtureId,
      sourceId: predictorId,
      dedupeKey: friendAlertKey(fixtureId, predictorId),
    });
  }
  return alerts;
}
