import type { GroupPredictionCall, GroupPredictionComparison } from '@fmip/contracts';
import { MemberName } from '@/components/member-name';
import { MessageText } from '@/components/message-text';
import { Translated } from '@/components/translated';
import { Said, said } from '@/components/community-text';
import { ScorePair } from '@/components/score';
import { formatNumber } from '@/i18n/format';
import type { Message, MessageKey } from '@/i18n/messages';

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
const OUTCOME: Record<string, MessageKey> = {
  home: 'groupsPage.comparison.home',
  draw: 'groupsPage.comparison.draw',
  away: 'groupsPage.comparison.away',
};

function verdict(locale: string, call: GroupPredictionCall): Message {
  const settled = call.settlement;
  if (settled === null) return said(locale, 'groupsPage.comparison.unsettled');
  if (settled.status === 'void') {
    return said(locale, 'groupsPage.comparison.void', {
      reason: settled.void_reason ?? said(locale, 'groupsPage.comparison.noReason').text,
    });
  }
  if (settled.outcome_correct !== true) return said(locale, 'groupsPage.comparison.wrong');
  return said(
    locale,
    settled.score_correct === true
      ? 'groupsPage.comparison.rightScore'
      : 'groupsPage.comparison.right',
  );
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
      <h2 className="text-lg font-semibold">
        <Said locale={locale} message="groupsPage.comparison.title" params={{ group: groupName }} />
      </h2>

      {calls.length === 0 ? (
        <p className="text-sm text-muted" data-testid="group-comparison-none">
          <Translated locale={locale} message="groupsPage.comparison.none" />
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {calls.map((call) => (
            <li
              key={call.username}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm"
            >
              <MemberName locale={locale} member={call} link className="underline" />
              <span>
                {OUTCOME[call.version.outcome] === undefined ? (
                  call.version.outcome
                ) : (
                  <Translated locale={locale} message={OUTCOME[call.version.outcome]!} />
                )}
              </span>
              {call.version.score !== null && (
                <ScorePair locale={locale} className="text-muted">
                  {formatNumber(locale, call.version.score.home)}–
                  {formatNumber(locale, call.version.score.away)}
                </ScorePair>
              )}
              <span className="text-muted">
                <Said
                  locale={locale}
                  message="groupsPage.comparison.confidence"
                  params={{
                    confidence: formatNumber(locale, call.version.confidence),
                    max: formatNumber(locale, 5),
                  }}
                />
              </span>
              {call.revisions > 1 && (
                <span className="text-muted" data-testid={`revisions-${call.username}`}>
                  <Said
                    locale={locale}
                    message="groupsPage.comparison.changed"
                    params={{ count: formatNumber(locale, call.revisions - 1) }}
                  />
                </span>
              )}
              <span className="ms-auto text-muted" data-testid={`verdict-${call.username}`}>
                <MessageText message={verdict(locale, call)} />
              </span>
            </li>
          ))}
        </ul>
      )}

      {(silent > 0 || withheld > 0) && (
        <p className="text-xs text-muted" data-testid="group-comparison-absent">
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
        <p className="text-xs text-muted" data-testid="group-comparison-open">
          <Translated locale={locale} message="groupsPage.comparison.open" />
        </p>
      )}
    </section>
  );
}
