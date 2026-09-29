import {
  GROUP_INVITE_POLICIES,
  type Group,
  type GroupHistoryEntry,
  type GroupHistoryResponse,
  type GroupInviteLink,
  type GroupInviteLinksResponse,
  INVITE_LINK_DEFAULT_HOURS,
  INVITE_LINK_DEFAULT_USES,
  INVITE_LINK_MAX_USES,
  type TeamsResponse,
  type CompetitionsResponse,
} from '@fmip/contracts';
import { formatDateTime } from '@/i18n/format';
import { DEFAULT_LOCALE, UNFINISHED_LOCALES, isLocale } from '@/i18n/locales';
import { plural, t } from '@/i18n/messages';
import type { ApiResult } from '@/lib/api';
import { languageName } from '@/lib/group-about';
import {
  LINK_DURATION_HOURS,
  favouriteValue,
  historyActionKey,
  historyValues,
  linkStateKey,
  policyKey,
} from '@/lib/group-settings';
import {
  createInviteLinkAction,
  revokeInviteLinkAction,
  setInvitePolicyAction,
  updateGroupAboutAction,
} from '@/lib/group-settings-actions';
import { GroupPollForm as SettingsForm } from '@/components/group-poll-form';
import { InviteLinkCreate } from '@/components/invite-link-create';
import { MemberName } from '@/components/member-name';
import { Translated } from '@/components/translated';
import { Notice, Radio, Select, TextField } from '@/components/ui';

/**
 * Running a group from its page (T-1026, over the API of T-1020..T-1023).
 *
 * Server components: every control is a form posting to a server action, so
 * it works without JavaScript, and the words are chosen from the catalogue
 * here. The one client piece is the "make a link" form, which holds the new
 * token in memory to show it once and copy it. Who may use each control is
 * the API's rule; the page only offers each one to whoever the API would let.
 */

/** The languages offered: the site's own, as the directory's filter offers them. */
const LANGUAGES: readonly string[] = ['en', ...UNFINISHED_LOCALES];

function working(locale: string) {
  return <Translated locale={locale} message="groupSettings.working" />;
}

/**
 * The owner's settings: who may invite, and the group's language and
 * favourite. `teams` or `competitions` is `null` when the list could not be
 * fetched: the favourite is then not offered (and so not sent), rather than
 * shown as a list that looks like there is nothing to choose.
 */
export function GroupOwnerSettings({
  locale,
  group,
  teams,
  competitions,
}: {
  locale: string;
  group: Group;
  teams: TeamsResponse['teams'] | null;
  competitions: CompetitionsResponse['competitions'] | null;
}) {
  const languages =
    group.language !== null && !LANGUAGES.includes(group.language)
      ? [...LANGUAGES, group.language]
      : LANGUAGES;
  const lists = teams !== null && competitions !== null;
  const current =
    group.favourite === null ? null : { type: group.favourite.type, id: group.favourite.id };

  return (
    <section className="flex flex-col gap-4" data-testid="group-settings">
      <h2 className="text-lg font-semibold">
        <Translated locale={locale} message="groupSettings.title" />
      </h2>

      <SettingsForm
        action={setInvitePolicyAction.bind(null, locale, group.slug)}
        submit={<Translated locale={locale} message="groupSettings.policy.save" />}
        working={working(locale)}
        testId="group-policy"
        quiet
      >
        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="font-medium">
            <Translated locale={locale} message="groupSettings.policy.title" />
          </legend>
          {GROUP_INVITE_POLICIES.map((policy) => (
            <Radio
              key={policy}
              name="invite_policy"
              value={policy}
              defaultChecked={policy === group.invite_policy}
              required
              label={<Translated locale={locale} message={policyKey(policy)} />}
            />
          ))}
        </fieldset>
        <p className="text-sm text-muted">
          <Translated locale={locale} message="groupSettings.policy.hint" />
        </p>
      </SettingsForm>

      <SettingsForm
        action={updateGroupAboutAction.bind(null, locale, group.slug)}
        submit={<Translated locale={locale} message="groupSettings.about.save" />}
        working={working(locale)}
        testId="group-about"
        quiet
      >
        <h3 className="font-medium">
          <Translated locale={locale} message="groupSettings.about.title" />
        </h3>
        <Select
          label={<Translated locale={locale} message="groupSettings.about.language" />}
          name="language"
          defaultValue={group.language ?? ''}
          size="sm"
          className="self-start"
          data-testid="group-about-language"
        >
          <option value="">{t(resolved(locale), 'groupSettings.about.none')}</option>
          {languages.map((tag) => (
            <option key={tag} value={tag}>
              {languageName(locale, tag)}
            </option>
          ))}
        </Select>
        {lists ? (
          <Select
            label={<Translated locale={locale} message="groupSettings.about.favourite" />}
            name="favourite"
            defaultValue={favouriteValue(current)}
            size="sm"
            data-testid="group-about-favourite"
          >
            <option value="">{t(resolved(locale), 'groupSettings.about.none')}</option>
            <optgroup label={t(resolved(locale), 'groupSettings.about.competitions')}>
              {competitions.map((c) => (
                <option key={c.id} value={favouriteValue({ type: 'competition', id: c.id })}>
                  {c.name}
                </option>
              ))}
            </optgroup>
            <optgroup label={t(resolved(locale), 'groupSettings.about.clubs')}>
              {teams.map((team) => (
                <option key={team.id} value={favouriteValue({ type: 'team', id: team.id })}>
                  {team.name}
                </option>
              ))}
            </optgroup>
          </Select>
        ) : (
          <p className="text-sm text-muted" data-testid="group-about-favourite-unavailable">
            <Translated locale={locale} message="groupSettings.about.listUnavailable" />
          </p>
        )}
      </SettingsForm>
    </section>
  );
}

