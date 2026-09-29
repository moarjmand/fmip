import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpException,
  NotFoundException,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  ApiError,
  PlatformRules,
  PlatformRulesStanding,
  SessionResponse,
} from '@fmip/contracts';
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
  validateAcceptRules,
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
    return { user: outcome.user, rules: await this.identity.rulesStanding(outcome.user.id) };
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
    return { user: login.user, rules: await this.identity.rulesStanding(login.user.id) };
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
    return { user, rules: await this.identity.rulesStanding(user.id) };
  }

  /**
   * Accept the platform rules in force (T-931, D-113). The body names the
   * version the member read; one published since is a 409 carrying nothing
   * but the sentence, and the page shows them the newer text to read first.
   */
  @Post('rules/accept')
  @HttpCode(200)
  async acceptRules(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<PlatformRulesStanding> {
    const user = await this.identity.authenticate(sessionTokenOf(request));
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    const { version } = unwrap(validateAcceptRules(body));

    const outcome = await this.identity.acceptRules(user.id, version);
    if (outcome.kind === 'unknown_user') throw new UnauthorizedException(UNAUTHENTICATED);
    if (outcome.kind === 'not_current') {
      const error: ApiError = {
        error: 'conflict',
        message:
          'These are not the platform rules in force. Read the current version and accept that.',
      };
      throw new ConflictException(error);
    }
    return outcome.standing;
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

/**
 * `GET /rules/platform` (T-931, D-113): the platform rules in force, for
 * anybody -- a guest reads what they would accept by registering, and a
 * member reads a new version before accepting it.
 */
@Controller('rules')
export class PlatformRulesController {
  constructor(private readonly identity: IdentityService) {}

  @Get('platform')
  async platform(): Promise<PlatformRules> {
    const rules = await this.identity.currentRules();
    if (rules === null) {
      const error: ApiError = { error: 'not_found', message: 'No platform rules are published.' };
      throw new NotFoundException(error);
    }
    return rules;
  }
}
