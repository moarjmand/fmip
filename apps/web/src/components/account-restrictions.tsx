import { MAX_APPEAL, type OwnDecision, type OwnSanction } from '@fmip/contracts';
import { CommunityAction } from '@/components/community-action';
import { Said } from '@/components/community-text';
import { Translated } from '@/components/translated';
import { Card, Notice, TextArea } from '@/components/ui';
import { formatDateTime, formatNumber } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { interpolate, t } from '@/i18n/messages';
import type { ActionState } from '@/lib/auth-actions';
import { DECISION_OUTCOME_LABELS, sanctionScopeLabel } from '@/lib/report';
import { appealDecisionAction, appealSanctionAction } from '@/lib/report-actions';

type BoundAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Settings -> «تصمیم‌های نظارتی درباره‌ی حساب شما» / "Moderation decisions on
 * your account" (T-1973).
 *
 * The platform rules promise that a decision tells the member "which and
 * why", and that "every decision can be appealed once, in writing". This is
 * where both are kept: each sanction with what it restricts, the decision's
 * reason and until when; each warning or content removal with its reason and
 * date; and under every one either the appeal form or the day the appeal was
 * sent -- never both, since the API takes one appeal per sanction or
 * decision. Never who decided (policy section 2).
 *
 * With nothing to show the section says so in one line rather than
 * vanishing: a moderation decision's notification opens `#restrictions`, and
 * a heading with nothing under it would look like a list that failed to
 * load. A standing the API did not answer is said as that, not as "nothing"
 * (rule 3).
 */