function resolved(locale: string) {
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}

/**
 * The group's invite links: the list (never a token), a revoke control on
 * each live one, and the form that makes a new one. The owner and moderators
 * see every link; anybody else the policy lets invite, their own -- the
 * API's answer, not a filter here.
 */
export function GroupInviteLinks({
  locale,
  slug,
  timeZone,
  result,
}: {
  locale: string;
  slug: string;
  timeZone: string;
  result: ApiResult<GroupInviteLinksResponse>;
}) {
  const here = resolved(locale);
  return (
    <section className="flex flex-col gap-3" data-testid="group-links">
      <h2 className="text-lg font-semibold">
        <Translated locale={locale} message="groupSettings.links.title" />
      </h2>
      <p className="text-sm text-muted">
        <Translated locale={locale} message="groupSettings.links.hint" />
      </p>

      <InviteLinkCreate
        action={createInviteLinkAction.bind(null, locale, slug)}
        labels={{
          submit: <Translated locale={locale} message="groupSettings.links.create" />,
          working: working(locale),
          newLink: <Translated locale={locale} message="groupSettings.links.newLink" />,
          copy: <Translated locale={locale} message="groupSettings.links.copy" />,
          copied: <Translated locale={locale} message="groupSettings.links.copied" />,
          copyFailed: <Translated locale={locale} message="groupSettings.links.copyFailed" />,
        }}
      >
        <h3 className="font-medium">
          <Translated locale={locale} message="groupSettings.links.createTitle" />
        </h3>
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label={<Translated locale={locale} message="groupSettings.links.lasts" />}
            name="expires_in_hours"
            defaultValue={String(INVITE_LINK_DEFAULT_HOURS)}
            size="sm"
          >
            {LINK_DURATION_HOURS.map((hours) => (
              <option key={hours} value={hours}>
                {hours < 24
                  ? t(here, 'groupSettings.links.oneHour')
                  : plural(here, 'groupSettings.links.days', hours / 24).text}
              </option>
            ))}
          </Select>
          <TextField
            label={<Translated locale={locale} message="groupSettings.links.maxUses" />}
            name="max_uses"
            type="number"
            min={1}
            max={INVITE_LINK_MAX_USES}
            defaultValue={INVITE_LINK_DEFAULT_USES}
            required
            size="sm"
            controlClassName="w-24"
          />
        </div>
      </InviteLinkCreate>

      {!result.ok ? (
        <Notice tone="danger" data-testid="group-links-unreachable">
          <Translated locale={locale} message="groupSettings.links.unreachable" />
        </Notice>
      ) : result.data.links.length === 0 ? (
        <p className="text-sm text-muted" data-testid="group-links-none">
          <Translated locale={locale} message="groupSettings.links.none" />
        </p>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="group-links-list">
          {result.data.links.map((link) => (
            <li key={link.id} className="flex flex-col gap-1 text-sm" data-link={link.id}>
              <LinkRow locale={locale} slug={slug} timeZone={timeZone} link={link} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LinkRow({
  locale,
  slug,
  timeZone,
  link,
}: {
  locale: string;
  slug: string;
  timeZone: string;
  link: GroupInviteLink;
}) {
  return (
    <>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium" data-testid="group-link-state">
          <Translated locale={locale} message={linkStateKey(link.state)} />
        </span>
        <span className="text-muted">
          <Translated locale={locale} message="groupSettings.links.used" />{' '}
          <span className="tabular-nums">
            {link.uses} / {link.max_uses}
          </span>
        </span>
        <span className="text-muted">
          <Translated locale={locale} message="groupSettings.links.expires" />{' '}
          <time dateTime={link.expires_at}>
            {formatDateTime(locale, link.expires_at, timeZone)}
          </time>
        </span>
      </p>
      <p className="text-muted">
        {link.created_by === null ? (
          <Translated locale={locale} message="groupSettings.links.madeByGone" />
        ) : (
          <>
            <Translated locale={locale} message="groupSettings.links.madeBy" />{' '}
            <MemberName locale={locale} member={{ username: link.created_by }} />
          </>
        )}
      </p>
      {link.state === 'live' && (
        <SettingsForm
          action={revokeInviteLinkAction.bind(null, locale, slug, link.id)}
          submit={<Translated locale={locale} message="groupSettings.links.revoke" />}
          working={working(locale)}
          testId="group-link-revoke"
          quiet
        />
      )}
    </>
  );
}

/** The group's audited changes, newest first, for its owner and moderators. */
export function GroupHistory({
  locale,
  timeZone,
  result,
}: {
  locale: string;
  timeZone: string;
  result: ApiResult<GroupHistoryResponse>;
}) {
  if (!result.ok) {
    return (
      <Notice tone="danger" data-testid="group-history-unreachable">
        <Translated locale={locale} message="groupSettings.history.unreachable" />
      </Notice>
    );
  }
  if (result.data.history.length === 0) {
    return (
      <p className="text-sm text-muted" data-testid="group-history-none">
        <Translated locale={locale} message="groupSettings.history.none" />
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-4" data-testid="group-history-list">
      {result.data.history.map((entry, i) => (
        <li key={`${entry.created_at}-${i}`} className="flex flex-col gap-1 text-sm">
          <HistoryEntry locale={locale} timeZone={timeZone} entry={entry} />
        </li>
      ))}
    </ol>
  );
}

function HistoryEntry({
  locale,
  timeZone,
  entry,
}: {
  locale: string;
  timeZone: string;
  entry: GroupHistoryEntry;
}) {
  return (
    <>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium" data-testid="group-history-action">
          <Translated locale={locale} message={historyActionKey(entry.action)} />
        </span>
        <span className="text-muted">
          <time dateTime={entry.created_at}>
            {formatDateTime(locale, entry.created_at, timeZone)}
          </time>
        </span>
        <span className="text-muted">
          <Translated locale={locale} message="groupSettings.history.by" />{' '}
          {entry.actor === null ? (
            <Translated locale={locale} message="groupSettings.history.accountGone" />
          ) : (
            <MemberName locale={locale} member={{ username: entry.actor }} />
          )}
        </span>
      </p>
      {entry.reason !== '' && (
        <p>
          <span className="text-muted">
            <Translated locale={locale} message="groupSettings.history.reason" />:
          </span>{' '}
          {entry.reason}
        </p>
      )}
      <Change locale={locale} side="before" values={historyValues(entry.previous)} />
      <Change locale={locale} side="after" values={historyValues(entry.next)} />
    </>
  );
}

function Change({
  locale,
  side,
  values,
}: {
  locale: string;
  side: 'before' | 'after';
  values: ReturnType<typeof historyValues>;
}) {
  if (values.length === 0) return null;
  return (
    <p data-testid={`group-history-${side}`}>
      <span className="text-muted">
        <Translated
          locale={locale}
          message={
            side === 'before' ? 'groupSettings.history.before' : 'groupSettings.history.after'
          }
        />
        :
      </span>{' '}
      {values.map((v, i) => (
        <span key={v.field}>
          {i > 0 && ' · '}
          <code className="text-xs">{v.field}</code>{' '}
          {v.policy !== null ? (
            <Translated locale={locale} message={policyKey(v.policy)} />
          ) : (
            v.value
          )}
        </span>
      ))}
    </p>
  );
}
