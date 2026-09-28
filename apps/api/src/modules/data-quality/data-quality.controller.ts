import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { ApiError, DataQualityReport } from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { DataQualityService } from './data-quality.service';

const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const NOT_ADMIN: ApiError = {
  error: 'unauthenticated',
  message: 'The administration area needs the admin role.',
};
const MAX_REASON = 500;

/**
 * The data-quality findings for administrators (T-821): `GET
 * /admin/data-quality` (each check's newest run, open findings per
 * competition and check, the open findings themselves) and `POST
 * /admin/data-quality/:id/review` (marks one reviewed, with a reason and an
 * audit row). Admin role only. Reviewing corrects nothing: the finding stays
 * open until the data stops contradicting itself, and the watchdog stops
 * counting it.
 */
@Controller('admin/data-quality')
export class DataQualityController {
  constructor(
    private readonly dataQuality: DataQualityService,
    private readonly identity: IdentityService,
  ) {}

  private async admin(request: FastifyRequest): Promise<string> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    if (!(await this.identity.hasRole(user.id, 'admin'))) throw new ForbiddenException(NOT_ADMIN);
    return user.id;
  }

  @Get()
  async report(@Req() request: FastifyRequest): Promise<DataQualityReport> {
    await this.admin(request);
    return this.dataQuality.report(new Date());
  }

  @Post(':id/review')
  @HttpCode(200)
  async review(
    @Param('id') rawId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<{ reviewed: true }> {
    const actor = await this.admin(request);
    const id = /^[1-9][0-9]{0,15}$/.test(rawId) ? Number(rawId) : null;
    const raw = (body as { reason?: unknown } | null)?.reason;
    const reason = typeof raw === 'string' ? raw.trim() : '';
    if (id === null || reason === '' || reason.length > MAX_REASON) {
      const error: ApiError = {
        error: 'validation',
        message: 'The request is not valid.',
        fields: {
          ...(id === null ? { id: 'A finding id.' } : {}),
          ...(reason === '' || reason.length > MAX_REASON
            ? { reason: `Say why, in at most ${MAX_REASON} characters. This is recorded.` }
            : {}),
        },
      };
      throw new BadRequestException(error);
    }
    const outcome = await this.dataQuality.review(id, actor, reason, new Date());
    if (outcome === 'not_found') {
      throw new NotFoundException({
        error: 'not_found',
        message: 'No open finding has that id; it may have resolved.',
      } satisfies ApiError);
    }
    if (outcome === 'already_reviewed') {
      throw new ConflictException({
        error: 'conflict',
        message: 'This finding has already been reviewed.',
      } satisfies ApiError);
    }
    return { reviewed: true };
  }
}
