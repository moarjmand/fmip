import {
  type GroupPoll,
  type GroupPollsResponse,
  MAX_OPEN_POLLS,
  MAX_POLL_OPTION,
  MAX_POLL_OPTIONS,
  MAX_POLL_QUESTION,
  MAX_POLL_REMOVAL_REASON,
  POLL_DEFAULT_HOURS,
} from '@fmip/contracts';
import { formatDateTime } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { plural } from '@/i18n/messages';
import type { ApiResult } from '@/lib/api';
import {
  closePollAction,
  createPollAction,
  removePollAction,
  votePollAction,
  withdrawPollVoteAction,
} from '@/lib/group-poll-actions';
import { GroupPollForm } from '@/components/group-poll-form';
import { Translated } from '@/components/translated';
import { Notice, Radio, TextField, controlClasses } from '@/components/ui';

/** How long a new poll may stay open, in days, as the form offers it. */
export const POLL_DURATION_DAYS = [1, 3, 7, 14, 30] as const;

/**
 * A group's polls on its page (blueprint 8.2, T-643, D-091). Members only:
 * the page renders this only for somebody in the group, and the API refuses
 * anybody else.
 *
 * Every number is the API's. Before a member has voted on an open poll there
 * are no counts to show -- the API sends none -- so the section says when
 * they will appear rather than drawing empty bars. Who voted is never shown,
 * because the API never says.
 */
