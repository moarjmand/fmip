import type { CompetitionSummary, FollowedEntity, TeamSummary } from '@fmip/contracts';
import { followAction, unfollowAction } from '@/lib/auth-actions';

interface Props {
  locale: string;
  following: FollowedEntity[];
  teams: TeamSummary[];
  competitions: CompetitionSummary[];
}

const TYPE_LABEL: Record<FollowedEntity['entity_type'], string> = {
  team: 'Team',
  competition: 'Competition',
  person: 'Player',
};

/**
 * The member's follows and favourites on the settings page (T-042). Plain
 * forms posting to server actions: each button is one intent, so it works
 * without JavaScript and needs no client state. Follow controls on team,
 * competition and player pages arrive with those pages (E3); until then the
 * pickers below are the way in.
 */
export function FollowingSection({ locale, following, teams, competitions }: Props) {
  const follow = followAction.bind(null, locale);
  const unfollow = unfollowAction.bind(null, locale);
  const followedIds = new Set(following.map((f) => `${f.entity_type}:${f.entity_id}`));
  const unfollowedTeams = teams.filter((t) => !followedIds.has(`team:${t.id}`));
  const unfollowedCompetitions = competitions.filter(
    (c) => !followedIds.has(`competition:${c.id}`),
  );

  return (
    <section className="flex flex-col gap-4" data-testid="following-section">
      <h2 className="text-xl font-semibold">Following</h2>
      <p className="text-sm opacity-70">
        Favourites are pinned first on the scores page and shown on your profile. Everything you
        follow feeds your Following views.
      </p>

      {following.length === 0 ? (
        <p className="text-sm opacity-70">You are not following anything yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-current/20">
          {following.map((item) => (
            <li
              key={`${item.entity_type}:${item.entity_id}`}
              className="flex flex-wrap items-center gap-3 py-2"
              data-testid="following-item"
            >
              <span className="flex-1">
                {item.favourite && (
                  <span aria-label="favourite" className="me-1">
                    ★
                  </span>
                )}
                {item.name}
                <span className="ms-2 text-xs uppercase opacity-60">
                  {TYPE_LABEL[item.entity_type]}
                </span>
              </span>
              <form action={follow} className="contents">
                <input type="hidden" name="entity_type" value={item.entity_type} />
                <input type="hidden" name="entity_id" value={item.entity_id} />
                <input type="hidden" name="favourite" value={item.favourite ? 'false' : 'true'} />
                <button type="submit" className="text-sm underline">
                  {item.favourite ? 'Unpin' : 'Make favourite'}
                </button>
              </form>
              <form action={unfollow} className="contents">
                <input type="hidden" name="entity_type" value={item.entity_type} />
                <input type="hidden" name="entity_id" value={item.entity_id} />
                <button type="submit" className="text-sm underline">
                  Unfollow
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <form action={follow} className="flex flex-col gap-2">
          <input type="hidden" name="entity_type" value="team" />
          <label htmlFor="follow-team" className="text-sm font-medium">
            Follow a team
          </label>
          <select
            id="follow-team"
            name="entity_id"
            required
            className="rounded border border-current/30 bg-transparent px-3 py-2 text-start"
          >
            <option value="">Choose a team…</option>
            {unfollowedTeams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
                {team.kind === 'national' ? ' (national team)' : ''}
              </option>
            ))}
          </select>
          <button type="submit" className="self-start text-sm underline">
            Follow
          </button>
        </form>

        <form action={follow} className="flex flex-col gap-2">
          <input type="hidden" name="entity_type" value="competition" />
          <label htmlFor="follow-competition" className="text-sm font-medium">
            Follow a competition
          </label>
          <select
            id="follow-competition"
            name="entity_id"
            required
            className="rounded border border-current/30 bg-transparent px-3 py-2 text-start"
          >
            <option value="">Choose a competition…</option>
            {unfollowedCompetitions.map((competition) => (
              <option key={competition.id} value={competition.id}>
                {competition.name}
              </option>
            ))}
          </select>
          <button type="submit" className="self-start text-sm underline">
            Follow
          </button>
        </form>
      </div>
    </section>
  );
}
