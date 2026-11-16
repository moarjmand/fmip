import {
  Controller,
  Get,
  Header,
  Inject,
  Injectable,
  NotFoundException,
  Param,
} from '@nestjs/common';
import type {
  ApiError,
  SocialCardGoal,
  SocialCardModel,
  SocialCardPayload,
  SocialCardResponse,
  SocialCardTeam,
} from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../database/database.module';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_CARD: ApiError = { error: 'not_found', message: 'No such card.' };

/**
 * The states whose card is never drawn (D-427 point 11): a post a person
 * rejected, whose validity ended or whose forecast changed will never be
 * published, so its picture is not served either.
 */
export const CARDLESS_STATES = ['rejected', 'expired', 'superseded'] as const;

type Row = Record<string, unknown>;
const pair = (v: unknown) => {
  const p = v as { home: number; away: number };
  return { home: p.home, away: p.away };
};
const shares = (v: unknown) => {
  const p = v as { home: number; draw: number; away: number };
  return { home: p.home, draw: p.draw, away: p.away };
};
const orNull = <T>(v: unknown, map: (v: unknown) => T): T | null =>
  v === null || v === undefined ? null : map(v);

function cardTeam(v: unknown): SocialCardTeam {
  const t = v as Row;
  return {
    id: t['id'] as string,
    name: t['name'] as string,
    short_name: (t['short_name'] ?? null) as string | null,
    code: (t['code'] ?? null) as string | null,
  };
}

function cardModel(v: unknown): SocialCardModel {
  const m = v as Row;
  return {
    name: m['name'] as SocialCardModel['name'],
    version: m['version'] as string,
    forecast_id: m['forecast_id'] as string,
    computed_at: m['computed_at'] as string,
  };
}

function cardGoal(v: unknown): SocialCardGoal {
  const g = v as Row;
  return {
    side: g['side'] as SocialCardGoal['side'],
    player: g['player'] as string,
    minute: g['minute'] as number,
    added: (g['added'] ?? null) as number | null,
    kind: g['kind'] as SocialCardGoal['kind'],
  };
}

/**
 * Only what a card draws, field by field and by kind (review of PR 894): a
 * key the drafting adds to the stored payload later never becomes public
 * through this read without passing here first.
 */
export function cardPayload(stored: Row): SocialCardPayload {
  const competition = stored['competition'] as Row;
  const base = {
    fixture_id: stored['fixture_id'] as string,
    competition: { id: competition['id'] as string, name: competition['name'] as string },
    round: (stored['round'] ?? null) as string | null,
    kick_off: stored['kick_off'] as string,
    home: cardTeam(stored['home']),
    away: cardTeam(stored['away']),
  };
  switch (stored['kind']) {
    case 'forecast_pre_match':
      return {
        ...base,
        kind: 'forecast_pre_match',
        model: cardModel(stored['model']),
        percent: shares(stored['percent']),
      };
    case 'model_verdict':
      return {
        ...base,
        kind: 'model_verdict',
        model: cardModel(stored['model']),
        score: pair(stored['score']),
        after_extra_time: stored['after_extra_time'] === true,
        called: stored['called'] as 'home' | 'draw' | 'away',
        called_percent: stored['called_percent'] as number,
        percent: orNull(stored['percent'], shares),
        correct: stored['correct'] === true,
      };
    case 'result':
      return {
        ...base,
        kind: 'result',
        score: pair(stored['score']),
        after_extra_time: stored['after_extra_time'] === true,
        penalties: orNull(stored['penalties'], pair),
        half_time: orNull(stored['half_time'], pair),
        goals: orNull(stored['goals'], (g) => (g as unknown[]).map(cardGoal)),
      };
    default:
      throw new Error(`Unknown card kind: ${String(stored['kind'])}`);
  }
}

/**
 * A post's frozen card payload, read by its random id (T-1835). Only the
 * payload, which the trigger never lets change, and only for a post that may
 * still be, or has been, published. Reads `social_post` alone.
 */
@Injectable()
export class SocialCardStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async card(id: string): Promise<SocialCardResponse | null> {
    const { rows } = await this.pool.query<{ id: string; state: string; payload: Row }>(
      `SELECT id, state, payload FROM social_post WHERE id = $1 AND state <> ALL($2::text[])`,
      [id, [...CARDLESS_STATES]],
    );
    const row = rows[0];
    if (row === undefined) return null;
    return { id: row.id, published: row.state === 'published', payload: cardPayload(row.payload) };
  }
}

@Controller()
export class SocialCardController {
  constructor(private readonly store: SocialCardStore) {}

  /**
   * `GET /social-posts/:id/card` (T-1835, D-427 point 11): the payload the web
   * draws the 1080 x 1350 card from, and whether the post is published (only
   * then may the picture be kept for good). Public by the post's random UUID,
   * so the publisher can fetch the picture; 404, the same answer, for an id
   * that is not a UUID, unknown, `rejected`, `expired` or `superseded`.
   * Never indexed.
   */
  @Get('social-posts/:id/card')
  @Header('X-Robots-Tag', 'noindex')
  @Header('Cache-Control', 'no-store')
  async card(@Param('id') id: string): Promise<SocialCardResponse> {
    if (!UUID.test(id)) throw new NotFoundException(NO_CARD);
    const card = await this.store.card(id.toLowerCase());
    if (card === null) throw new NotFoundException(NO_CARD);
    return card;
  }
}