export function GroupPollsSection({
  locale,
  slug,
  timeZone,
  result,
}: {
  locale: string;
  slug: string;
  timeZone: string;
  result: ApiResult<GroupPollsResponse>;
}) {
  if (!result.ok) {
    return (
      <Notice tone="danger" data-testid="group-polls-unreachable">
        <Translated locale={locale} message="groupPolls.unreachable" />
      </Notice>
    );
  }
  const { polls } = result.data;
  const open = polls.filter((p) => p.status === 'open').length;

  return (
    <div className="flex flex-col gap-4">
      {polls.length === 0 ? (
        <p className="text-sm text-muted" data-testid="group-polls-none">
          <Translated locale={locale} message="groupPolls.none" />
        </p>
      ) : (
        <ul className="flex flex-col gap-6" data-testid="group-polls-list">
          {polls.map((poll) => (
            <li key={poll.id} className="flex flex-col gap-2" data-poll={poll.id}>
              <PollItem locale={locale} slug={slug} timeZone={timeZone} poll={poll} />
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">
        <Translated locale={locale} message="groupPolls.noNames" />
      </p>
      {open >= MAX_OPEN_POLLS ? (
        <p className="text-sm text-muted" data-testid="group-polls-limit">
          <Translated locale={locale} message="groupPolls.limitReached" />
        </p>
      ) : (
        <CreatePoll locale={locale} slug={slug} />
      )}
    </div>
  );
}

function PollItem({
  locale,
  slug,
  timeZone,
  poll,
}: {
  locale: string;
  slug: string;
  timeZone: string;
  poll: GroupPoll;
}) {
  const working = <Translated locale={locale} message="groupPolls.working" />;
  const ended = poll.closed_at ?? poll.closes_at;
  return (
    <>
      <p className="font-semibold">{poll.question}</p>
      <p className="text-xs text-muted">
        {poll.created_by !== null && (
          <>
            <Translated locale={locale} message="groupPolls.askedBy" /> @{poll.created_by} ·{' '}
          </>
        )}
        <Translated
          locale={locale}
          message={poll.status === 'open' ? 'groupPolls.closes' : 'groupPolls.closed'}
        />{' '}
        <time dateTime={ended}>{formatDateTime(locale, ended, timeZone)}</time>
      </p>

      {poll.total_votes !== null ? (
        <div className="flex flex-col gap-1" data-testid="group-poll-results">
          <ul className="flex flex-col gap-1 text-sm">
            {poll.options.map((option) => (
              <li key={option.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className={option.id === poll.my_vote ? 'font-semibold' : undefined}>
                  {option.label}
                </span>
                <span className="tabular-nums text-muted">
                  <Translated
                    locale={locale}
                    message="groupPolls.voteCount"
                    count={option.votes ?? 0}
                  />
                </span>
                {option.id === poll.my_vote && (
                  <span className="text-xs text-muted">
                    (<Translated locale={locale} message="groupPolls.yourAnswer" />)
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted tabular-nums">
            <Translated locale={locale} message="groupPolls.voteCount" count={poll.total_votes} />
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted" data-testid="group-poll-hidden">
          <Translated locale={locale} message="groupPolls.hiddenUntilVoted" />
        </p>
      )}

      {poll.status === 'open' && (
        <GroupPollForm
          action={votePollAction.bind(null, locale, slug, poll.id)}
          submit={
            <Translated
              locale={locale}
              message={poll.my_vote === null ? 'groupPolls.vote' : 'groupPolls.changeVote'}
            />
          }
          working={working}
          testId="group-poll-vote"
        >
          <fieldset className="flex flex-col gap-1 text-sm">
            <legend className="sr-only">{poll.question}</legend>
            {poll.options.map((option) => (
              <Radio
                key={option.id}
                label={option.label}
                name="option_id"
                value={option.id}
                defaultChecked={option.id === poll.my_vote}
                required
              />
            ))}
          </fieldset>
        </GroupPollForm>
      )}

      <div className="flex flex-wrap items-start gap-3">
        {poll.status === 'open' && poll.my_vote !== null && (
          <GroupPollForm
            action={withdrawPollVoteAction.bind(null, locale, slug, poll.id)}
            submit={<Translated locale={locale} message="groupPolls.withdraw" />}
            working={working}
            testId="group-poll-withdraw"
            quiet
          />
        )}
        {poll.may_close && (
          <GroupPollForm
            action={closePollAction.bind(null, locale, slug, poll.id)}
            submit={<Translated locale={locale} message="groupPolls.close" />}
            working={working}
            testId="group-poll-close"
            quiet
          />
        )}
      </div>

      {poll.may_remove && (
        <GroupPollForm
          action={removePollAction.bind(null, locale, slug, poll.id)}
          submit={<Translated locale={locale} message="groupPolls.remove" />}
          working={working}
          testId="group-poll-remove"
          quiet
        >
          <TextField
            label={<Translated locale={locale} message="groupPolls.removeReason" />}
            name="reason"
            required
            maxLength={MAX_POLL_REMOVAL_REASON}
          />
        </GroupPollForm>
      )}
    </>
  );
}

function CreatePoll({ locale, slug }: { locale: string; slug: string }) {
  const resolved = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const defaultDays = POLL_DEFAULT_HOURS / 24;
  return (
    <section className="flex flex-col gap-2" data-testid="group-poll-create">
      <h3 className="font-semibold">
        <Translated locale={locale} message="groupPolls.createTitle" />
      </h3>
      <GroupPollForm
        action={createPollAction.bind(null, locale, slug)}
        submit={<Translated locale={locale} message="groupPolls.create" />}
        working={<Translated locale={locale} message="groupPolls.working" />}
        testId="group-poll-new"
      >
        <TextField
          label={<Translated locale={locale} message="groupPolls.question" />}
          name="question"
          required
          maxLength={MAX_POLL_QUESTION}
        />
        <fieldset className="flex flex-col gap-1 text-sm">
          <legend>
            <Translated locale={locale} message="groupPolls.optionsHint" />
          </legend>
          {Array.from({ length: MAX_POLL_OPTIONS }, (_, i) => (
            <label key={i} className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-muted">
                <Translated locale={locale} message="groupPolls.option" /> {i + 1}
              </span>
              <input
                name="option"
                required={i < 2}
                maxLength={MAX_POLL_OPTION}
                className={controlClasses('sm', 'grow')}
              />
            </label>
          ))}
        </fieldset>
        <label className="flex items-center gap-2 text-sm">
          <Translated locale={locale} message="groupPolls.duration" />
          <select name="days" defaultValue={String(defaultDays)} className={controlClasses('sm')}>
            {POLL_DURATION_DAYS.map((days) => (
              <option key={days} value={days}>
                {plural(resolved, 'groupPolls.days', days).text}
              </option>
            ))}
          </select>
        </label>
      </GroupPollForm>
    </section>
  );
}
