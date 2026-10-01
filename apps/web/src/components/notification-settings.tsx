'use client';

import { type ReactNode, useActionState } from 'react';
import type {
  MatchAlertKind,
  NotificationCategory,
  NotificationKind,
  NotificationMute,
  NotificationPreference,
  NotificationSettings,
} from '@fmip/contracts';
import { NOTIFICATION_CATEGORIES, isMatchAlertKind } from '@fmip/contracts';
import { useClientMessages } from '@/components/client-messages';
import { MessageText } from '@/components/message-text';
import type { Message, MessageKey } from '@/i18n/messages';
import {
  muteAction,
  setNotificationPreferenceAction,
  setQuietHoursAction,
  unmuteAction,
} from '@/lib/notification-actions';
import { KIND_ROW_KEYS, type NotificationSettingsMessages } from '@/lib/notification-messages';
import { isSectionedKind, type SectionedKind } from '@/lib/notification-sections';
import { Button, FormStatus, Select, TextField } from '@/components/ui';

/**
 * Choosing what arrives, and when (blueprint 12.2, T-273).
 *
 * **Every kind is listed, including the ones already on.** A settings page that
 * showed only what a member had changed would get emptier the more they agreed
 * with it, and they would have nowhere to go to turn something off.
 *
 * **The defaults are not restated here.** The API sends the value in force and
 * whether it is the member's own; this renders that. A second copy of the
 * defaults in the browser is the copy that goes stale, and the one a member is
 * looking at.
 */

/**
 * A sentence per kind, so a member is choosing about a thing and not a slug.
 * The match alerts are not here: they have a section of their own, worded
 * through the catalogues (`match-alert-settings.tsx`, T-831), and so do the
 * sectioned kinds (`kind-section.tsx`, T-832).
 */
type ListedKind = Exclude<NotificationKind, MatchAlertKind | SectionedKind>;

type SettingsKey = keyof NotificationSettingsMessages & MessageKey;

const KIND_LABEL: Record<ListedKind, SettingsKey> = {
  prediction_settled: 'alerts.kind.predictionSettled',
  rating_changed: 'alerts.kind.ratingChanged',
  career_points_awarded: 'alerts.kind.careerPointsAwarded',
  achievement_unlocked: 'alerts.kind.achievementUnlocked',
  friend_request: 'alerts.kind.friendRequest',
  friend_accepted: 'alerts.kind.friendAccepted',
  message_received: 'alerts.kind.messageReceived',
  mentioned: 'alerts.kind.mentioned',
  group_invite: 'alerts.kind.groupInvite',
  group_join_request: 'alerts.kind.groupJoinRequest',
  moderation_decision: 'alerts.kind.moderationDecision',
  contributor_granted: 'alerts.kind.contributorGranted',
  contributor_grant_changed: 'alerts.kind.contributorGrantChanged',
  panel_reaction: 'alerts.kind.panelReaction',
  briefing: 'alerts.kind.briefing',
  campaign: 'alerts.kind.campaign',
  // Opt-in (T-1005, D-125): once per story, about a team, competition or player I follow.
  breaking_news: 'alerts.kind.breakingNews',
  // Opt-in (T-1032, D-166): once per story, about a team or player I follow.
  transfer_news: 'alerts.kind.transferNews',
  availability_news: 'alerts.kind.availabilityNews',
  // Offered to administrators only; the API leaves it out for everyone else (T-802).
  system_alert: 'alerts.kind.systemAlert',
  // Administrators only, like the system alert (T-1031, D-137).
  contributor_below_threshold: 'alerts.kind.contributorBelowThreshold',
};

/** The kinds this list offers: every one but those with a section of their own. */
function isListedHere(
  preference: NotificationPreference,
): preference is NotificationPreference & { kind: ListedKind } {
  return !isMatchAlertKind(preference.kind) && !isSectionedKind(preference.kind);
}

/** The categories a member can silence as one (T-331), named in words. */
const CATEGORY_LABEL: Record<NotificationCategory, SettingsKey> = {
  football: 'alerts.category.football',
  social: 'alerts.category.social',
  account: 'alerts.category.account',
  match: 'alerts.category.match',
};

/** What a silenced thing of each scope stops, in words. */
const MUTE_SCOPE_LABEL: Record<NotificationMute['scope'], SettingsKey> = {
  team: 'alerts.mute.team',
  competition: 'alerts.mute.competition',
  category: 'alerts.mute.category',
};

