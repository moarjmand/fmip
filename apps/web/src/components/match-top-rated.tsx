import type { MatchCentre } from '@fmip/contracts';
import { formatNumber } from '@/i18n/format';
import { listName } from '@/lib/person-name';
import { filled, formatFixed } from '@/lib/words';
import type { MatchWords } from '@/lib/words-server';
import Link from '@/components/ui/link';
import { EntityImage } from '@/components/entity-image';
import { CARD } from '@/components/match-centre-cards';
import { ratingsOf } from '@/components/match-stats-panels';
import { MessageText } from '@/components/message-text';
import { RatingChip } from '@/components/ui/rating-chip';

/**
 * The Top rated card, drawn on the server (T-1814, D-409) and handed to the
 * match centre as its `topRated` slot through `liveSlots`, so neither it nor
 * the rating chip is in the page's JavaScript; in play `refreshLiveModules`
 * draws it again when the stream brings new ratings.
 *
 * No directive: a server module.
 */

type Key = keyof MatchWords['m'];

/**
 * The best rated (the canvas's "Top rated" and "Ratings, best six"; T-1497):
 * the highest rating of the match with that player's goals, assists and xG
 * where they were supplied, then the best six. From the feed's ratings only;
 * with none there is no card, since the statistics already say why (rule 3).
 */
export function TopRated({
  centre,
  locale,
  words,
}: {
  centre: MatchCentre;
  locale: string;
  words: MatchWords;
}) {
  const m = words.m;
  const f = centre.fixture;
  const ratings = ratingsOf(centre);
  const best = (centre.player_statistics.data ?? [])
    .filter((p) => ratings.has(p.id))
    .sort((a, b) => (ratings.get(b.id) ?? 0) - (ratings.get(a.id) ?? 0))
    .slice(0, 6);
  const top = best[0];
  if (top === undefined) return null;
  const team = (side: 'home' | 'away') => (side === 'home' ? f.home : f.away);
  const photo = [...(centre.lineups.data?.home ?? []), ...(centre.lineups.data?.away ?? [])].find(
    (p) => p.id === top.id,
  )?.photo;
  const xg = centre.player_expected_goals.data?.find((p) => p.id === top.id)?.figures.xg;
  const figures: [string, Key][] = [];
  if (top.stats.goals !== undefined)
    figures.push([formatNumber(locale, top.stats.goals), 'matchCentre.player.goals']);
  if (top.stats.assists !== undefined)
    figures.push([formatNumber(locale, top.stats.assists), 'matchCentre.player.assists']);
  if (xg !== undefined) figures.push([formatFixed(locale, xg, 2), 'matchCentre.expectedGoals.xg']);
  return (
    <section className={CARD} data-testid="top-rated">
      <h2 className="text-xs font-extrabold tracking-wider text-accent uppercase">
        <MessageText message={m['matchCentre.topRated']} />
      </h2>
      <div className="flex items-center gap-3.5">
        <EntityImage media={photo} kind="photo" name={top.name} size={48} />
        <span className="flex min-w-0 flex-col gap-1">
          <Link
            href={`/${locale}/player/${top.id}`}
            className="text-lg leading-tight font-extrabold text-fg"
          >
            {listName(locale, top.name)}
          </Link>
          <span className="text-sm text-muted">
            <bdi>{team(top.side).name}</bdi>
            {top.stats.minutes !== undefined && (
              <>
                {' · '}
                <MessageText
                  message={filled(m['matchCentre.minutesPlayed'], {
                    minutes: formatNumber(locale, top.stats.minutes),
                  })}
                />
              </>
            )}
          </span>
        </span>
        <RatingChip
          value={ratings.get(top.id) ?? 0}
          text={formatFixed(locale, ratings.get(top.id) ?? 0, 1)}
          className="ms-auto"
        />
      </div>
      {figures.length > 0 && (
        <dl className="grid grid-cols-3 gap-2.5 tabular-nums">
          {figures.map(([value, label]) => (
            <div key={label} className="flex flex-col-reverse gap-0.5">
              <dt className="text-xs text-caption">
                <MessageText message={m[label]} />
              </dt>
              <dd className="text-2xl leading-none font-extrabold font-stretch-condensed">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <h3 className="border-t border-default pt-3 text-sm font-extrabold">
        <MessageText message={m['matchCentre.bestSix']} />
      </h3>
      <ol className="-mt-1 flex flex-col divide-y divide-default text-sm" data-testid="best-rated">
        {best.map((p) => (
          <li key={p.id} className="flex items-center gap-2.5 py-2">
            <EntityImage
              media={team(p.side).crest}
              kind="crest"
              name={team(p.side).name}
              size={20}
            />
            <Link href={`/${locale}/player/${p.id}`} className="min-w-0 truncate">
              {listName(locale, p.name)}
            </Link>
            <RatingChip
              value={ratings.get(p.id) ?? 0}
              text={formatFixed(locale, ratings.get(p.id) ?? 0, 1)}
              className="ms-auto"
            />
          </li>
        ))}
      </ol>
      <p className="font-mono text-xs text-caption [:root:is(:lang(fa),:lang(ar))_&]:font-sans">
        <MessageText message={m['matchCentre.ratingsNote']} />
      </p>
    </section>
  );
}
