import type { MatchSummaryReason, MatchSummaryResponse, SummaryGrounding } from '@fmip/contracts';
import { ActionForm } from '@/components/action-form';
import { Translated } from '@/components/translated';
import { formatDateTime } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { type MessageKey, message } from '@/i18n/messages';
import { regenerateSummaryAction } from '@/lib/summary-actions';

/**
 * The match summary on the match centre (E41, T-413): what a language model
 * wrote from the record beside it, labelled as a machine's with the model,
 * the version and the time, and never mistaken for the founder's analysis,
 * the forecast or the community's view (rule 6). A finished match with no
 * summary shows the sentence that says why -- no model, not yet, or the last
 * attempt rejected -- and never an empty box; a match that is not over shows
 * nothing, because a summary is of the full record.
 */
const REASON_KEY: Record<MatchSummaryReason, MessageKey> = {
  not_finished: 'summary.reason.notFinished',
  no_model: 'summary.reason.noModel',
  not_generated: 'summary.reason.notGenerated',
  thin_record: 'summary.reason.thinRecord',
  rejected: 'summary.reason.rejected',
};

const PART_KEY: Record<keyof SummaryGrounding, MessageKey> = {
  timeline: 'summary.part.timeline',
  statistics: 'summary.part.statistics',
  lineups: 'summary.part.lineups',
  forecast: 'summary.part.forecast',
  consensus: 'summary.part.consensus',
};

export function MatchSummaryPanel({
  locale,
  timeZone,
  fixtureId,
  status,
  summary,
  editor,
}: {
  locale: string;
  timeZone: string;
  fixtureId: string;
  status: string;
  /** `null` when the summary service could not be reached. */
  summary: MatchSummaryResponse | null;
  editor: boolean;
}) {
  if (status !== 'finished') return null;
  const t = (key: MessageKey): string =>
    message(isLocale(locale) ? locale : DEFAULT_LOCALE, key).text;
  const data = summary?.summary.data ?? null;
  const state =
    summary === null
      ? 'unreachable'
      : data !== null
        ? 'published'
        : (summary.reason ?? 'not_generated');
  return (
    <section className="flex flex-col gap-3" data-testid="match-summary" data-state={state}>
      <h2 className="text-lg font-semibold">
        <Translated locale={locale} message="summary.title" />
      </h2>
      {summary === null && (
        <p role="alert">
          <Translated locale={locale} message="summary.unreachable" />
        </p>
      )}
      {summary !== null && data === null && summary.reason !== null && (
        <p className="text-sm opacity-80" data-testid="match-summary-reason">
          <Translated locale={locale} message={REASON_KEY[summary.reason]} />
        </p>
      )}
      {data !== null && (
        <>
          <p className="text-xs opacity-70" data-testid="match-summary-label">
            <Translated locale={locale} message="summary.label" />
          </p>
          <div
            className="flex flex-col gap-2"
            lang={data.language}
            data-testid="match-summary-text"
          >
            {data.text.split(/\n{2,}/).map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
          <p className="text-xs opacity-70" data-testid="match-summary-meta">
            <Translated locale={locale} message="summary.model" /> {data.model} {'· '}
            <Translated locale={locale} message="summary.version" /> {data.version_number} {'· '}
            <Translated locale={locale} message="summary.written" />{' '}
            <time dateTime={data.generated_at}>
              {formatDateTime(locale, data.generated_at, timeZone)}
            </time>
            {' · '}
            <Translated locale={locale} message="summary.groundedOn" />{' '}
            {(Object.keys(PART_KEY) as (keyof SummaryGrounding)[])
              .filter((part) => data.grounded_on[part] !== 'not_supplied')
              .map((part) => t(PART_KEY[part]))
              .join(', ') || t('summary.part.score')}
          </p>
        </>
      )}
      {editor && summary !== null && (
        <ActionForm
          action={regenerateSummaryAction.bind(null, locale, fixtureId)}
          fields={[{ name: 'reason', label: 'Why a new version', type: 'text', required: true }]}
          submitLabel="Write a new version"
          testId="match-summary-regenerate"
        />
      )}
    </section>
  );
}
