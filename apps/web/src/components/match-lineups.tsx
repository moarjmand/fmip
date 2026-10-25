import type { MatchLineupPlayer, MatchLineups, MatchTeam } from '@fmip/contracts';
import Link from '@/components/ui/link';
import { formatNumber } from '@/i18n/format';
import { EntityImage } from '@/components/entity-image';
import { RatingChip } from '@/components/ui/rating-chip';
import { MessageText } from '@/components/message-text';
import { ltrIsolate, nameIsolate } from '@/components/score';
import { type PitchLines, pitchShape } from '@/lib/formation';
import { listName } from '@/lib/person-name';
import { fill, filled, formatFixed } from '@/lib/words';
import type { MatchWords } from '@/lib/words-server';

/**
 * The line-ups on a pitch (T-1384, D-202; T-1497): on a phone the away side
 * in the top half, its goalkeeper at the top, the home side in the bottom
 * half, its goalkeeper at the bottom, each line a row; from 768px one
 * horizontal pitch, the home side from the inline start and the away side
 * from the end, each line a column (D-263 point 4). The same markup turns
 * with the width, so the page carries one pitch, not two. Each player is his
 * shirt number, his name and his rating where the feed gave one; the best
 * rated of the match in saffron. Then each side's bench and coach.
 *
 * A side whose starters all carry the place the line-up gives them is drawn
 * from those places, whatever the formation (T-1397, D-212): each row one line
 * from the goalkeeper's, each player on his own side of the pitch as his team
 * attacks -- so the home side's left is the pitch's left and the away side's
 * (attacking down the screen) its right. The pitch is a picture of the ground,
 * so its rows keep that left and right on a right-to-left page too.
 *
 * Without the places, a side is placed only where its formation and its
 * starters' roles put every player on one line (`pitchLines`), in
 * shirt-number order across a row, which the note under the pitch says;
 * otherwise that side is a list, and a sentence says why (rule 3: never an
 * invented position). Brand and neutral tokens only: no club colour (D-202).
 */

type Side = 'home' | 'away';

const REASON_KEY = {
  no_formation: 'matchCentre.lineups.noFormation',
  no_roles: 'matchCentre.lineups.noRoles',
  lines_unknown: 'matchCentre.lineups.linesUnknown',
  mismatch: 'matchCentre.lineups.mismatch',
} as const satisfies Record<Exclude<PitchLines['state'], 'pitch'>, keyof MatchWords['m']>;

