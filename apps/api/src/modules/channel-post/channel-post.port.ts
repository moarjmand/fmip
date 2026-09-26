import { TelegramChannel, telegramSettingsFromEnv } from './internal/telegram-channel';

/**
 * A public channel the product posts to (T-525), behind one port.
 *
 * The rest of the module knows a channel takes plain text, in order, one
 * message at a time, and nothing about who runs it: the provider is an
 * adapter in `internal/`, chosen by what the deployment configured. With
 * nothing configured the port is `null` -- the honest absence of T-330 --
 * and nothing is composed, claimed or sent.
 */
export interface ChannelPublisher {
  readonly provider: string;
  /** Posts one message. Throws `ChannelRefusal` when the channel answered and posted nothing. */
  post(text: string): Promise<void>;
}

/**
 * The channel answered and did not post: a bot that is not an administrator,
 * a channel that does not exist, a rate limit. Distinct from every other
 * failure because it is the one after which trying again cannot post a
 * message twice; a timeout says nothing about whether the message went out.
 */
export class ChannelRefusal extends Error {}

/** The hour (UTC) from which the day's post goes out when nothing else is said. */
export const DEFAULT_POST_HOUR = 6;

/**
 * The channel a deployment configured, or null. Off while both values are
 * empty. One without the other **refuses to start**, naming the missing
 * variable: a token pasted in with the channel forgotten would otherwise look
 * exactly like a channel nobody configured, and nobody would be told.
 */
export function channelFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): ChannelPublisher | null {
  const settings = telegramSettingsFromEnv(env);
  return settings === null ? null : new TelegramChannel(settings, fetchImpl);
}

/** `CHANNEL_POST_HOUR`: a whole hour 0-23, or the default when empty; anything else refuses to start. */
export function postHourFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = (env.CHANNEL_POST_HOUR ?? '').trim();
  if (raw === '') return DEFAULT_POST_HOUR;
  if (!/^\d{1,2}$/.test(raw) || Number(raw) > 23) {
    throw new Error(
      `CHANNEL_POST_HOUR=${raw} is not an hour; use a whole number from 0 to 23 (UTC)`,
    );
  }
  return Number(raw);
}

/** Everything the daily post reads from the deployment, read once at boot. */
export interface ChannelPostConfig {
  /** Null: no channel configured, and nothing is posted. */
  publisher: ChannelPublisher | null;
  /** The hour (UTC) from which the day's post goes out. */
  postHour: number;
  /** The public site the post links to: `WEB_BASE_URL`, as in the e-mails' links. */
  origin: string;
}

export const CHANNEL_POST_CONFIG = Symbol('CHANNEL_POST_CONFIG');

export function channelPostConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ChannelPostConfig {
  const origin = env.WEB_BASE_URL ?? 'http://localhost:3000';
  return {
    publisher: channelFromEnv(env),
    postHour: postHourFromEnv(env),
    origin: origin.replace(/\/+$/, ''),
  };
}
