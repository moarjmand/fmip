import type { MatchLineupPlayer, MatchLineups, MatchTeam } from '@fmip/contracts';
import Link from 'next/link';
import { formatNumber } from '@/i18n/format';
import { EntityImage } from '@/components/entity-image';
import { MessageText } from '@/components/message-text';
import { ltrIsolate } from '@/components/score';
import { type PitchLines, pitchLines } from '@/lib/formation';
import { fill, filled } from '@/lib/words';
import type { MatchWords } from '@/lib/words-server';

/**
 * The line-ups on a pitch (T-1384, D-202): the away side in the top half, its
 * goalkeeper at the top, the home side in the bottom half, its goalkeeper at
 * the bottom, each line of the formation a row, then each side's bench and
 * coach. A side is placed only where its formation and its starters' roles
 * place every player on one line (`pitchLines`); otherwise that side is a
 * list, and a sentence says why (rule 3: never an invented position). Across
 * a row the order is the shirt number's, and the note under the pitch says
 * so. Brand and neutral tokens only: no club colour (D-202).
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
  locale,
  words,
}: {
  home: MatchTeam;
  away: MatchTeam;
  lineups: MatchLineups;
  locale: string;
  words: MatchWords;
}) {
  const m = words.m;
  const teams: Record<Side, { team: MatchTeam; players: MatchLineupPlayer[]; shape: PitchLines }> =
    {
      home: { team: home, players: lineups.home, shape: pitchLines(home.formation, lineups.home) },
      away: { team: away, players: lineups.away, shape: pitchLines(away.formation, lineups.away) },
    };
  // An answer with nobody in it is no line-up, not two empty lists (rule 3).
  if (lineups.home.length === 0 && lineups.away.length === 0) {
    return (
      <p dir="auto" className="text-sm text-muted" data-testid="lineup-empty">
        <MessageText message={m['matchCentre.moduleNotSupplied']} />
      </p>
    );
  }
  const placed = (['away', 'home'] as const).filter((side) => teams[side].shape.state === 'pitch');
  const listed = (['home', 'away'] as const).filter((side) => teams[side].shape.state !== 'pitch');
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
            className="relative overflow-hidden rounded-tile border-2 border-strong/50 bg-surface-raised py-1"
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
                <p className="relative flex items-baseline gap-2 px-3 py-1.5">
                  <bdi className="font-extrabold text-fg">{team.name}</bdi>
                  <span dir="ltr" className="font-mono text-xs text-caption">
                    {shape.formation}
                  </span>
                </p>
              );
              return (
                <div key={side} className="relative" data-side={side} data-testid={`pitch-${side}`}>
                  {side === 'away' && heading}
                  {rows.map((row, index) => (
                    <ol key={index} className="flex justify-around py-1.5">
                      {row.map((p) => (
                        <PitchPlayer key={p.id} player={p} locale={locale} words={words} />
                      ))}
                    </ol>
                  ))}
                  {side === 'home' && heading}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-caption" data-testid="lineup-pitch-note">
            <MessageText message={m['matchCentre.lineups.pitchNote']} />
          </p>
        </div>
      )}

      {listed.map((side) => {
        const { team, players, shape } = teams[side];
        if (shape.state === 'pitch') return null;
        const formation = 'formation' in shape ? shape.formation : '';
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
          {p.name}
        </Link>
        {p.is_captain ? ` ${words.m['matchCentre.captain'].text}` : ''}
      </span>
    </>
  );
}

function PitchPlayer({
  player: p,
  locale,
  words,
}: {
  player: MatchLineupPlayer;
  locale: string;
  words: MatchWords;
}) {
  return (
    <li className="flex w-18 min-w-0 flex-col items-center gap-0.5 text-center">
      <Link
        href={`/${locale}/player/${p.id}`}
        className="flex min-w-0 flex-col items-center gap-0.5"
        title={p.name}
      >
        <EntityImage
          media={p.photo}
          kind="photo"
          name={p.name}
          size={40}
          className="ring-2 ring-muted"
        />
        <span className="block max-w-18 truncate text-xs font-semibold text-fg">
          {p.name}
          {p.is_captain ? ` ${words.m['matchCentre.captain'].text}` : ''}
        </span>
      </Link>
      {p.shirt_number !== null && (
        <span className="font-mono text-xs text-caption">
          {formatNumber(locale, p.shirt_number)}
        </span>
      )}
    </li>
  );
}

/** The pitch's lines, drawn in the border token on the raised ground. */
function PitchMarkings({ full, placed }: { full: boolean; placed: readonly Side[] }) {
  const line = 'pointer-events-none absolute border-strong/50';
  return (
    <span aria-hidden="true">
      {full && (
        <>
          <span className={`${line} inset-x-0 top-1/2 border-t-2`} />
          <span
            className={`${line} inset-x-0 top-1/2 mx-auto size-20 -translate-y-1/2 rounded-full border-2`}
          />
        </>
      )}
      {placed.includes('away') && (
        <span className={`${line} inset-x-0 top-0 mx-auto h-[12%] w-[56%] border-2 border-t-0`} />
      )}
      {placed.includes('home') && (
        <span
          className={`${line} inset-x-0 bottom-0 mx-auto h-[12%] w-[56%] border-2 border-b-0`}
        />
      )}
    </span>
  );
}
