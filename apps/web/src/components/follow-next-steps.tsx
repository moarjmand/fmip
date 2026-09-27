import Link from 'next/link';
import type { FollowSuggestionsResponse } from '@fmip/contracts';
import { Translated } from '@/components/translated';
import type { ApiResult } from '@/lib/api';
import { followAction } from '@/lib/auth-actions';
import { Notice } from '@/components/ui';

/**
 * What a member who follows nothing does next (T-622): never an empty page
 * that looks broken. A sentence, then the competitions the site holds with
 * the teams of their season that members follow most -- each with the same
 * follow button the settings page posts (T-042) -- and two ways to look
 * further. Every name comes from `GET /follow-suggestions`; a competition
 * with no team yet says so rather than being given some.
 */
export function FollowNextSteps({
  locale,
  suggestions,
}: {
  locale: string;
  suggestions: ApiResult<FollowSuggestionsResponse>;
}) {
  const follow = followAction.bind(null, locale);

  return (
    <section
      aria-labelledby="next-steps-title"
      className="flex flex-col gap-4"
      data-testid="feed-next-steps"
    >
      <h2 id="next-steps-title" className="text-xl font-semibold">
        <Translated locale={locale} message="feed.nextSteps.title" />
      </h2>
      <p>
        <Translated locale={locale} message="feed.nextSteps.intro" />
      </p>

      {!suggestions.ok ? (
        <Notice tone="danger" data-testid="next-steps-unreachable">
          <Translated locale={locale} message="feed.nextSteps.unreachable" />
        </Notice>
      ) : suggestions.data.competitions.length === 0 ? (
        <p role="status" data-testid="next-steps-nothing-held">
          <Translated locale={locale} message="feed.nextSteps.nothingHeld" />
        </p>
      ) : (
        <ul className="flex flex-col gap-4" data-testid="next-steps-competitions">
          {suggestions.data.competitions.map(({ competition, season, teams }) => (
            <li
              key={competition.id}
              className="flex flex-col gap-2 border-s-2 border-s-default ps-4"
              data-testid="next-steps-competition"
            >
              <div className="flex flex-wrap items-baseline gap-3">
                <h3 className="text-lg font-semibold">
                  <Link href={`/${locale}/competition/${competition.id}`} className="underline">
                    {competition.name}
                  </Link>
                </h3>
                {season !== null && <span className="text-sm text-muted">{season.label}</span>}
                <FollowButton
                  action={follow}
                  locale={locale}
                  type="competition"
                  id={competition.id}
                  name={competition.name}
                />
              </div>
              {teams.length === 0 ? (
                <p className="text-sm text-muted" data-testid="next-steps-no-teams">
                  <Translated locale={locale} message="feed.nextSteps.noTeams" />
                </p>
              ) : (
                <>
                  <p className="text-sm text-muted">
                    <Translated locale={locale} message="feed.nextSteps.ranked" />
                  </p>
                  <ul className="flex flex-col gap-1">
                    {teams.map((team) => (
                      <li
                        key={team.id}
                        className="flex flex-wrap items-baseline gap-3"
                        data-testid="next-steps-team"
                      >
                        <Link href={`/${locale}/team/${team.id}`} className="underline">
                          {team.name}
                        </Link>
                        <span className="text-xs text-muted">
                          <Translated
                            locale={locale}
                            message="team.followerCount"
                            count={team.followers}
                          />
                        </span>
                        <FollowButton
                          action={follow}
                          locale={locale}
                          type="team"
                          id={team.id}
                          name={team.name}
                        />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <ul className="flex flex-col gap-1 text-sm">
        <li>
          <Link href={`/${locale}/search`} className="underline" data-testid="next-steps-search">
            <Translated locale={locale} message="feed.nextSteps.search" />
          </Link>
        </li>
        <li>
          <Link
            href={`/${locale}/settings`}
            className="underline"
            data-testid="next-steps-everything"
          >
            <Translated locale={locale} message="feed.nextSteps.everything" />
          </Link>
        </li>
      </ul>
    </section>
  );
}

/** One follow, as a plain form: works without JavaScript, and its name says what it follows. */
function FollowButton({
  action,
  locale,
  type,
  id,
  name,
}: {
  action: (formData: FormData) => Promise<void>;
  locale: string;
  type: 'team' | 'competition';
  id: string;
  name: string;
}) {
  return (
    <form action={action} className="contents">
      <input type="hidden" name="entity_type" value={type} />
      <input type="hidden" name="entity_id" value={id} />
      <button type="submit" className="text-sm underline" data-testid="next-steps-follow">
        <Translated locale={locale} message="feed.nextSteps.follow" />
        <span className="sr-only"> {name}</span>
      </button>
    </form>
  );
}
