import type { AchievementKind, AchievementsResponse } from '@fmip/contracts';
import { formatDate } from '@/i18n/format';
import type { MessageKey } from '@/i18n/messages';
import type { ApiResult } from '@/lib/api';
import { Translated } from '@/components/translated';

/** The catalogue key naming each achievement; a new kind is a type error here until it has one. */
export const ACHIEVEMENT_LABEL_KEY: Record<AchievementKind, MessageKey> = {
  first_settled: 'achievements.kind.firstSettled',
  settled_10: 'achievements.kind.settled10',
  settled_50: 'achievements.kind.settled50',
  settled_100: 'achievements.kind.settled100',
  first_exact_score: 'achievements.kind.firstExactScore',
  exact_scores_5: 'achievements.kind.exactScores5',
  streak_5: 'achievements.kind.streak5',
  streak_10: 'achievements.kind.streak10',
  full_matchday: 'achievements.kind.fullMatchday',
  competitions_5: 'achievements.kind.competitions5',
};

/**
 * A member's achievements on their profile (blueprint 9.2, T-643, D-090).
 * Every one is the API's, derived from stored predictions and settlements;
 * this lists them with the date each was earned and says in words when there
 * are none, when they are restricted and when they cannot be fetched (rule 3).
 * It says, too, that they change nothing about the rating.
 */
export function AchievementsSection({
  locale,
  result,
}: {
  locale: string;
  result: ApiResult<AchievementsResponse>;
}) {
  if (!result.ok) {
    return (
      <p role="alert" className="text-sm" data-testid="achievements-unreachable">
        <Translated locale={locale} message="achievements.unreachable" />
      </p>
    );
  }
  const view = result.data;
  if (view.kind === 'restricted') {
    return (
      <p className="text-sm opacity-70" data-testid="achievements-restricted">
        <Translated
          locale={locale}
          message={
            view.visibility === 'friends'
              ? 'achievements.restrictedFriends'
              : 'achievements.restrictedPrivate'
          }
        />
      </p>
    );
  }
  const { earned } = view.achievements;
  if (earned.length === 0) {
    return (
      <p className="text-sm opacity-70" data-testid="achievements-none">
        <Translated locale={locale} message="achievements.none" />
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1 text-sm" data-testid="achievements-list">
        {earned.map((achievement) => (
          <li
            key={achievement.kind}
            className="flex flex-wrap items-baseline gap-x-2"
            data-achievement={achievement.kind}
          >
            <span className="font-semibold">
              <Translated locale={locale} message={ACHIEVEMENT_LABEL_KEY[achievement.kind]} />
            </span>
            {achievement.round !== null && (
              <span className="opacity-70">
                {achievement.round.competition.name} · {achievement.round.season_label} ·{' '}
                {achievement.round.round}
              </span>
            )}
            <time dateTime={achievement.earned_at} className="text-xs opacity-60">
              {formatDate(locale, achievement.earned_at, 'UTC', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </time>
          </li>
        ))}
      </ul>
      <p className="text-xs opacity-60">
        <Translated locale={locale} message="achievements.note" />
      </p>
    </div>
  );
}
