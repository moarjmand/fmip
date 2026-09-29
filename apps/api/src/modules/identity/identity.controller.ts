import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { ApiError, DataExport, SessionResponse } from '@fmip/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  IdentityService,
  type Limited,
  SESSION_COOKIE,
  clientIpOf,
  parseCookies,
  refusalMessage,
} from './identity.service';
import {
  type Validated,
  validateDataExport,
  validateDeleteAccount,
  validateForgotPassword,
  validateLogin,
  validateRegister,
  validateResetPassword,
  validateToken,
} from './internal/validation';

function unwrap<T>(validated: Validated<T>): T {
  if (validated.ok) return validated.value;

  const body: ApiError = {
    error: 'validation',
    message: 'The request is not valid.',
    fields: validated.fields,
  };
  throw new BadRequestException(body);
}

function sessionTokenOf(request: FastifyRequest): string | undefined {
  return parseCookies(request.headers.cookie)[SESSION_COOKIE];
}

function userAgentOf(request: FastifyRequest): string | null {
  const value = request.headers['user-agent'];
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * A rate-limit refusal (T-810): 429, `Retry-After` in seconds, and a sentence
 * that says when to try again. It names no account, so it reads the same
 * whether or not the identifier typed belongs to one.
 */
function refuse(reply: FastifyReply, outcome: Limited): never {
  void reply.header('retry-after', String(outcome.retryAfterSeconds));
  const body: ApiError = {
    error: 'rate_limited',
    message: refusalMessage(outcome.retryAfterSeconds),
  };
  throw new HttpException(body, 429);
}

function isLimited(value: unknown): value is Limited {
  return typeof value === 'object' && value !== null && (value as Limited).kind === 'limited';
}

/** A second copy of one's data within a day (D-158): when the next is possible, in hours. */
export function nextCopyMessage(retryAfterSeconds: number): string {
  const hours = Math.max(1, Math.ceil(retryAfterSeconds / 3600));
  return `A copy of your data was made less than a day ago. The next one is possible in ${hours} ${hours === 1 ? 'hour' : 'hours'}.`;
}

const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const INVALID_TOKEN: ApiError = {
  error: 'invalid_token',
  message: 'This link is invalid, has expired, or was already used.',
};

/**
 * `/auth/*`. Bodies are validated by hand into the `@fmip/contracts` shapes;
 * the session travels only in the cookie. Every response body is a contract
 * type or an `ApiError`.
 */
@Controller('auth')
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Post('register')
  @HttpCode(201)
  async register(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponse> {
    const input = unwrap(validateRegister(body));
    const outcome = await this.identity.register(
      input,
      userAgentOf(request),
      clientIpOf(request.headers),
    );

    if (outcome.kind === 'limited') refuse(reply, outcome);
    if (outcome.kind === 'invalid') {
      const error: ApiError = {
        error: 'validation',
        message: 'The request is not valid.',
        fields: outcome.fields,
      };
      throw new BadRequestException(error);
    }
    if (outcome.kind === 'conflict') {
      const error: ApiError = {
        error: 'conflict',
        message: 'Already taken.',
        fields: outcome.fields,
      };
      throw new ConflictException(error);
    }

    void reply.header('set-cookie', this.identity.sessionCookie(outcome.sessionToken));
    return { user: outcome.user };
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponse> {
    const input = unwrap(validateLogin(body));
    // Whatever cookie arrived is not consulted: a login mints a fresh session.
    const login = await this.identity.login(
      input,
      userAgentOf(request),
      clientIpOf(request.headers),
    );

    if (login.kind === 'limited') refuse(reply, login);
    if (login.kind === 'refused') {
      const error: ApiError = {
        error: 'unauthenticated',
        message: 'The identifier or password is not right.',
      };
      throw new UnauthorizedException(error);
    }

    void reply.header('set-cookie', this.identity.sessionCookie(login.sessionToken));
    return { user: login.user };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.identity.logout(sessionTokenOf(request));
    void reply.header('set-cookie', this.identity.clearedSessionCookie());
  }

  @Get('me')
  async me(@Req() request: FastifyRequest): Promise<SessionResponse> {
    const user = await this.identity.authenticate(sessionTokenOf(request));
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    return { user };
  }

  /**
   * Delete my account (T-812, D-094). Needs the session, the password and the
   * username typed again; answers 204 and clears the cookie. A wrong password
   * or confirmation is a validation error on that field, so the form says
   * which one.
   */
  @Post('account/delete')
  @HttpCode(204)
  async deleteAccount(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const user = await this.identity.authenticate(sessionTokenOf(request));
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    const input = unwrap(validateDeleteAccount(body));

    const outcome = await this.identity.deleteAccount(user.id, input, clientIpOf(request.headers));
    if (isLimited(outcome)) refuse(reply, outcome);
    if (outcome === 'unknown') throw new UnauthorizedException(UNAUTHENTICATED);
    if (outcome !== 'deleted') {
      const error: ApiError = {
        error: 'validation',
        message: 'The account was not deleted.',
        fields:
          outcome === 'wrong_password'
            ? { password: 'is not right' }
            : { confirm: 'must be your username' },
      };
      throw new BadRequestException(error);
    }
    void reply.header('set-cookie', this.identity.clearedSessionCookie());
  }

  /**
   * Download a copy of my data (T-846, D-158). Needs the session and the
   * password; answers the file as an attachment, never cached. A second copy
   * within a day is 429 with `Retry-After`, like any other ceiling. Nothing is
   * e-mailed: the file goes to this session only.
   */
  @Post('account/export')
  @HttpCode(200)
  async exportData(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<DataExport> {
    const user = await this.identity.authenticate(sessionTokenOf(request));
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    const input = unwrap(validateDataExport(body));

    const outcome = await this.identity.exportData(user.id, input, clientIpOf(request.headers));
    if (outcome.kind === 'limited') refuse(reply, outcome);
    if (outcome.kind === 'too_soon') {
      void reply.header('retry-after', String(outcome.retryAfterSeconds));
      const error: ApiError = {
        error: 'rate_limited',
        message: nextCopyMessage(outcome.retryAfterSeconds),
        // Tells this refusal apart from the password ceilings' 429.
        fields: { export: 'one copy per day' },
      };
      throw new HttpException(error, 429);
    }
    if (outcome.kind === 'unknown') throw new UnauthorizedException(UNAUTHENTICATED);
    if (outcome.kind === 'wrong_password') {
      const error: ApiError = {
        error: 'validation',
        message: 'No copy was made.',
        fields: { password: 'is not right' },
      };
      throw new BadRequestException(error);
    }

    const day = outcome.data.generated_at.slice(0, 10);
    void reply.header('cache-control', 'no-store');
    void reply.header(
      'content-disposition',
      `attachment; filename="fmip-data-${user.username}-${day}.json"`,
    );
    return outcome.data;
  }

  @Post('verify-email')
  @HttpCode(200)
  async verifyEmail(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ verified: true }> {
    const { token } = unwrap(validateToken(body));
    const verified = await this.identity.verifyEmail(token, clientIpOf(request.headers));
    if (isLimited(verified)) refuse(reply, verified);
    if (!verified) throw new BadRequestException(INVALID_TOKEN);
    return { verified: true };
  }

  @Post('password/forgot')
  @HttpCode(202)
  async forgotPassword(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ accepted: true }> {
    const { email } = unwrap(validateForgotPassword(body));
    const outcome = await this.identity.requestPasswordReset(email, clientIpOf(request.headers));
    if (outcome.kind === 'limited') refuse(reply, outcome);
    return { accepted: true };
  }

  @Post('password/reset')
  @HttpCode(200)
  async resetPassword(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ reset: true }> {
    const { token, password } = unwrap(validateResetPassword(body));
    const reset = await this.identity.resetPassword(token, password, clientIpOf(request.headers));
    if (isLimited(reset)) refuse(reply, reset);
    if (!reset) throw new BadRequestException(INVALID_TOKEN);
    return { reset: true };
  }
}
