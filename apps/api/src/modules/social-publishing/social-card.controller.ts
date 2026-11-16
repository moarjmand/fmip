import {
  Controller,
  Get,
  Header,
  Inject,
  Injectable,
  NotFoundException,
  Param,
} from '@nestjs/common';
import type { ApiError, SocialCardPayload, SocialCardResponse } from '@fmip/contracts';
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

/**
 * A post's frozen card payload, read by its random id (T-1835). Only the
 * payload, which the trigger never lets change, and only for a post that may
 * still be, or has been, published. Reads `social_post` alone.
 */
@Injectable()
export class SocialCardStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async card(id: string): Promise<SocialCardResponse | null> {
    const { rows } = await this.pool.query<{ id: string; payload: SocialCardPayload }>(
      `SELECT id, payload FROM social_post WHERE id = $1 AND state <> ALL($2::text[])`,
      [id, [...CARDLESS_STATES]],
    );
    const row = rows[0];
    return row === undefined ? null : { id: row.id, payload: row.payload };
  }
}

@Controller()
export class SocialCardController {
  constructor(private readonly store: SocialCardStore) {}

  /**
   * `GET /social-posts/:id/card` (T-1835, D-427 point 11): the payload the web
   * draws the 1080 x 1350 card from. Public by the post's random UUID, so the
   * publisher can fetch the picture; 404, the same answer, for an id that is
   * not a UUID, unknown, `rejected`, `expired` or `superseded`. Never indexed.
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
