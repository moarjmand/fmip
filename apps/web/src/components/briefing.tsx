import type { BriefingReason, BriefingResponse } from '@fmip/contracts';
import { ActionForm } from '@/components/action-form';
import { Translated } from '@/components/translated';
import { formatDateTime } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { type MessageKey, message } from '@/i18n/messages';
import { writeBriefingAction } from '@/lib/briefing-actions';

/**
 * The member's briefing on the Following page (E43, T-431): a machine's
 * prose over the feed below it, labelled as such with the model, the window
 * and the time; the sentence that says why there is none; and the button
 * that asks for one, because a version is written when the member asks and
 * never on a page load. The feed under it is the document either way.
 */
const REASON_KEY: Record<BriefingReason, MessageKey> = {
  no_model: 'briefing.reason.noModel',
  nothing_to_brief: 'briefing.reason.nothingToBrief',
  not_written: 'briefing.reason.notWritten',
  rejected: 'briefing.reason.rejected',
};

export function BriefingPanel({
  locale,
  timeZone,
  briefing,
}: {
  locale: string;
  timeZone: string;
  /** `null` when the briefing service could not be reached. */
  briefing: BriefingResponse | null;
}) {
  const prose = briefing?.prose.data ?? null;
  const label = message(isLocale(locale) ? locale : DEFAULT_LOCALE, 'briefing.write').text;
  const state =
    briefing === null
      ? 'unreachable'
      : prose !== null
        ? 'published'
        : (briefing.reason ?? 'not_written');
  const canAsk =
    briefing !== null && briefing.reason !== 'no_model' && briefing.reason !== 'nothing_to_brief';
  return (
    <section
      id="briefing"
      className="flex flex-col gap-3"
      data-testid="briefing"
      data-state={state}
    >
      <h2 className="text-lg font-semibold">
        <Translated locale={locale} message="briefing.title" />
      </h2>
      {briefing === null && (
        <p role="alert">
          <Translated locale={locale} message="briefing.unreachable" />
        </p>
      )}
      {briefing !== null && prose === null && briefing.reason !== null && (
        <p className="text-sm opacity-80" data-testid="briefing-reason">
          <Translated locale={locale} message={REASON_KEY[briefing.reason]} />
        </p>
      )}
      {prose !== null && (
        <>
          <p className="text-xs opacity-70" data-testid="briefing-label">
            <Translated locale={locale} message="briefing.label" />
          </p>
          <div className="flex flex-col gap-2" lang={prose.language} data-testid="briefing-text">
            {prose.text.split(/\n{2,}/).map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
          <p className="text-xs opacity-70" data-testid="briefing-meta">
            <Translated locale={locale} message="briefing.window" />{' '}
            <time dateTime={prose.since}>{formatDateTime(locale, prose.since, timeZone)}</time>
            {' – '}
            <time dateTime={prose.until}>{formatDateTime(locale, prose.until, timeZone)}</time>
            {' · '}
            {prose.model} {'· '}
            <time dateTime={prose.generated_at}>
              {formatDateTime(locale, prose.generated_at, timeZone)}
            </time>
          </p>
        </>
      )}
      {canAsk && (
        <ActionForm
          action={writeBriefingAction.bind(null, locale)}
          fields={[]}
          submitLabel={label}
          testId="briefing-write"
        />
      )}
    </section>
  );
}
