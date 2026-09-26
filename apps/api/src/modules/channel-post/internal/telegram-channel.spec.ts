import { describe, expect, it } from 'vitest';
import { ChannelRefusal } from '../channel-post.port';
import { TELEGRAM_TIMEOUT_MS, TelegramChannel, telegramSettingsFromEnv } from './telegram-channel';

// Obviously not a token: the right shape, and nothing Telegram ever issued.
const FAKE_TOKEN = `123456:${'x'.repeat(35)}`;

interface Sent {
  url: string;
  init: RequestInit;
}

function fakeFetch(answer: () => Promise<Response> | Response): {
  fetchImpl: typeof fetch;
  sent: Sent[];
} {
  const sent: Sent[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} });
    return answer();
  }) as typeof fetch;
  return { fetchImpl, sent };
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('telegramSettingsFromEnv', () => {
  it('is off when neither value is set', () => {
    expect(telegramSettingsFromEnv({})).toBeNull();
    expect(telegramSettingsFromEnv({ TELEGRAM_BOT_TOKEN: ' ', TELEGRAM_CHANNEL: '' })).toBeNull();
  });

  it('refuses half a configuration, naming the missing variable and never the token', () => {
    expect(() => telegramSettingsFromEnv({ TELEGRAM_BOT_TOKEN: FAKE_TOKEN })).toThrow(
      /TELEGRAM_CHANNEL is empty/,
    );
    expect(() => telegramSettingsFromEnv({ TELEGRAM_CHANNEL: '@fmip_daily' })).toThrow(
      /TELEGRAM_BOT_TOKEN is empty/,
    );
    try {
      telegramSettingsFromEnv({ TELEGRAM_BOT_TOKEN: FAKE_TOKEN });
    } catch (error) {
      expect((error as Error).message).not.toContain(FAKE_TOKEN);
    }
  });

  it('refuses a token in a shape @BotFather never issues, without repeating it', () => {
    const fragment = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxx';
    expect(() =>
      telegramSettingsFromEnv({ TELEGRAM_BOT_TOKEN: fragment, TELEGRAM_CHANNEL: '@fmip_daily' }),
    ).toThrow(/not in the shape/);
    try {
      telegramSettingsFromEnv({ TELEGRAM_BOT_TOKEN: fragment, TELEGRAM_CHANNEL: '@fmip_daily' });
    } catch (error) {
      expect((error as Error).message).not.toContain(fragment);
    }
  });

  it('takes a channel as @name, as a bare name, or as a numeric id', () => {
    const env = (channel: string) => ({
      TELEGRAM_BOT_TOKEN: FAKE_TOKEN,
      TELEGRAM_CHANNEL: channel,
    });
    expect(telegramSettingsFromEnv(env('@fmip_daily'))?.chat).toBe('@fmip_daily');
    expect(telegramSettingsFromEnv(env('fmip_daily'))?.chat).toBe('@fmip_daily');
    expect(telegramSettingsFromEnv(env('-1001234567890'))?.chat).toBe('-1001234567890');
    expect(() => telegramSettingsFromEnv(env('https://t.me/fmip_daily'))).toThrow(
      /neither a channel username/,
    );
    expect(() => telegramSettingsFromEnv(env('@abc'))).toThrow(/neither a channel username/);
  });
});

describe('TelegramChannel', () => {
  const settings = { token: FAKE_TOKEN, chat: '@fmip_daily' };

  it('sends plain text to the channel with previews off and a timeout on the request', async () => {
    const { fetchImpl, sent } = fakeFetch(() => json(200, { ok: true, result: {} }));
    await new TelegramChannel(settings, fetchImpl).post('hello');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(`https://api.telegram.org/bot${FAKE_TOKEN}/sendMessage`);
    expect(sent[0]?.init.method).toBe('POST');
    expect(sent[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(sent[0]?.init.body))).toEqual({
      chat_id: '@fmip_daily',
      text: 'hello',
      link_preview_options: { is_disabled: true },
    });
    expect(TELEGRAM_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('turns a 4xx into a refusal: Telegram answered and posted nothing', async () => {
    const { fetchImpl } = fakeFetch(() =>
      json(403, { ok: false, description: 'Forbidden: bot is not a member of the channel chat' }),
    );
    const posting = new TelegramChannel(settings, fetchImpl).post('hello');
    await expect(posting).rejects.toBeInstanceOf(ChannelRefusal);
    await expect(new TelegramChannel(settings, fetchImpl).post('hello')).rejects.toThrow(
      /telegram refused \(403\): Forbidden: bot is not a member/,
    );
  });

  it('does not call a 5xx a refusal: the message may have gone out', async () => {
    const { fetchImpl } = fakeFetch(() => json(502, { ok: false, description: 'Bad Gateway' }));
    const error = await new TelegramChannel(settings, fetchImpl).post('hello').catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ChannelRefusal);
    expect((error as Error).message).toBe('telegram answered 502: Bad Gateway');
  });

  it('gives up after its timeout, and never puts the token in the error', async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new Error(`request to https://api.telegram.org/bot${FAKE_TOKEN}/x aborted`)),
        );
      })) as typeof fetch;
    const error = await new TelegramChannel(settings, fetchImpl, 20).post('hello').catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ChannelRefusal);
    expect((error as Error).message).toMatch(/^telegram unreachable: /);
    expect((error as Error).message).not.toContain(FAKE_TOKEN);
  });
});
