import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { ApiError, SessionResponse } from '@fmip/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from './identity.service';
import {
  type Validated,
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
    const outcome = await this.identity.register(input, userAgentOf(request));

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
    const login = await this.identity.login(input, userAgentOf(request));

    if (login === null) {
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

  @Post('verify-email')
  @HttpCode(200)
  async verifyEmail(@Body() body: unknown): Promise<{ verified: true }> {
    const { token } = unwrap(validateToken(body));
    if (!(await this.identity.verifyEmail(token))) throw new BadRequestException(INVALID_TOKEN);
    return { verified: true };
  }

  @Post('password/forgot')
  @HttpCode(202)
  async forgotPassword(@Body() body: unknown): Promise<{ accepted: true }> {
    const { email } = unwrap(validateForgotPassword(body));
    await this.identity.requestPasswordReset(email);
    return { accepted: true };
  }

  @Post('password/reset')
  @HttpCode(200)
  async resetPassword(@Body() body: unknown): Promise<{ reset: true }> {
    const { token, password } = unwrap(validateResetPassword(body));
    if (!(await this.identity.resetPassword(token, password))) {
      throw new BadRequestException(INVALID_TOKEN);
    }
    return { reset: true };
  }
}
