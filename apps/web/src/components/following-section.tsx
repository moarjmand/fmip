import type { CompetitionSummary, FollowedEntity, TeamSummary } from '@fmip/contracts';
import { Translated } from '@/components/translated';
import { DEFAULT_LOCALE, type Locale, isLocale } from '@/i18n/locales';
import { type MessageKey, interpolate, t } from '@/i18n/messages';
import { followAction, unfollowAction } from '@/lib/auth-actions';
import { Button, Select } from '@/components/ui';

interface Props {
  locale: string;
  following: FollowedEntity[];
  teams: TeamSummary[];
  competitions: CompetitionSummary[];
}

const TYPE_LABEL: Record<FollowedEntity['entity_type'], MessageKey> = {
  team: 'news.filter.team',
  competition: 'news.filter.competition',
  person: 'followingPage.player',
  fixture: 'news.match',
};

/**
 * The member's follows and favourites on the settings page (T-042). Plain
 * forms posting to server actions: each button is one intent, so it works
 * without JavaScript and needs no client state. Follow controls on team,
 * competition and player pages arrive with those pages (E3); until then the
 * pickers below are the way in.
 */
export function FollowingSection({ locale, following, teams, competitions }: Props) {
  const resolved: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const follow = followAction.bind(null, locale);
  const unfollow = unfollowAction.bind(null, locale);
  const followedIds = new Set(following.map((f) => `${f.entity_type}:${f.entity_id}`));
  const unfollowedTeams = teams.filter((t) => !followedIds.has(`team:${t.id}`));
  const unfollowedCompetitions = competitions.filter(
    (c) => !followedIds.has(`competition:${c.id}`),
  );

  return (
    <section className="flex flex-col gap-4" data-testid="following-section">
      <h2 className="text-xl font-semibold">
        <Translated locale={locale} message="feed.title" />
      </h2>
      <p className="text-sm text-muted">
        <Translated locale={locale} message="followingPage.intro" />
      </p>

      {following.length === 0 ? (
        <p className="text-sm text-muted">
          <Translated locale={locale} message="followingPage.nothing" />
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-default">
          {following.map((item) => (
            <li
              key={`${item.entity_type}:${item.entity_id}`}
              className="flex flex-wrap items-center gap-3 py-2"
              data-testid="following-item"
            >
              <span className="flex-1">
                {item.favourite && (
                  <span aria-label={t(resolved, 'followingPage.favourite')} className="me-1">
                    ★
                  </span>
                )}
                {item.name}
                <span className="ms-2 text-xs uppercase text-muted">
                  <Translated locale={locale} message={TYPE_LABEL[item.entity_type]} />
                </span>
              </span>
              {/* A match is followed, never pinned (D-116). */}
              {item.entity_type !== 'fixture' && (
                <form action={follow} className="contents">
                  <input type="hidden" name="entity_type" value={item.entity_type} />
                  <input type="hidden" name="entity_id" value={item.entity_id} />
                  <input type="hidden" name="favourite" value={item.favourite ? 'false' : 'true'} />
                  <Button type="submit" variant="ghost" size="sm">
                    <Translated
                      locale={locale}
                      message={
                        item.favourite ? 'followingPage.unpin' : 'followingPage.makeFavourite'
                      }
                    />
                  </Button>
                </form>
              )}
              <form action={unfollow} className="contents">
                <input type="hidden" name="entity_type" value={item.entity_type} />
                <input type="hidden" name="entity_id" value={item.entity_id} />
                <Button type="submit" variant="ghost" size="sm">
                  <Translated locale={locale} message="story.follow.unfollow" />
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <form action={follow} className="flex flex-col gap-2">
          <input type="hidden" name="entity_type" value="team" />
          <Select
            label={<Translated locale={locale} message="followingPage.followTeam" />}
            id="follow-team"
            name="entity_id"
            required
          >
            <option value="">{t(resolved, 'followingPage.chooseTeam')}</option>
            {unfollowedTeams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.kind === 'national'
                  ? interpolate(t(resolved, 'followingPage.nationalTeam'), { name: team.name })
                  : team.name}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="ghost" size="sm" className="self-start">
            <Translated locale={locale} message="story.follow.follow" />
          </Button>
        </form>

        <form action={follow} className="flex flex-col gap-2">
          <input type="hidden" name="entity_type" value="competition" />
          <Select
            label={<Translated locale={locale} message="followingPage.followCompetition" />}
            id="follow-competition"
            name="entity_id"
            required
          >
            <option value="">{t(resolved, 'followingPage.chooseCompetition')}</option>
            {unfollowedCompetitions.map((competition) => (
              <option key={competition.id} value={competition.id}>
                {competition.name}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="ghost" size="sm" className="self-start">
            <Translated locale={locale} message="story.follow.follow" />
          </Button>
        </form>
      </div>
    </section>
  );
}
