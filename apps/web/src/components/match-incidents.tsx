import type { MatchCentre, MatchIncident } from '@fmip/contracts';
import { incidentDetailKey, incidentKey } from '@/lib/match';
import { listName } from '@/lib/person-name';
import type { MatchWords } from '@/lib/words-server';
import Link from '@/components/ui/link';
import { FilledMessage } from '@/components/filled-message';
import { MessageText } from '@/components/message-text';

/**
 * One incident's row pieces, drawn on the server (T-1812, D-409): its words
 * and its mark, for the Key events card (`match-key-events.tsx`). They stood
 * in the client view while the client drew a live timeline; since T-1811 the
 * server's card is drawn in play too, so they left the page's JavaScript.
 *
 * No directive: a server module. The words come from the page's `MatchWords`.
 */

/** One incident's words: its kind and side, then who (T-1478: who came on, who went off). */
export function IncidentText({
  incident: i,
  inPlay,
  centre,
  locale,
  words,
}: {
  incident: MatchIncident;
  /** False for a shoot-out's kick, which is never called a goal (D-322, D-396). */
  inPlay: boolean;
  centre: MatchCentre;
  locale: string;
  words: MatchWords;
}) {
  const m = words.m;
  const f = centre.fixture;
  const player = (p: { id: string; name: string }) => (
    <Link href={`/${locale}/player/${p.id}`} className="underline">
      {listName(locale, p.name)}
    </Link>
  );
  return (
    <span className="min-w-0 [overflow-wrap:anywhere]">
      <b className="block font-bold text-fg">
        <MessageText message={m[incidentKey(i.kind, inPlay)]} />
        {i.side !== null ? (
          <>
            {' · '}
            <bdi>{i.side === 'home' ? f.home.name : f.away.name}</bdi>
          </>
        ) : null}
        <IncidentDetail detail={i.detail} words={words} />
      </b>
      <span className="text-muted">
        {i.kind === 'substitution' && i.player !== null && i.related_player !== null ? (
          <>
            <FilledMessage
              message={m['matchCentre.subOn']}
              params={{ player: player(i.related_player) }}
            />
            {' · '}
            <FilledMessage
              message={m['matchCentre.subOff']}
              params={{ player: player(i.player) }}
            />
          </>
        ) : (
          <>
            {i.player !== null && player(i.player)}
            {i.related_player !== null && i.kind !== 'substitution' && (
              <>
                {' · '}
                <FilledMessage
                  message={m['matchCentre.assist']}
                  params={{ player: player(i.related_player) }}
                />
              </>
            )}
          </>
        )}
      </span>
    </span>
  );
}

/** A small mark for an incident's kind, in tokens: a ball, a card's colour, an arrow. */
export function IncidentMark({ kind }: { kind: MatchIncident['kind'] | 'kickoff' }) {
  const shape =
    kind === 'yellow_card' ? (
      <span className="h-4 w-3 rounded-xs bg-warning" />
    ) : kind === 'red_card' || kind === 'second_yellow_card' ? (
      <span className="h-4 w-3 rounded-xs bg-danger" />
    ) : kind === 'substitution' ? (
      <span className="text-base leading-none">⇄</span>
    ) : kind === 'var' ? (
      <span className="text-xs font-extrabold">VAR</span>
    ) : kind === 'kickoff' ? (
      <span className="size-2.5 rounded-full border-2 border-fg" />
    ) : kind === 'penalty_missed' ? (
      <span className="size-3 rounded-full border-2 border-dashed border-fg" />
    ) : (
      <span className="size-3 rounded-full bg-accent" />
    );
  return (
    <span
      aria-hidden="true"
      className="grid size-8 shrink-0 place-items-center rounded-control bg-surface-raised text-fg"
    >
      {shape}
    </span>
  );
}

/**
 * What an incident adds to its kind (a VAR review's decision), in the
 * reader's words (T-1378). Nothing when there is none or the page does not
 * know the code: the kind's own label stands, never the provider's text.
 */
function IncidentDetail({ detail, words }: { detail: MatchIncident['detail']; words: MatchWords }) {
  const key = incidentDetailKey(detail);
  if (key === null) return null;
  return (
    <span data-testid="incident-detail">
      {' · '}
      <MessageText message={words.m[key]} />
    </span>
  );
}
