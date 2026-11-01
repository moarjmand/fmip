import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  ApiError,
  ConsoleAcceptInvitationRequest,
  ConsoleAuditEntry,
  ConsoleBoardCard,
  ConsoleCommand,
  ConsoleInvitationView,
  ConsoleMe,
  ConsoleSignInRequest,
  ConsoleSnapshotResponse,
} from '@fmip/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  decoyHash,
  hashPassword,
  hashToken,
  isWellFormedToken,
  newToken,
  parseCookies,
  verifyPassword,
} from '../identity/identity.service';
import {
  CONSOLE_COOKIE,
  SESSION_IDLE_HOURS,
  afterFailure,
  checkCard,
  checkCommand,
  consoleCookie,
  consoleTokenText,
  isConsoleUsername,
  isLocked,
} from './internal/console-rules';
import { PostgresConsoleStore } from './internal/console-store';

export interface ConsoleOptions {
  /** Keys the HMAC of the console's session and invitation tokens. */
  secret: string;
  /** The cookie only over HTTPS. True in production. */
  cookieSecure: boolean;
}

export const CONSOLE_OPTIONS = Symbol('CONSOLE_OPTIONS');

const SIGNED_OUT: ApiError = { error: 'unauthenticated', message: 'Sign in to the console.' };
const WRONG: ApiError = {
  error: 'unauthenticated',
  message: 'Wrong name or password, or the name is locked for a while after too many tries.',
};

function invalid(message: string): BadRequestException {
  return new BadRequestException({ error: 'validation', message } satisfies ApiError);
}

/**
 * The agents console (T-1696, T-1697, D-340), under `/console/`. Its people
 * are the console's own accounts, never the site's members: a session is the
 * `fmip_console` cookie, which the web keeps on the console's host only.
 *
 * Signing in, and opening an account from an invitation, are the only routes
 * that answer without a session. The snapshot and the queue's computer side
 * have no route at all: they are `cli/agents-console.js`, run on the server.
 */
@Controller('console')
export class AgentsConsoleController {
  constructor(
    private readonly store: PostgresConsoleStore,
    @Inject(CONSOLE_OPTIONS) private readonly options: ConsoleOptions,
  ) {}

  @Post('session')
  @HttpCode(204)
  async signIn(
    @Body() body: ConsoleSignInRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const username = typeof body?.username === 'string' ? body.username.trim().toLowerCase() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    const user = isConsoleUsername(username) ? await this.store.userByName(username) : null;
    const now = new Date();
    if (user === null || user.disabled_at !== null) {
      await verifyPassword(password, await decoyHash());
      await this.store.failedSignIn(username || '(empty)', null, 0, null);
      throw new UnauthorizedException(WRONG);
    }
    if (isLocked(user.locked_until, now)) {
      await verifyPassword(password, await decoyHash());
      throw new UnauthorizedException(WRONG);
    }
    if (!(await verifyPassword(password, user.password_hash))) {
      const next = afterFailure(user.failed_logins, now);
      await this.store.failedSignIn(username, user.id, next.failures, next.lockedUntil);
      throw new UnauthorizedException(WRONG);
    }
    await this.store.signedIn(user.id);
    await this.openSession(user.id, reply);
  }

  @Delete('session')
  @HttpCode(204)
  async signOut(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const token = this.token(request);
    if (token !== null) await this.store.revokeSession(this.hash(token));
    reply.header('set-cookie', consoleCookie('', 0, this.options.cookieSecure));
  }

  @Get('me')
  async me(@Req() request: FastifyRequest): Promise<ConsoleMe> {
    return this.person(request);
  }

  @Get('invitations/:token')
  async invitation(@Param('token') token: string): Promise<ConsoleInvitationView> {
    const open = isWellFormedToken(token)
      ? await this.store.openInvitation(this.hash(token))
      : null;
    if (open === null)
      throw new NotFoundException({
        error: 'not_found',
        message: 'This invitation is used or has expired.',
      });
    return { display_name: open.display_name, expires_at: open.expires_at.toISOString() };
  }