function MuteRow({
  locale,
  mute,
  messages,
}: {
  locale: string;
  mute: NotificationMute;
  messages: NotificationSettingsMessages;
}) {
  const [state, formAction, pending] = useActionState(
    unmuteAction.bind(null, locale, mute.scope, mute.target),
    null,
  );
  const name =
    mute.scope === 'category' ? (
      <MessageText message={messages[CATEGORY_LABEL[mute.target as NotificationCategory]]} />
    ) : (
      (mute.label ?? mute.target)
    );
  return (
    <li
      className="flex flex-wrap items-center justify-between gap-2 border-b border-default py-2"
      data-testid="notification-mute"
      data-scope={mute.scope}
    >
      <span className="flex flex-col">
        <span className="text-sm">{name}</span>
        <span className="text-xs text-muted">
          <MessageText message={messages[MUTE_SCOPE_LABEL[mute.scope]]} />
        </span>
      </span>
      <form action={formAction}>
        <Button type="submit" pending={pending}>
          <MessageText message={messages['alerts.unmute']} />
        </Button>
        {state !== null && !state.ok && (
          <FormStatus ok={false} as="span" size="xs" className="ms-2">
            {state.message}
          </FormStatus>
        )}
      </form>
    </li>
  );
}

function MuteForm({
  locale,
  scope,
  label,
  options,
  messages,
}: {
  locale: string;
  scope: 'team' | 'competition' | 'category';
  label: Message;
  options: { value: string; label: string }[];
  messages: NotificationSettingsMessages;
}) {
  const [state, formAction, pending] = useActionState(muteAction.bind(null, locale, scope), null);
  const id = `mute-${scope}`;
  return (
    <form
      action={formAction}
      className="flex flex-wrap items-end gap-2"
      data-testid={`mute-${scope}`}
    >
      <Select label={<MessageText message={label} />} id={id} name="target" size="sm">
        <option value="">{messages['alerts.choose'].text}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      <Button type="submit" pending={pending}>
        <MessageText message={messages['alerts.silence']} />
      </Button>
      {state !== null && (
        <FormStatus ok={state.ok} as="span" size="xs">
          {state.ok
            ? (state.message ?? <MessageText message={messages['alerts.done']} />)
            : state.message}
        </FormStatus>
      )}
    </form>
  );
}

/**
 * The switch's own words where no provider hands them down: the English,
 * marked as standing in (T-151). The settings page always provides them
 * (`KIND_ROW_KEYS`), so a reader never meets this; it keeps a render outside
 * that page honest rather than blank.
 */
const KIND_ROW_STANDING_IN: Record<(typeof KIND_ROW_KEYS)[number], Message> = {
  'alerts.yourChoice': { text: 'Your choice', status: 'untranslated' },
  'alerts.default': { text: 'Default', status: 'untranslated' },
  'alerts.on': { text: 'On', status: 'untranslated' },
  'alerts.off': { text: 'Off', status: 'untranslated' },
};

/**
 * One kind's switch. Exported for the match-alert section, which words its own
 * labels (T-831). Its own words -- whose choice it is, on or off -- come from
 * the page's `ClientMessagesProvider`, because the server sections draw it
 * too (T-1305).
 */
export function KindRow({
  locale,
  kind,
  label,
  inProduct,
  chosen,
  cap,
}: {
  locale: string;
  kind: NotificationKind;
  label: ReactNode;
  inProduct: boolean;
  chosen: boolean;
  /** "at most N an hour", resolved on the server from `NOTIFICATION_HOURLY_CAP[kind]`. */
  cap?: Message;
}) {
  const [state, formAction, pending] = useActionState(
    setNotificationPreferenceAction.bind(null, locale, kind, !inProduct),
    null,
  );
  const words = useClientMessages(KIND_ROW_KEYS) ?? KIND_ROW_STANDING_IN;

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-default py-2">
      <span className="flex flex-col">
        <span className="text-sm">{label}</span>
        <span className="text-xs text-muted">
          {/* Said out loud, because "Default" and "your choice that happens to
              match the default" behave differently the day a default changes. */}
          <MessageText message={words[chosen ? 'alerts.yourChoice' : 'alerts.default']} />
          {cap !== undefined && (
            <>
              {' · '}
              <MessageText message={cap} />
            </>
          )}
        </span>
      </span>
      <form action={formAction}>
        <Button
          type="submit"
          pending={pending}
          // The state is in the label and in `aria-pressed`, not only in a
          // border: a border does not reach a screen reader.
          aria-pressed={inProduct}
          selected={inProduct}
          data-testid={`notification-kind-${kind}`}
        >
          <MessageText message={words[inProduct ? 'alerts.on' : 'alerts.off']} />
        </Button>
        {state !== null && !state.ok && (
          <FormStatus ok={false} as="span" size="xs" className="ms-2">
            {state.message}
          </FormStatus>
        )}
      </form>
    </li>
  );
}

