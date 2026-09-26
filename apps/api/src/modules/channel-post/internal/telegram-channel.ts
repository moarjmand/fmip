import { ChannelRefusal, type ChannelPublisher } from '../channel-post.port';

/**
 * The Telegram adapter behind the channel port (T-525): the Bot API's
 * `sendMessage`, over `fetch`, with no dependency. The only file in the
 * product that knows the channel is Telegram.
 *
 * Plain text, no markup: Telegram turns every address into a link by itself,
 * and text that is never parsed cannot be broken by a team name holding a
 * character the markup reserves. Link previews are off, because a post
 * listing a day's matches with the picture of the first one reads as a post
 * about that match.
 */

export interface TelegramSettings {
  /** The bot's token from @BotFather. A secret: never logged, never in an error. */
  token: string;
  /** `@channelname`, or the channel's numeric id. */
  chat: string;
}

/** Every request gives up after this long; a sender with no timeout was a defect once (T-330). */
export const TELEGRAM_TIMEOUT_MS = 10_000;

const API = 'https://api.telegram.org';

/** `<digits>:<secret>`, the shape @BotFather issues. Checked so a pasted fragment refuses at boot. */
const TOKEN = /^\d+:[A-Za-z0-9_-]{20,}$/;
/** A public channel's username (5-32 letters, digits, underscores), or a numeric id. */
const USERNAME = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;
const NUMERIC = /^-?\d+$/;

/**
 * `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHANNEL`, or null when both are empty.
 * One without the other, or either in a shape Telegram never issues, stops
 * the API at boot with the variable named and the token's value never shown.
 */
export function telegramSettingsFromEnv(env: NodeJS.ProcessEnv): TelegramSettings | null {
  const token = (env.TELEGRAM_BOT_TOKEN ?? '').trim();
  const channel = (env.TELEGRAM_CHANNEL ?? '').trim();
  if (token === '' && channel === '') return null;
  if (token === '') {
    throw new Error('TELEGRAM_CHANNEL is set but TELEGRAM_BOT_TOKEN is empty; set both or neither');
  }
  if (channel === '') {
    throw new Error('TELEGRAM_BOT_TOKEN is set but TELEGRAM_CHANNEL is empty; set both or neither');
  }
  if (!TOKEN.test(token)) {
    throw new Error(
      'TELEGRAM_BOT_TOKEN is not in the shape @BotFather issues (<digits>:<secret>); check it was pasted whole',
    );
  }
  const name = channel.startsWith('@') ? channel.slice(1) : channel;
  if (NUMERIC.test(channel)) return { token, chat: channel };
  if (!USERNAME.test(name)) {
    throw new Error(
      `TELEGRAM_CHANNEL=${channel} is neither a channel username (@name) nor a numeric id`,
    );
  }
  return { token, chat: `@${name}` };
}

interface BotAnswer {
  ok?: boolean;
  description?: string;
}

export class TelegramChannel implements ChannelPublisher {
  readonly provider = 'telegram';

  constructor(
    private readonly settings: TelegramSettings,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = TELEGRAM_TIMEOUT_MS,
  ) {}

  async post(text: string): Promise<void> {
    let response: Response;
    let answer: BotAnswer | null;
    try {
      response = await this.fetchImpl(`${API}/bot${this.settings.token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.settings.chat,
          text,
          link_preview_options: { is_disabled: true },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      answer = (await response.json().catch(() => null)) as BotAnswer | null;
    } catch (error) {
      // The address carries the token, so nothing from the error is passed on
      // unread: only its name and the reason, with the token scrubbed if some
      // layer below ever put the address in a message.
      throw new Error(`telegram unreachable: ${this.scrub(describe(error))}`);
    }
    if (response.ok && answer?.ok === true) return;
    const reason = this.scrub(answer?.description ?? 'no description');
    // A 4xx is Telegram saying no and posting nothing; a 5xx could be a proxy
    // that lost an answer after the message went out, so it is not a refusal.
    if (response.status >= 400 && response.status < 500) {
      throw new ChannelRefusal(`telegram refused (${response.status}): ${reason}`);
    }
    throw new Error(`telegram answered ${response.status}: ${reason}`);
  }

  private scrub(text: string): string {
    return text.split(this.settings.token).join('<token>');
  }
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as { cause?: unknown }).cause;
  const code =
    cause !== null && typeof cause === 'object' && 'code' in cause
      ? ` (${String(cause.code)})`
      : '';
  return `${error.name}: ${error.message}${code}`;
}
