import { MemberWords } from '@/components/member-words';
import { type QueuedAppeal, isDeletedMember } from '@fmip/contracts';
import { MemberHandle, MemberName } from '@/components/member-name';
import Link from '@/components/ui/link';

/**
 * Members' appeals of sanctions and decisions (T-1973, D-464), newest first:
 * in the queue for every member, and on one member's history page for theirs.
 * What was appealed, the decision's reason, the appeal's words and when. A
 * moderator answers a sanction's appeal by lifting it, or a decision's by a
 * new decision; the appeal itself stays as written.
 *
 * A server component, so a member is named by the rule (`member-name.tsx`):
 * a deleted account is "a deleted member", with no handle and no link.
 */
export function MemberAppeals({
  locale,
  appeals,
  showMember = false,
}: {
  locale: string;
  appeals: QueuedAppeal[];
  /** In the queue, each appeal names its member and links to their history. */
  showMember?: boolean;
}) {
  if (appeals.length === 0) {
    return (
      <p className="text-sm text-muted" data-testid="moderation-appeals-empty">
        No appeal has been written.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-3" data-testid="moderation-appeals">
      {appeals.map((appeal) => (
        <li
          key={appeal.id}
          className="flex flex-col gap-1 rounded border border-default p-3 text-sm"
          data-testid="moderation-appeal"
        >
          <p className="flex flex-wrap items-baseline gap-x-2">
            {showMember &&
              (isDeletedMember(appeal.username) ? (
                <MemberName locale={locale} member={{ username: appeal.username }} />
              ) : (
                <Link
                  href={`/${locale}/admin/moderation/${encodeURIComponent(appeal.username)}`}
                  className="font-medium underline"
                >
                  <MemberHandle username={appeal.username} />
                </Link>
              ))}
            <span className="font-medium">
              {appeal.sanction_id === null
                ? appeal.outcome
                : `${appeal.scope ?? 'restriction'} (${appeal.active === true ? 'in force' : 'not in force'})`}
            </span>
            <span className="text-muted">
              appealed <time dateTime={appeal.created_at}>{appeal.created_at}</time>
            </span>
          </p>
          {/* Written words keep their own direction: moderators and members write Persian. */}
          <p className="text-muted">Decision&apos;s reason:</p>
          <MemberWords text={appeal.decision_reason} className="whitespace-pre-wrap text-muted" />
          <MemberWords
            text={appeal.body}
            className="whitespace-pre-wrap"
            data-testid="moderation-appeal-body"
          />
        </li>
      ))}
    </ul>
  );
}
