import { MAX_APPEAL, type OwnSanction } from '@fmip/contracts';
import { CommunityAction } from '@/components/community-action';
import { Said } from '@/components/community-text';
import { Translated } from '@/components/translated';
import { Card, Notice, TextArea } from '@/components/ui';
import { formatDateTime, formatNumber } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { interpolate, t } from '@/i18n/messages';
import { sanctionScopeLabel } from '@/lib/report';
import { appealSanctionAction } from '@/lib/report-actions';

/**
 * Settings -> «محدودیت‌های حساب» / "Restrictions on your account" (T-1973).
 *
 * The platform rules promise that a decision restricting what a member can do
 * tells them "which and why", and that "every decision can be appealed once,
 * in writing". This is where both are kept: each sanction with what it
 * restricts, the decision's reason and until when, and under it either the
 * appeal form or the day the appeal was sent -- never both, since the API
 * takes one appeal per sanction.
 *
 * With no sanction the section says so in one line rather than vanishing:
 * a moderation decision's notification opens `#restrictions` (whatever the
 * decision was), and a heading with nothing under it would look like a list
 * that failed to load. A standing the API did not answer is said as that,
 * not as "nothing is restricted" (rule 3).
 */
export function AccountRestrictions({
  locale,
  sanctions,
  timeZone,
}: {
  locale: string;
  /** `null` when the API did not answer. */
  sanctions: OwnSanction[] | null;
  timeZone: string;
}) {
  return (
    <section id="restrictions" className="flex flex-col gap-4" data-testid="account-restrictions">
      <h2 className="text-xl font-semibold">
        <Translated locale={locale} message="restrictions.heading" />
      </h2>
      {sanctions === null ? (
        <Notice tone="danger" data-testid="restrictions-unreachable">
          <Translated locale={locale} message="restrictions.unreachable" />
        </Notice>
      ) : sanctions.length === 0 ? (
        <p className="text-sm text-muted" data-testid="restrictions-none">
          <Translated locale={locale} message="restrictions.none" />
        </p>
      ) : (
        <>
          <p className="text-sm text-muted">
            <Translated locale={locale} message="restrictions.lead" />
          </p>
          <ul className="flex flex-col gap-4" data-testid="restrictions-list">
            {sanctions.map((sanction) => (
              <Restriction
                key={sanction.id}
                locale={locale}
                sanction={sanction}
                timeZone={timeZone}
              />
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
  timeZone,
}: {
  locale: string;
  sanction: OwnSanction;
  timeZone: string;
}) {
  const lang = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const when = (iso: string) => formatDateTime(lang, iso, timeZone);
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
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted">
            <Translated locale={locale} message="restrictions.why" />
          </dt>
          {/* The moderator's own words, as recorded with the decision. */}
          <dd className="whitespace-pre-line break-words" data-testid="restriction-reason">
            {sanction.reason}
          </dd>
        </div>
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
            <dd className="whitespace-pre-line break-words">{sanction.lift_reason}</dd>
          </div>
        )}
      </dl>
      <Appeal locale={locale} sanction={sanction} when={when} />
    </Card>
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
 * The appeal: once. Sent, it is the day it was sent and no second form; a
 * lifted sanction has been undone already and asks for none.
 */
function Appeal({
  locale,
  sanction,
  when,
}: {
  locale: string;
  sanction: OwnSanction;
  when: (iso: string) => string;
}) {
  const lang = isLocale(locale) ? locale : DEFAULT_LOCALE;
  if (sanction.appealed_at !== null) {
    return (
      <p className="text-sm" data-testid="restriction-appealed">
        <Said
          locale={locale}
          message="restrictions.appeal.sentOn"
          params={{ date: when(sanction.appealed_at) }}
        />
      </p>
    );
  }
  if (sanction.lifted_at !== null) return null;
  return (
    <CommunityAction
      action={appealSanctionAction.bind(null, locale, sanction.id)}
      submit={<Translated locale={locale} message="restrictions.appeal.submit" />}
      working={<Translated locale={locale} message="auth.form.working" />}
      done={<Translated locale={locale} message="restrictions.appeal.sent" />}
      variant="secondary"
      formClassName="flex flex-col gap-2"
      formTestId="restriction-appeal-form"
      testId="restriction-appeal-submit"
      resultTestId="restriction-appeal-result"
    >
      <TextArea
        label={<Translated locale={locale} message="restrictions.appeal.label" />}
        hint={interpolate(t(lang, 'restrictions.appeal.hint'), {
          max: formatNumber(lang, MAX_APPEAL),
        })}
        name="body"
        rows={4}
        maxLength={MAX_APPEAL}
        required
      />
    </CommunityAction>
  );
}
