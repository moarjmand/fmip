import { BadRequestException, Controller, Get, Query, Req, Res } from '@nestjs/common';
import type { ApiError, AskResponse } from '@fmip/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  IdentityService,
  SESSION_COOKIE,
  clientIpOf,
  parseCookies,
} from '../identity/identity.service';
import { RateLimitsService, refuseOverRate } from '../rate-limits/rate-limits.service';
import { AskService } from './ask.service';

const MIN_LENGTH = 2;
const MAX_LENGTH = 200;

/** The sentence a refusal starts with, per whose ceiling it is; `refuseOverRate` adds the wait. */
export const ASK_REFUSAL = {
  member: 'You have asked a lot of questions in the last hour.',
  address: 'A lot of questions have been asked from your network in the last hour.',
} as const;

/**
 * `GET /ask?q=` (T-421): a question, read by the model when there is one,
 * answered by the search. Public.
 *
 * Every question is a model call from the plan the briefing, the moderation
 * assistant and the match summaries share, so it is limited before the call
 * (T-838, D-103's gap): a member per account (`ask`, in `rate_window`), a
 * guest per address as the web app forwards it (`ask_ip`, in
 * `auth_rate_window` under the address's HMAC, D-093). Past either ceiling
 * the answer is 429 with `Retry-After` and the model is not called. A guest
 * whose address the web app did not forward is not limited, as on the
 * account forms; a deployment with no model is keyword search and is not
 * limited either.
 */
@Controller()
export class AskController {
  constructor(
    private readonly ask: AskService,
    private readonly identity: IdentityService,
    private readonly limits: RateLimitsService,
  ) {}

  @Get('ask')
  async find(
    @Query('q') q: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AskResponse> {
    const question = typeof q === 'string' ? q.trim() : '';
    if (question.length < MIN_LENGTH || question.length > MAX_LENGTH) {
      throw new BadRequestException({
        error: 'validation',
        message: `q must be between ${MIN_LENGTH} and ${MAX_LENGTH} characters.`,
      } satisfies ApiError);
    }
    if (this.ask.usesModel()) {
      const member = await this.identity.authenticate(
        parseCookies(request.headers.cookie)[SESSION_COOKIE],
      );
      const taken =
        member !== null
          ? await this.limits.take(member.id, 'ask')
          : await this.identity.takeForAddress(clientIpOf(request.headers), 'ask_ip');
      if (!taken.ok) {
        refuseOverRate(reply, taken, ASK_REFUSAL[member !== null ? 'member' : 'address']);
      }
    }
    return this.ask.ask(question);
  }
}
