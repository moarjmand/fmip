import type { CompetitionSummary, FollowedEntity, TeamSummary } from '@fmip/contracts';
import { followAction, unfollowAction } from '@/lib/auth-actions';
import { Button, Select } from '@/components/ui';

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
  fixture: 'Match',
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
      <p className="text-sm text-muted">
        Favourites are pinned first on the scores page and shown on your profile. Everything you
        follow feeds your Following views.
      </p>

      {following.length === 0 ? (
        <p className="text-sm text-muted">You are not following anything yet.</p>
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
                  <span aria-label="favourite" className="me-1">
                    ★
                  </span>
                )}
                {item.name}
                <span className="ms-2 text-xs uppercase text-muted">
                  {TYPE_LABEL[item.entity_type]}
                </span>
              </span>
              {/* A match is followed, never pinned (D-116). */}
              {item.entity_type !== 'fixture' && (
                <form action={follow} className="contents">
                  <input type="hidden" name="entity_type" value={item.entity_type} />
                  <input type="hidden" name="entity_id" value={item.entity_id} />
                  <input type="hidden" name="favourite" value={item.favourite ? 'false' : 'true'} />
                  <Button type="submit" variant="ghost" size="sm">
                    {item.favourite ? 'Unpin' : 'Make favourite'}
                  </Button>
                </form>
              )}
              <form action={unfollow} className="contents">
                <input type="hidden" name="entity_type" value={item.entity_type} />
                <input type="hidden" name="entity_id" value={item.entity_id} />
                <Button type="submit" variant="ghost" size="sm">
                  Unfollow
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <form action={follow} className="flex flex-col gap-2">
          <input type="hidden" name="entity_type" value="team" />
          <Select label="Follow a team" id="follow-team" name="entity_id" required>
            <option value="">Choose a team…</option>
            {unfollowedTeams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
                {team.kind === 'national' ? ' (national team)' : ''}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="ghost" size="sm" className="self-start">
            Follow
          </Button>
        </form>

        <form action={follow} className="flex flex-col gap-2">
          <input type="hidden" name="entity_type" value="competition" />
          <Select label="Follow a competition" id="follow-competition" name="entity_id" required>
            <option value="">Choose a competition…</option>
            {unfollowedCompetitions.map((competition) => (
              <option key={competition.id} value={competition.id}>
                {competition.name}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="ghost" size="sm" className="self-start">
            Follow
          </Button>
        </form>
      </div>
    </section>
  );
}
