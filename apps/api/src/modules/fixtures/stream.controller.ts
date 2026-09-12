import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { ApiError, LiveHealth } from '@fmip/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { FixturesService, parseScoresQuery } from './fixtures.service';
import { FixtureChangeFeed, type FixtureChange } from './internal/change-feed';
import { SSE_HEADERS, SSE_PING, debounce, sseEvent } from './internal/sse';

/** Tunables the tests shorten; production takes the defaults. */
export const STREAM_OPTIONS = Symbol('STREAM_OPTIONS');
export interface StreamOptions {
  /** How long a burst of changes is collapsed before one snapshot goes out. */
  debounceMs: number;
  /** How often a heartbeat (the current time) is sent so the client can judge staleness. */
  heartbeatMs: number;
}
export const DEFAULT_STREAM_OPTIONS: StreamOptions = { debounceMs: 300, heartbeatMs: 15_000 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The SSE gateway (T-032). Two streams, one rule: the first event on every
 * connection is a full `snapshot`, so a client that reconnects never keeps
 * an old picture; changes arrive as new snapshots (debounced), and a
 * `heartbeat` every few seconds carries the server time so the page can say
 * how old what it shows is. If the change feed breaks, a `stale` event says
 * so instead of the stream going quiet.
 */
@Controller()
export class StreamController {
  constructor(
    private readonly fixtures: FixturesService,
    private readonly identity: IdentityService,
    private readonly feed: FixtureChangeFeed,
    @Inject(STREAM_OPTIONS) private readonly options: StreamOptions,
  ) {}

  /** `GET /health/live` (T-071): the live path's gateway in numbers. Public and read-only. */
  @Get('health/live')
  live(): LiveHealth {
    return { checked_at: new Date().toISOString(), stream_subscribers: this.feed.subscribers };
  }

  @Get('scores/stream')
  async scores(
    @Query() query: unknown,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const parsed = parseScoresQuery(isRecord(query) ? query : {});
    if (!parsed.ok) {
      const error: ApiError = {
        error: 'validation',
        message: 'The request is not valid.',
        fields: parsed.fields,
      };
      throw new BadRequestException(error);
    }
    const viewer = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    const viewerId = viewer?.id ?? null;
    if (parsed.filters.favourites && viewerId === null) {
      const error: ApiError = {
        error: 'unauthenticated',
        message: 'Sign in to filter by your favourites.',
      };
      throw new UnauthorizedException(error);
    }

    await this.serve(request, reply, {
      snapshot: async () => {
        const outcome = await this.fixtures.scores(parsed.filters, viewerId);
        return outcome.kind === 'ok' ? outcome.response : null;
      },
      // Every change may move a fixture into or out of the day, so all count.
      concerns: () => true,
    });
  }

  @Get('fixtures/:fixtureId/stream')
  async fixture(
    @Req() request: FastifyRequest<{ Params: { fixtureId: string } }>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const fixtureId = request.params.fixtureId.toLowerCase();
    if (!UUID.test(fixtureId)) {
      const error: ApiError = { error: 'not_found', message: 'No such fixture.' };
      throw new NotFoundException(error);
    }
    const first = await this.fixtures.matchCentre(fixtureId);
    if (first === null) {
      const error: ApiError = { error: 'not_found', message: 'No such fixture.' };
      throw new NotFoundException(error);
    }
    await this.serve(request, reply, {
      snapshot: () => this.fixtures.matchCentre(fixtureId),
      concerns: (change) => change.fixtureId === fixtureId,
      initial: first,
    });
  }

  private async serve<
    T extends { generated_at?: string } | { fixture: { last_updated_at: string } },
  >(
    request: FastifyRequest,
    reply: FastifyReply,
    source: {
      snapshot: () => Promise<T | null>;
      concerns: (change: FixtureChange) => boolean;
      initial?: T;
    },
  ): Promise<void> {
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, SSE_HEADERS);
    raw.write(SSE_PING);

    let open = true;
    const write = (chunk: string): void => {
      if (open) raw.write(chunk);
    };
    const send = async (): Promise<void> => {
      const data = await source.snapshot();
      if (data === null) {
        write(sseEvent('stale', { reason: 'gone', at: new Date().toISOString() }));
        return;
      }
      write(sseEvent('snapshot', data, new Date().toISOString()));
    };

    const refresh = debounce(this.options.debounceMs, () => {
      void send().catch((error: unknown) => {
        write(
          sseEvent('stale', {
            reason: 'snapshot_failed',
            detail: error instanceof Error ? error.message : String(error),
            at: new Date().toISOString(),
          }),
        );
      });
    });

    const heartbeat = setInterval(() => {
      write(sseEvent('heartbeat', { at: new Date().toISOString() }));
    }, this.options.heartbeatMs);

    const unsubscribe = await this.feed.subscribe(
      (change) => {
        if (source.concerns(change)) refresh.trigger();
      },
      (error) => {
        write(
          sseEvent('stale', {
            reason: 'feed_lost',
            detail: error.message,
            at: new Date().toISOString(),
          }),
        );
      },
    );

    const close = (): void => {
      if (!open) return;
      open = false;
      clearInterval(heartbeat);
      refresh.cancel();
      unsubscribe();
      raw.end();
    };
    // The *response*'s close, not the request's: since Node 16 a request
    // emits 'close' as soon as its (empty) body has been read, which for a
    // GET is immediately. The response closes with the connection.
    raw.on('close', close);
    raw.on('error', close);

    if (source.initial !== undefined) {
      write(sseEvent('snapshot', source.initial, new Date().toISOString()));
    } else {
      await send();
    }
  }
}