export function MatchLineupsView({
  home,
  away,
  lineups,
  ratings = new Map(),
  locale,
  words,
}: {
  home: MatchTeam;
  away: MatchTeam;
  lineups: MatchLineups;
  /** The feed's ratings by player id (`ratingsOf`); a player without one has no chip. */
  ratings?: ReadonlyMap<string, number>;
  locale: string;
  words: MatchWords;
}) {
  const m = words.m;
  const teams: Record<Side, { team: MatchTeam; players: MatchLineupPlayer[]; shape: PitchLines }> =
    {
      home: { team: home, players: lineups.home, shape: pitchShape(home.formation, lineups.home) },
      away: { team: away, players: lineups.away, shape: pitchShape(away.formation, lineups.away) },
    };
  // An answer with nobody in it is no line-up, not two empty lists (rule 3).
  if (lineups.home.length === 0 && lineups.away.length === 0) {
    return (
      <p dir="auto" className="text-sm text-muted" data-testid="lineup-empty">
        <MessageText message={m['matchCentre.moduleNotSupplied']} />
      </p>
    );
  }
  const top = Math.max(...ratings.values());
  const chip = (p: MatchLineupPlayer) => ({
    rating: ratings.get(p.id),
    best: ratings.get(p.id) === top,
  });
  const placed = (['away', 'home'] as const).filter((side) => teams[side].shape.state === 'pitch');
  const listed = (['home', 'away'] as const).filter((side) => teams[side].shape.state !== 'pitch');
  const placedBy = (by: 'grid' | 'roles') =>
    placed.filter((side) => {
      const shape = teams[side].shape;
      return shape.state === 'pitch' && shape.by === by;
    });
  const [byGrid] = placedBy('grid');
  const [byRoles] = placedBy('roles');
  // One note for what is on the pitch: every side by its places, every side
  // by the roles (shirt-number order), or one of each, named.
  const note =
    byRoles === undefined
      ? m['matchCentre.lineups.pitchNoteGrid']
      : byGrid === undefined
        ? m['matchCentre.lineups.pitchNote']
        : filled(m['matchCentre.lineups.pitchNoteMixed'], {
            grid: nameIsolate(teams[byGrid].team.name),
            roles: nameIsolate(teams[byRoles].team.name),
          });
  return (
    <div className="flex flex-col gap-4 text-sm">
      {placed.length > 0 && (
        <div className="flex flex-col gap-2">
          <div
            role="group"
            aria-label={fill(m['matchCentre.lineups.pitchLabel'].text, {
              home: home.name,
              away: away.name,
            })}
            className="relative flex flex-col overflow-hidden rounded-tile border-2 border-strong/50 bg-surface-raised py-1 md:h-110 md:flex-row-reverse md:py-0"
            data-testid="lineup-pitch"
            data-sides={placed.join(' ')}
          >
            {/* The markings: halfway line and centre circle when both halves
                are drawn, a penalty box at each goal. Decoration only. */}
            <PitchMarkings full={placed.length === 2} placed={placed} />
            {placed.map((side) => {
              const { team, shape } = teams[side];
              if (shape.state !== 'pitch') return null;
              // Top half: goalkeeper first; bottom half: goalkeeper last.
              const rows = side === 'away' ? shape.lines : [...shape.lines].reverse();
              const heading = (
                <p
                  className={`relative flex items-baseline gap-2 px-3 py-1.5 md:absolute md:top-1 ${side === 'away' ? 'md:end-0' : 'md:start-0'}`}
                >
                  <bdi className="font-extrabold text-fg">{team.name}</bdi>
                  {shape.formation !== null && (
                    <span dir="ltr" className="font-mono text-xs text-caption">
                      {shape.formation}
                    </span>
                  )}
                </p>
              );
              return (
                <div
                  key={side}
                  className="relative flex flex-col md:flex-1 md:flex-row-reverse md:pt-8"
                  data-side={side}
                  data-testid={`pitch-${side}`}
                  data-placed-by={shape.by}
                >
                  {side === 'away' && heading}
                  {rows.map((row, index) =>
                    shape.by === 'grid' ? (
                      // Placed by the line-up: a line runs from the side's own
                      // left as it attacks, which is the pitch's left for the
                      // home side (attacking up) and its right for the away
                      // side. The row is a picture of the ground, so it keeps
                      // its left and right on a right-to-left page (`dir`).
                      // Down the horizontal pitch a line runs from the side's
                      // left as it attacks, which flips with the mirrored pitch
                      // on a right-to-left page.
                      <ol key={index} dir="ltr" className={`${LINE} rtl:md:flex-col-reverse`}>
                        {(side === 'home' ? row : [...row].reverse()).map((p) => (
                          <PitchPlayer
                            key={p.id}
                            player={p}
                            side={side}
                            {...chip(p)}
                            locale={locale}
                            words={words}
                          />
                        ))}
                      </ol>
                    ) : (
                      <ol key={index} className={LINE}>
                        {row.map((p) => (
                          <PitchPlayer
                            key={p.id}
                            player={p}
                            side={side}
                            {...chip(p)}
                            locale={locale}
                            words={words}
                          />
                        ))}
                      </ol>
                    ),
                  )}
                  {side === 'home' && heading}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-caption" data-testid="lineup-pitch-note">
            <MessageText message={note} />
          </p>
        </div>
      )}

      {listed.map((side) => {
        const { team, players, shape } = teams[side];
        if (shape.state === 'pitch') return null;
        const formation = 'formation' in shape ? (shape.formation ?? '') : '';
        return (
          <div key={side} className="flex flex-col gap-1" data-testid={`lineup-list-${side}`}>
            <h3 className="flex flex-wrap items-baseline gap-x-2 font-extrabold">
              <bdi>{team.name}</bdi>
              {team.formation !== null ? (
                <span dir="ltr" className="font-mono text-xs font-medium text-caption">
                  {team.formation}
                </span>
              ) : null}
            </h3>
            <p
              dir="auto"
              className="text-xs text-caption"
              data-testid="lineup-fallback"
              data-reason={players.length === 0 ? 'not_supplied' : shape.state}
            >
              <MessageText
                message={
                  players.length === 0
                    ? m['matchCentre.moduleNotSupplied']
                    : filled(m[REASON_KEY[shape.state]], { formation: ltrIsolate(formation) })
                }
              />
            </p>
            <ul>
              {players
                .filter((p) => p.role === 'starter')
                .map((p) => (
                  <li key={p.id} className={LINEUP_ROW}>
                    <ListPlayer player={p} locale={locale} words={words} />
                  </li>
                ))}
            </ul>
          </div>
        );
      })}

      <div className="grid grid-cols-1 gap-3 @md:grid-cols-2" data-testid="lineup-benches">
        {(['home', 'away'] as const).map((side) => {
          const { team, players } = teams[side];
          const bench = players.filter((p) => p.role === 'bench');
          return (
            <div key={side} className="flex flex-col gap-1 rounded-tile bg-surface-raised p-3">
              <h3 className="text-xs font-extrabold tracking-wide text-muted uppercase">
                <bdi>{team.name}</bdi> · <MessageText message={m['matchCentre.bench']} />
              </h3>
              {bench.length > 0 ? (
                <ul>
                  {bench.map((p) => (
                    <li key={p.id} className={LINEUP_ROW}>
                      <ListPlayer player={p} locale={locale} words={words} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p dir="auto" className="text-xs text-caption">
                  <MessageText message={m['matchCentre.moduleNotSupplied']} />
                </p>
              )}
              <p className="text-xs text-muted">
                <MessageText
                  message={filled(m['matchCentre.coach'], {
                    name: team.coach?.name ?? m['status.coverage.notSupplied'].text,
                  })}
                />
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One line of a side: a row across a phone's pitch, a column down the horizontal one. */
const LINE = 'flex justify-around py-1.5 md:flex-1 md:flex-col md:px-0.5 md:py-2';

/** A line-up row: the photo, then the shirt number and the name on one line (T-1321). */
const LINEUP_ROW = 'flex items-center gap-2 py-0.5';

function ListPlayer({
  player: p,
  locale,
  words,
}: {
  player: MatchLineupPlayer;
  locale: string;
  words: MatchWords;
}) {
  return (
    <>
      <EntityImage media={p.photo} kind="photo" name={p.name} size={22} />
      <span className="min-w-0">
        {p.shirt_number !== null ? (
          <span className="font-mono text-xs text-caption">
            {formatNumber(locale, p.shirt_number)}{' '}
          </span>
        ) : null}
        {/* Every line-up name links to the player page (blueprint 5.3, T-037). */}
        <Link href={`/${locale}/player/${p.id}`} className="underline">
          {listName(locale, p.name)}
        </Link>
        {p.is_captain ? ` ${words.m['matchCentre.captain'].text}` : ''}
      </span>
    </>
  );
}

function PitchPlayer({
  player: p,
  side,
  rating,
  best,
  locale,
  words,
}: {
  player: MatchLineupPlayer;
  side: Side;
  rating: number | undefined;
  best: boolean;
  locale: string;
  words: MatchWords;
}) {
  return (
    <li className="flex w-18 min-w-0 flex-col items-center gap-0.5 text-center md:w-auto">
      <Link
        href={`/${locale}/player/${p.id}`}
        className="flex min-w-0 flex-col items-center gap-0.5"
        title={p.name}
      >
        {p.shirt_number !== null ? (
          <span
            className={`grid size-8 place-items-center rounded-full text-sm font-extrabold tabular-nums ${
              best && rating !== undefined
                ? 'bg-accent text-on-accent'
                : side === 'home'
                  ? 'bg-fg text-canvas'
                  : 'bg-muted text-canvas'
            }`}
          >
            {formatNumber(locale, p.shirt_number)}
          </span>
        ) : (
          <EntityImage media={p.photo} kind="photo" name={p.name} size={40} />
        )}
        <span
          dir="auto"
          className="block max-w-18 truncate text-xs font-semibold text-fg md:max-w-24"
        >
          {listName(locale, p.name)}
          {p.is_captain ? ` ${words.m['matchCentre.captain'].text}` : ''}
        </span>
      </Link>
      {rating !== undefined && <RatingChip value={rating} text={formatFixed(locale, rating, 1)} />}
    </li>
  );
}

/**
 * The pitch's lines, drawn in the border token on the raised ground: across
 * a phone's pitch, down the horizontal one. Decoration only.
 */
function PitchMarkings({ full, placed }: { full: boolean; placed: readonly Side[] }) {
  const line = 'pointer-events-none absolute border-strong/50';
  return (
    <span aria-hidden="true">
      {full && (
        <>
          <span
            className={`${line} inset-x-0 top-1/2 border-t-2 md:inset-x-auto md:inset-y-0 md:start-1/2 md:border-s-2 md:border-t-0`}
          />
          <span
            className={`${line} inset-x-0 top-1/2 mx-auto size-20 -translate-y-1/2 rounded-full border-2 md:size-29`}
          />
        </>
      )}
      {placed.includes('away') && (
        <span
          className={`${line} inset-x-0 top-0 mx-auto h-[12%] w-[56%] border-2 border-t-0 md:inset-x-auto md:end-0 md:top-1/4 md:mx-0 md:h-1/2 md:w-[14%] md:border-e-0 md:border-t-2`}
        />
      )}
      {placed.includes('home') && (
        <span
          className={`${line} inset-x-0 bottom-0 mx-auto h-[12%] w-[56%] border-2 border-b-0 md:inset-x-auto md:start-0 md:top-1/4 md:bottom-auto md:mx-0 md:h-1/2 md:w-[14%] md:border-s-0 md:border-b-2`}
        />
      )}
    </span>
  );
}