  @Post('invitations/accept')
  @HttpCode(204)
  async accept(
    @Body() body: ConsoleAcceptInvitationRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    if (!isWellFormedToken(body?.token)) throw invalid('This invitation link is not whole.');
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    if (!isConsoleUsername(username)) {
      throw invalid('A name of 3 to 32 lower-case letters, digits, dots, dashes or underscores.');
    }
    const password = typeof body.password === 'string' ? body.password : '';
    if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
      throw invalid(`A password of ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`);
    }
    const outcome = await this.store.acceptInvitation(
      this.hash(body.token),
      username,
      await hashPassword(password),
    );
    if (outcome.kind === 'closed') {
      throw new NotFoundException({
        error: 'not_found',
        message: 'This invitation is used or has expired.',
      });
    }
    if (outcome.kind === 'taken') throw invalid('That name is taken. Choose another.');
    await this.openSession(outcome.user.id, reply);
  }

  @Get('snapshot')
  async snapshot(@Req() request: FastifyRequest): Promise<ConsoleSnapshotResponse> {
    await this.person(request);
    const latest = await this.store.latestSnapshot();
    return latest === null
      ? { snapshot: null, loaded_at: null }
      : { snapshot: latest.snapshot, loaded_at: latest.loaded_at.toISOString() };
  }

  @Get('commands')
  async commands(@Req() request: FastifyRequest): Promise<{ commands: ConsoleCommand[] }> {
    await this.person(request);
    return { commands: await this.store.commands() };
  }

  @Post('commands')
  async queue(@Body() body: unknown, @Req() request: FastifyRequest): Promise<ConsoleCommand> {
    const actor = await this.person(request);
    const latest = await this.store.latestSnapshot();
    const agents = latest?.snapshot.agents.map((agent) => agent.name) ?? [];
    const decisions =
      latest?.snapshot.decisions.filter((d) => d.status === 'open').map((d) => d.id) ?? [];
    const checked = checkCommand(body, agents, decisions);
    if (!checked.ok) throw invalid(checked.reason);
    return this.store.queueCommand(checked.command, actor);
  }

  @Get('board')
  async board(@Req() request: FastifyRequest): Promise<{ cards: ConsoleBoardCard[] }> {
    await this.person(request);
    return { cards: await this.store.cards() };
  }

  @Post('board')
  async addCard(@Body() body: unknown, @Req() request: FastifyRequest): Promise<ConsoleBoardCard> {
    const actor = await this.person(request);
    const checked = checkCard(body, true);
    if (!checked.ok) throw invalid(checked.reason);
    return this.store.createCard(checked.card, actor);
  }

  @Patch('board/:id')
  async changeCard(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<ConsoleBoardCard> {
    const actor = await this.person(request);
    const checked = checkCard(body, false);
    if (!checked.ok) throw invalid(checked.reason);
    const changed = /^[0-9a-f-]{36}$/.test(id)
      ? await this.store.updateCard(id, checked.card, actor)
      : null;
    if (changed === null)
      throw new NotFoundException({ error: 'not_found', message: 'No such card.' });
    return changed;
  }

  @Delete('board/:id')
  @HttpCode(204)
  async archiveCard(@Param('id') id: string, @Req() request: FastifyRequest): Promise<void> {
    const actor = await this.person(request);
    const archived = /^[0-9a-f-]{36}$/.test(id) && (await this.store.archiveCard(id, actor));
    if (!archived) throw new NotFoundException({ error: 'not_found', message: 'No such card.' });
  }

  @Get('audit')
  async audit(@Req() request: FastifyRequest): Promise<{ entries: ConsoleAuditEntry[] }> {
    await this.person(request);
    return { entries: await this.store.auditTrail() };
  }

  private async openSession(userId: string, reply: FastifyReply): Promise<void> {
    const token = newToken();
    await this.store.createSession(userId, this.hash(token));
    reply.header(
      'set-cookie',
      consoleCookie(token, SESSION_IDLE_HOURS * 3600, this.options.cookieSecure),
    );
  }

  private token(request: FastifyRequest): string | null {
    const value = parseCookies(request.headers.cookie)[CONSOLE_COOKIE];
    return isWellFormedToken(value) ? value : null;
  }

  private hash(token: string): string {
    return hashToken(consoleTokenText(token), this.options.secret);
  }

  private async person(request: FastifyRequest): Promise<ConsoleMe> {
    const token = this.token(request);
    const me = token === null ? null : await this.store.sessionUser(this.hash(token));
    if (me === null) throw new UnauthorizedException(SIGNED_OUT);
    return me;
  }
}
