import { REPORT_REASONS } from '@fmip/contracts';
import { CommunityAction } from '@/components/community-action';
import { Said } from '@/components/community-text';
import { Translated } from '@/components/translated';
import { Select, TextArea, buttonClasses } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import { formatNumber } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { interpolate, t } from '@/i18n/messages';
import { REPORT_REASON_LABELS, type ReportedMessage, reportNoteLimit } from '@/lib/report';
import { reportMemberAction } from '@/lib/report-actions';

/**
 * «گزارش» / "Report" (T-1973; the platform rules: "anybody can report a
 * member. A person reads every report and records what they decided").
 *
 * Folded under its control, a `<details>`, so it costs a profile or a message
 * one button until somebody needs it, and opens without JavaScript. The form
 * is the API's report: a reason from its own list, a note within its length,
 * and a plain sentence afterwards that a person will read it.
 *
 * From a message (`message`), the report is of the message's author -- the
 * API has no message subject -- and names the message in its detail; the
 * control is then the small one the other message controls are.
 *
 * Who sees it is the caller's: never a guest, never the member themselves.
 * A server component (T-1308): the words are resolved here and the form is
 * the client `CommunityAction`.
 */
export function ReportMember({
  locale,
  username,
  message = null,
}: {
  locale: string;
  username: string;
  message?: ReportedMessage | null;
}) {
  const lang = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const fromMessage = message !== null;
  const limit = reportNoteLimit(message);
  const id = fromMessage ? `report-${message.messageId}` : 'report-member';
  return (
    <details
      className="min-w-0 max-w-full open:basis-full"
      data-testid={fromMessage ? 'report-message' : 'report-member'}
    >
      <summary
        className={buttonClasses({
          variant: fromMessage ? 'ghost' : 'secondary',
          size: fromMessage ? 'xs' : 'md',
          className: cx(
            'cursor-pointer list-none [&::-webkit-details-marker]:hidden',
            fromMessage && 'text-muted',
          ),
        })}
        data-testid={`${id}-open`}
      >
        <Translated locale={locale} message="report.open" />
      </summary>
      <div className="mt-2 flex flex-col gap-3 rounded border border-default p-3">
        <p className="text-sm text-muted">
          {fromMessage ? (
            <Said locale={locale} message="report.leadMessage" params={{ username }} />
          ) : (
            <Translated locale={locale} message="report.lead" />
          )}
        </p>
        <CommunityAction
          action={reportMemberAction.bind(null, locale, username, message)}
          submit={<Translated locale={locale} message="report.submit" />}
          working={<Translated locale={locale} message="auth.form.working" />}
          done={<Translated locale={locale} message="report.sent" />}
          variant="secondary"
          formClassName="flex flex-col gap-3"
          formTestId={`${id}-form`}
          testId={`${id}-submit`}
          resultTestId={`${id}-result`}
        >
          <Select
            label={<Translated locale={locale} message="report.reason" />}
            id={`${id}-reason`}
            name="reason"
            required
            defaultValue=""
          >
            <option value="" disabled>
              {t(lang, 'report.chooseReason')}
            </option>
            {REPORT_REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {t(lang, REPORT_REASON_LABELS[reason])}
              </option>
            ))}
          </Select>
          <TextArea
            label={<Translated locale={locale} message="report.detail" />}
            hint={interpolate(t(lang, 'report.detailHint'), { max: formatNumber(lang, limit) })}
            id={`${id}-detail`}
            name="detail"
            rows={3}
            maxLength={limit}
          />
        </CommunityAction>
      </div>
    </details>
  );
}
