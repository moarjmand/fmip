import type { Message } from '@/i18n/messages';

/**
 * The words the notification pages' client components render (T-1305).
 *
 * The inbox, the settings form, a kind's switch and the push toggle are client
 * components, so the catalogues cannot reach them (T-1040): the server page
 * resolves these keys for the reader's locale (`resolveMessages`) and hands
 * the result down. The lists live here, in a plain module, because a value
 * exported from a `'use client'` file reaches a server component as a client
 * reference rather than as the array.
 */

export const NOTIFICATION_LIST_KEYS = [
  'notificationsPage.unreachable',
  'notificationsPage.empty',
  'notificationsPage.markRead',
  'notificationsPage.held',
] as const;

export type NotificationListMessages = Record<(typeof NOTIFICATION_LIST_KEYS)[number], Message>;

/** A kind's switch, wherever it is drawn: the general list, the match alerts, the sections. */
export const KIND_ROW_KEYS = [
  'alerts.yourChoice',
  'alerts.default',
  'alerts.on',
  'alerts.off',
] as const;

export const NOTIFICATION_SETTINGS_KEYS = [
  'alerts.kind.predictionSettled',
  'alerts.kind.ratingChanged',
  'alerts.kind.careerPointsAwarded',
  'alerts.kind.achievementUnlocked',
  'alerts.kind.friendRequest',
  'alerts.kind.friendAccepted',
  'alerts.kind.messageReceived',
  'alerts.kind.mentioned',
  'alerts.kind.groupInvite',
  'alerts.kind.groupJoinRequest',
  'alerts.kind.moderationDecision',
  'alerts.kind.contributorGranted',
  'alerts.kind.contributorGrantChanged',
  'alerts.kind.panelReaction',
  'alerts.kind.briefing',
  'alerts.kind.campaign',
  'alerts.kind.breakingNews',
  'alerts.kind.transferNews',
  'alerts.kind.availabilityNews',
  'alerts.kind.systemAlert',
  'alerts.kind.contributorBelowThreshold',
  'alerts.category.football',
  'alerts.category.social',
  'alerts.category.account',
  'alerts.category.match',
  'alerts.mute.team',
  'alerts.mute.competition',
  'alerts.mute.category',
  'alerts.unmute',
  'alerts.choose',
  'alerts.silence',
  'alerts.done',
  'alerts.whatArrives',
  'alerts.whatStaysQuiet',
  'alerts.quietIntro',
  'alerts.nothingSilenced',
  'alerts.teamsUnavailable',
  'alerts.competitionsUnavailable',
  'alerts.silenceTeam',
  'alerts.silenceCompetition',
  'alerts.silenceCategory',
  'alerts.quietHours',
  'alerts.quietExplainer',
  'news.filter.from',
  'alerts.until',
  'alerts.save',
  'alerts.clearHint',
] as const;

export type NotificationSettingsMessages = Record<
  (typeof NOTIFICATION_SETTINGS_KEYS)[number],
  Message
>;

export const PUSH_TOGGLE_KEYS = [
  'alerts.push.absent',
  'alerts.push.absentEmail',
  'alerts.push.intro',
  'alerts.push.noDevice',
  'alerts.push.unsupported',
  'alerts.push.denied',
  'alerts.push.notRegistered',
  'alerts.push.isOn',
  'alerts.push.couldNotOn',
  'alerts.push.isOff',
  'alerts.push.couldNotOff',
  'alerts.push.turnOff',
  'alerts.push.turnOn',
] as const;

export type PushToggleMessages = Record<(typeof PUSH_TOGGLE_KEYS)[number], Message>;
