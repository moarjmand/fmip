import Link from 'next/link';
import type { GroupPredictionCall, GroupPredictionComparison } from '@fmip/contracts';
import { Translated } from '@/components/translated';

/**
 * What the group called (blueprint 8.2, T-246, T-248).
 *
 * **Nothing here is computed.** The verdict beside a call is the settlement that
 * was stored for it; a component that worked out whether somebody was right
 * would be a second settlement on the surface, which is the same defect the API
 * refuses one layer down (D-063, rule 8). Where there is no settlement the
 * answer is "not settled yet", which is a fact, not a blank.
 *
 * **The absent are counted, not dropped.** Members who said nothing and members
 * whose predictions this viewer may not see are two different facts and both are
 * stated, because a list of three calls in a group of eight would otherwise read
 * as the whole group having spoken (rule 3).
 */
const OUTCOME: Record<string, string> = {
  home: 'Home win',
  draw: 'Draw',
  away: 'Away win',
};

function verdict(call: GroupPredictionCall): string {
  const settled = call.settlement;
  if (settled === null) return 'Not settled yet';
  if (settled.status === 'void') return `Void — ${settled.void_reason ?? 'no reason given'}`;
  if (settled.outcome_correct !== true) return 'Wrong';
  return settled.score_correct === true ? 'Right, with the score' : 'Right';
}

export function GroupComparison({
  comparison,
  locale,
  groupName,
}: {
  comparison: GroupPredictionComparison;
  locale: string;
  groupName: string;
}) {
  const { calls, silent, withheld } = comparison;

  return (
    <section className="flex flex-col gap-3" data-testid="group-comparison">
      <h2 className="text-lg font-semibold">What {groupName} called</h2>

      {calls.length === 0 ? (
        <p className="text-sm opacity-70" data-testid="group-comparison-none">
          Nobody here has called this match.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {calls.map((call) => (
            <li
              key={call.username}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm"
            >
              <Link
                href={`/${locale}/u/${encodeURIComponent(call.username)}`}
                className="underline"
              >
                {call.display_name}
              </Link>
              <span>{OUTCOME[call.version.outcome] ?? call.version.outcome}</span>
              {call.version.score !== null && (
                <span className="opacity-70">
                  {call.version.score.home}–{call.version.score.away}
                </span>
              )}
              <span className="opacity-70">confidence {call.version.confidence}/5</span>
              {call.revisions > 1 && (
                <span className="opacity-70" data-testid={`revisions-${call.username}`}>
                  changed {call.revisions - 1}×
                </span>
              )}
              <span className="ms-auto opacity-70" data-testid={`verdict-${call.username}`}>
                {verdict(call)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {(silent > 0 || withheld > 0) && (
        <p className="text-xs opacity-60" data-testid="group-comparison-absent">
          {silent > 0 && (
            <Translated locale={locale} message="groupComparison.silent" count={silent} />
          )}
          {silent > 0 && withheld > 0 && ' '}
          {withheld > 0 && (
            <Translated locale={locale} message="groupComparison.withheld" count={withheld} />
          )}
        </p>
      )}

      {!comparison.locked && (
        <p className="text-xs opacity-60" data-testid="group-comparison-open">
          This match has not kicked off. Calls can still change until it does.
        </p>
      )}
    </section>
  );
}