export function NotificationSettingsForm({
  locale,
  settings,
  teams,
  competitions,
  matchAlerts,
  sections,
  messages,
  caps,
}: {
  locale: string;
  settings: NotificationSettings;
  /** Resolved on the server for the reader's locale (T-1040): `NOTIFICATION_SETTINGS_KEYS`. */
  messages: NotificationSettingsMessages;
  /** Each capped kind's "at most N an hour", resolved as a plural on the server. */
  caps: Partial<Record<NotificationKind, Message>>;
  /** The match-alert section, rendered on the server with its catalogue words (T-831). */
  matchAlerts?: ReactNode;
  /** The other sections of their own, rendered on the server the same way (T-832). */
  sections?: ReactNode;
  /** What can be silenced; `null` when the list could not be loaded, which the section says. */
  teams: { id: string; name: string }[] | null;
  competitions: { id: string; name: string }[] | null;
}) {
  const [quietState, quietAction, quietPending] = useActionState(
    setQuietHoursAction.bind(null, locale),
    null,
  );

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">
          <MessageText message={messages['alerts.whatArrives']} />
        </h2>
        <ul className="flex flex-col" data-testid="notification-kinds">
          {settings.preferences.filter(isListedHere).map((preference) => (
            <KindRow
              key={preference.kind}
              locale={locale}
              kind={preference.kind}
              label={<MessageText message={messages[KIND_LABEL[preference.kind]]} />}
              inProduct={preference.in_product}
              chosen={preference.chosen}
              cap={caps[preference.kind]}
            />
          ))}
        </ul>
      </section>

      {matchAlerts}

      {sections}

      <section className="flex flex-col gap-3" data-testid="notification-mutes">
        <h2 className="text-lg font-semibold">
          <MessageText message={messages['alerts.whatStaysQuiet']} />
        </h2>
        <p className="text-sm text-muted">
          <MessageText message={messages['alerts.quietIntro']} />
        </p>
        {settings.mutes.length === 0 ? (
          <p className="text-sm text-muted" data-testid="no-mutes">
            <MessageText message={messages['alerts.nothingSilenced']} />
          </p>
        ) : (
          <ul className="flex flex-col">
            {settings.mutes.map((mute) => (
              <MuteRow
                key={`${mute.scope}:${mute.target}`}
                locale={locale}
                mute={mute}
                messages={messages}
              />
            ))}
          </ul>
        )}
        {teams === null ? (
          <p role="status" className="text-sm text-muted">
            <MessageText message={messages['alerts.teamsUnavailable']} />
          </p>
        ) : (
          <MuteForm
            locale={locale}
            scope="team"
            label={messages['alerts.silenceTeam']}
            messages={messages}
            options={teams.map((t) => ({ value: t.id, label: t.name }))}
          />
        )}
        {competitions === null ? (
          <p role="status" className="text-sm text-muted">
            <MessageText message={messages['alerts.competitionsUnavailable']} />
          </p>
        ) : (
          <MuteForm
            locale={locale}
            scope="competition"
            label={messages['alerts.silenceCompetition']}
            messages={messages}
            options={competitions.map((c) => ({ value: c.id, label: c.name }))}
          />
        )}
        <MuteForm
          locale={locale}
          scope="category"
          label={messages['alerts.silenceCategory']}
          messages={messages}
          options={NOTIFICATION_CATEGORIES.map((c) => ({
            value: c,
            label: messages[CATEGORY_LABEL[c]].text,
          }))}
        />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">
          <MessageText message={messages['alerts.quietHours']} />
        </h2>
        <p className="text-sm text-muted" data-testid="quiet-hours-explainer">
          {/* The zone is the member's own setting, filled into the sentence (`{timezone}`). */}
          <MessageText
            message={{
              ...messages['alerts.quietExplainer'],
              text: messages['alerts.quietExplainer'].text.replace('{timezone}', settings.timezone),
            }}
          />
        </p>
        <form action={quietAction} className="flex flex-wrap items-end gap-3">
          <TextField
            label={<MessageText message={messages['news.filter.from']} />}
            type="time"
            name="starts_at"
            size="sm"
            defaultValue={settings.quiet_hours?.starts_at ?? ''}
          />
          <TextField
            label={<MessageText message={messages['alerts.until']} />}
            type="time"
            name="ends_at"
            size="sm"
            defaultValue={settings.quiet_hours?.ends_at ?? ''}
          />
          <Button type="submit" pending={quietPending} data-testid="quiet-hours-save">
            <MessageText message={messages['alerts.save']} />
          </Button>
          {/* Cleared by submitting both fields empty, rather than by a second
              button that would be a second thing to explain. */}
          <span className="text-xs text-muted">
            <MessageText message={messages['alerts.clearHint']} />
          </span>
        </form>
        {quietState !== null && (
          <FormStatus ok={quietState.ok} data-testid="quiet-hours-result">
            {quietState.message}
          </FormStatus>
        )}
      </section>
    </div>
  );
}