export function AccountRestrictions({
  locale,
  standing,
  timeZone,
}: {
  locale: string;
  /** `null` when the API did not answer. */
  standing: { sanctions: OwnSanction[]; decisions: OwnDecision[] } | null;
  timeZone: string;
}) {
  const lang = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const when = (iso: string) => formatDateTime(lang, iso, timeZone);
  const empty =
    standing !== null && standing.sanctions.length === 0 && standing.decisions.length === 0;
  return (
    <section id="restrictions" className="flex flex-col gap-4" data-testid="account-restrictions">
      <h2 className="text-xl font-semibold">
        <Translated locale={locale} message="restrictions.heading" />
      </h2>
      {standing === null ? (
        <Notice tone="danger" data-testid="restrictions-unreachable">
          <Translated locale={locale} message="restrictions.unreachable" />
        </Notice>
      ) : empty ? (
        <p className="text-sm text-muted" data-testid="restrictions-none">
          <Translated locale={locale} message="restrictions.none" />
        </p>
      ) : (
        <>
          <p className="text-sm text-muted">
            <Translated locale={locale} message="restrictions.lead" />
          </p>
          <ul className="flex flex-col gap-4" data-testid="restrictions-list">
            {standing.sanctions.map((sanction) => (
              <Restriction key={sanction.id} locale={locale} sanction={sanction} when={when} />
            ))}
            {standing.decisions.map((decision) => (
              <Decision key={decision.id} locale={locale} decision={decision} when={when} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Restriction({
  locale,
  sanction,
  when,
}: {
  locale: string;
  sanction: OwnSanction;
  when: (iso: string) => string;
}) {
  const lang = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return (
    <Card as="li" data-testid="restriction">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-semibold">
          <Translated locale={locale} message={sanctionScopeLabel(sanction.scope)} />
        </h3>
        <span className="text-sm text-muted" data-testid="restriction-state">
          {stateLine(lang, sanction, when)}
        </span>
      </div>
      <dl className="flex flex-col gap-2 text-sm">
        <Why locale={locale} reason={sanction.reason} />
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted">
            <Translated locale={locale} message="restrictions.until" />
          </dt>
          <dd data-testid="restriction-until">
            {sanction.permanent || sanction.ends_at === null ? (
              <Translated locale={locale} message="restrictions.permanent" />
            ) : (
              <time dateTime={sanction.ends_at}>{when(sanction.ends_at)}</time>
            )}
          </dd>
        </div>
        {sanction.lift_reason !== null && (
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted">
              <Translated locale={locale} message="restrictions.liftedWhy" />
            </dt>
            <dd dir="auto" className="whitespace-pre-line break-words">
              {sanction.lift_reason}
            </dd>
          </div>
        )}
      </dl>
      {/* A lifted sanction has been undone already and asks for no appeal. */}
      <Appeal
        locale={locale}
        appealedAt={sanction.appealed_at}
        open={sanction.lifted_at === null}
        action={appealSanctionAction.bind(null, locale, sanction.id)}
        testId="restriction"
        when={when}
      />
    </Card>
  );
}

/** A warning or a content removal (T-1973): what, when, why, and the appeal. */
function Decision({
  locale,
  decision,
  when,
}: {
  locale: string;
  decision: OwnDecision;
  when: (iso: string) => string;
}) {
  const lang = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return (
    <Card as="li" data-testid="decision">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-semibold">
          <Translated locale={locale} message={DECISION_OUTCOME_LABELS[decision.outcome]} />
        </h3>
        <span className="text-sm text-muted" data-testid="decision-date">
          <time dateTime={decision.created_at}>
            {interpolate(t(lang, 'restrictions.decision.on'), { date: when(decision.created_at) })}
          </time>
        </span>
      </div>
      <dl className="flex flex-col gap-2 text-sm">
        <Why locale={locale} reason={decision.reason} />
      </dl>
      {decision.outcome === 'content_removed' && (
        // The decision names no item, and the removed words are never repeated.
        <p className="text-sm text-muted" data-testid="decision-content-note">
          <Translated locale={locale} message="restrictions.decision.contentNote" />
        </p>
      )}
      <Appeal
        locale={locale}
        appealedAt={decision.appealed_at}
        open
        action={appealDecisionAction.bind(null, locale, decision.id)}
        testId="decision"
        when={when}
      />
    </Card>
  );
}

/** The moderator's own words, as recorded with the decision; their form says the member reads them. */
function Why({ locale, reason }: { locale: string; reason: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted">
        <Translated locale={locale} message="restrictions.why" />
      </dt>
      <dd dir="auto" className="whitespace-pre-line break-words" data-testid="restriction-reason">
        {reason}
      </dd>
    </div>
  );
}

/**
 * In force, lifted, or not in force: the server's `active`, computed by the
 * same clock the refusals use, and never the page's -- "not in force" is
 * true of a restriction that has ended and of one that has not begun, and
 * the "Until" row beside it says which.
 */
function stateLine(lang: Locale, sanction: OwnSanction, when: (iso: string) => string): string {
  if (sanction.active) return t(lang, 'restrictions.state.active');
  if (sanction.lifted_at !== null) {
    return interpolate(t(lang, 'restrictions.state.lifted'), { date: when(sanction.lifted_at) });
  }
  return t(lang, 'restrictions.state.inactive');
}

/**
 * The appeal: once. Sent, it is the day it was sent and no second form. The
 * field takes the id `TextArea` makes itself, so two forms never share one.
 */
function Appeal({
  locale,
  appealedAt,
  open,
  action,
  testId,
  when,
}: {
  locale: string;
  appealedAt: string | null;
  /** False when there is nothing left to appeal (a lifted sanction). */
  open: boolean;
  action: BoundAction;
  testId: 'restriction' | 'decision';
  when: (iso: string) => string;
}) {
  const lang = isLocale(locale) ? locale : DEFAULT_LOCALE;
  if (appealedAt !== null) {
    return (
      <p className="text-sm" data-testid={`${testId}-appealed`}>
        <Said
          locale={locale}
          message="restrictions.appeal.sentOn"
          params={{ date: when(appealedAt) }}
        />
      </p>
    );
  }
  if (!open) return null;
  return (
    <CommunityAction
      action={action}
      submit={<Translated locale={locale} message="restrictions.appeal.submit" />}
      working={<Translated locale={locale} message="auth.form.working" />}
      done={<Translated locale={locale} message="restrictions.appeal.sent" />}
      variant="secondary"
      formClassName="flex flex-col gap-2"
      formTestId={`${testId}-appeal-form`}
      testId={`${testId}-appeal-submit`}
      resultTestId={`${testId}-appeal-result`}
    >
      <TextArea
        label={<Translated locale={locale} message="restrictions.appeal.label" />}
        hint={interpolate(t(lang, 'restrictions.appeal.hint'), {
          max: formatNumber(lang, MAX_APPEAL),
        })}
        name="body"
        dir="auto"
        rows={4}
        maxLength={MAX_APPEAL}
        required
      />
    </CommunityAction>
  );
}
