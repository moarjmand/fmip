import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  PayloadTooLargeException,
  Patch,
  Post,
  Query,
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
  ConsoleConversation,
  ConsoleInvitationView,
  ConsoleMe,
  ConsoleMessage,
  ConsoleRequestCounts,
  ConsoleRequestDetail,
  ConsoleRequestList,
  ConsoleSignInRequest,
  ConsoleSnapshotResponse,
} from '@fmip/contracts';
import { CONSOLE_REQUEST_IMAGE_MAX_BYTES } from '@fmip/contracts/console';
import { randomUUID } from 'node:crypto';
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
import { refuseOverRate } from '../rate-limits/rate-limits.service';
import {
  AGENT_NAME,
  CONSOLE_COOKIE,
  MESSAGE_ID,
  SESSION_IDLE_HOURS,
  afterFailure,
  checkCard,
  checkCommand,
  checkMessage,
  consoleCookie,
  consoleTokenText,
  isConsoleUsername,
  isLocked,
} from './internal/console-rules';
import { PostgresConsoleStore } from './internal/console-store';
import {
  REQUEST_ID,
  checkDecision,
  checkExecute,
  checkRequestCreate,
  checkRequestEdit,
  checkStatusAction,
  checkStatusFilter,
} from './internal/request-rules';
import { PostgresRequestStore, type RequestOutcome } from './internal/request-store';
import { isReadable, readCapped } from './internal/image-body';
import {
  REQUEST_IMAGE_FILES,
  type RequestImageFiles,
  imageKeys,
} from './internal/request-image-files';
import {
  IMAGE_CEILING,
  IMAGE_ID,
  IMAGE_REFUSALS,
  checkCaption,
  checkUpload,
  processUpload,
} from './internal/request-images';

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

const NO_REQUEST: ApiError = { error: 'not_found', message: 'No such request.' };
const NO_IMAGE: ApiError = { error: 'not_found', message: 'No such picture.' };

function invalid(message: string): BadRequestException {
  return new BadRequestException({ error: 'validation', message } satisfies ApiError);
}

function tooBig(): PayloadTooLargeException {
  return new PayloadTooLargeException({
    error: 'validation',
    message: IMAGE_REFUSALS.tooBig,
  } satisfies ApiError);
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
    private readonly requestStore: PostgresRequestStore,
    @Inject(CONSOLE_OPTIONS) private readonly options: ConsoleOptions,
    @Inject(REQUEST_IMAGE_FILES) private readonly imageFiles: RequestImageFiles,
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

  /** An agent's conversation (T-1722, D-350): a page, oldest first, ending before `before`. */
  @Get('agents/:name/messages')
  async conversation(
    @Param('name') name: string,
    @Query('before') before: unknown,
    @Req() request: FastifyRequest,
  ): Promise<ConsoleConversation> {
    await this.person(request);
    if (!AGENT_NAME.test(name))
      throw new NotFoundException({ error: 'not_found', message: 'No such agent.' });
    const cursor = typeof before === 'string' && before !== '' ? before : null;
    if (cursor !== null && !MESSAGE_ID.test(cursor)) throw invalid('before is a message id.');
    return this.store.conversation(name, cursor);
  }

  /**
   * A message to an agent (T-1722, D-350), queued for the maintainer's
   * computer, which runs the agent and posts its reply back; nothing on the
   * server reads the text. Audited, and held to the `console_message`
   * ceiling per person.
   */
  @Post('agents/:name/messages')
  async postMessage(
    @Param('name') name: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ConsoleMessage> {
    const actor = await this.person(request);
    const latest = await this.store.latestSnapshot();
    const agents = latest?.snapshot.agents.map((agent) => agent.name) ?? [];
    const checked = checkMessage(name, body, agents);
    if (!checked.ok) throw invalid(checked.reason);
    const outcome = await this.store.postMessage(name, checked.body, actor);
    if (outcome.kind === 'limited')
      refuseOverRate(
        reply,
        { ok: false, retryAfterSeconds: outcome.retryAfterSeconds },
        'That is the most messages to the agents an hour allows.',
      );
    return outcome.message;
  }

  // --- Teammate requests (T-1728, D-354) ------------------------------------

  /** The requests, newest first, each with its history, and the counts per status. */
  @Get('requests')
  async requests(
    @Query('status') status: unknown,
    @Req() request: FastifyRequest,
  ): Promise<ConsoleRequestList> {
    await this.person(request);
    const checked = checkStatusFilter(status);
    if (!checked.ok) throw invalid(checked.reason);
    return this.requestStore.list(checked.value);
  }

  /** The counts alone, for the navigation's badge. */
  @Get('requests/counts')
  async requestCounts(@Req() request: FastifyRequest): Promise<ConsoleRequestCounts> {
    await this.person(request);
    return this.requestStore.counts();
  }

  @Get('requests/:id')
  async request(
    @Param('id') id: string,
    @Req() request: FastifyRequest,
  ): Promise<ConsoleRequestDetail> {
    await this.person(request);
    const found = REQUEST_ID.test(id) ? await this.requestStore.get(id) : null;
    if (found === null) throw new NotFoundException(NO_REQUEST);
    return found;
  }

  /**
   * A request, as a console user wrote it down. It is data: nothing on the
   * server acts on it, and Claude acts on it only on the maintainer's word in
   * his own chat (D-354). Every write below is audited and held to the
   * `console_request` ceiling per person.
   */
  @Post('requests')
  async createRequest(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ConsoleRequestDetail> {
    const actor = await this.person(request);
    const checked = checkRequestCreate(body);
    if (!checked.ok) throw invalid(checked.reason);
    return this.answer(await this.requestStore.create(checked.value, actor), reply);
  }

  /**
   * Title, details or priority, by any console user: the console has two
   * invited people (D-340), the maintainer writes down what the teammate
   * said and the teammate may put it in his own words; each edit is in the
   * history and the audit with what it was before.
   */
  @Patch('requests/:id')
  async editRequest(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ConsoleRequestDetail> {
    const actor = await this.person(request);
    const checked = checkRequestEdit(body);
    if (!checked.ok) throw invalid(checked.reason);
    if (!REQUEST_ID.test(id)) throw new NotFoundException(NO_REQUEST);
    return this.answer(await this.requestStore.edit(id, checked.value, actor), reply);
  }

  /** Cancel an open request, or reopen a closed one. */
  @Post('requests/:id/status')
  @HttpCode(200)
  async requestStatus(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ConsoleRequestDetail> {
    const actor = await this.person(request);
    const checked = checkStatusAction(body);
    if (!checked.ok) throw invalid(checked.reason);
    if (!REQUEST_ID.test(id)) throw new NotFoundException(NO_REQUEST);
    return this.answer(await this.requestStore.changeStatus(id, checked.value, actor), reply);
  }

  /** "Run it now" (`{ execute: true }`) or its withdrawal; Claude still waits for the maintainer's word. */
  @Post('requests/:id/execute')
  @HttpCode(200)
  async requestExecute(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ConsoleRequestDetail> {
    const actor = await this.person(request);
    const checked = checkExecute(body);
    if (!checked.ok) throw invalid(checked.reason);
    if (!REQUEST_ID.test(id)) throw new NotFoundException(NO_REQUEST);
    return this.answer(await this.requestStore.setExecute(id, checked.value, actor), reply);
  }

  /** Any console user answers the open question: agree, disagree, or another view with text. */
  @Post('requests/:id/decision')
  @HttpCode(200)
  async requestDecision(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ConsoleRequestDetail> {
    const actor = await this.person(request);
    const checked = checkDecision(body);
    if (!checked.ok) throw invalid(checked.reason);
    if (!REQUEST_ID.test(id)) throw new NotFoundException(NO_REQUEST);
    return this.answer(
      await this.requestStore.decide(id, checked.value.choice, checked.value.text, actor),
      reply,
    );
  }

  // --- Pictures on a request (T-1731, D-357) ---------------------------------

  /**
   * A picture for an open request: the file's own bytes as
   * `application/octet-stream`, at most 8 MiB, and an optional `?caption=`.
   * The session, the request, its room (eight at most) and both ceilings are
   * checked before a byte is read; the first bytes decide the type; the
   * stored file is a WebP re-encoding without metadata, and its thumbnail.
   * Audited, with an event in the request's history.
   */
  @Post('requests/:id/images')
  async addImage(
    @Param('id') id: string,
    @Query('caption') caption: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ConsoleRequestDetail> {
    const actor = await this.person(request);
    if (!REQUEST_ID.test(id)) throw new NotFoundException(NO_REQUEST);
    const checkedCaption = checkCaption(caption);
    if (!checkedCaption.ok) throw invalid(checkedCaption.reason);
    const stated = Number(request.headers['content-length'] ?? NaN);
    if (Number.isFinite(stated) && stated > CONSOLE_REQUEST_IMAGE_MAX_BYTES) throw tooBig();
    const room = await this.requestStore.imageRoom(id, actor);
    if (room !== null) return this.answer(room, reply);
    if (!isReadable(request.body))
      throw invalid("Send the picture's own bytes as application/octet-stream.");
    const bytes = await readCapped(request.body, CONSOLE_REQUEST_IMAGE_MAX_BYTES);
    if (bytes === 'too_big') throw tooBig();
    const upload = checkUpload(bytes);
    if (!upload.ok) throw invalid(upload.reason);
    const processed = await processUpload(bytes, upload.value);
    if (!processed.ok) throw invalid(processed.reason);
    const imageId = randomUUID();
    const keys = imageKeys(id, imageId);
    let outcome: RequestOutcome;
    try {
      await this.imageFiles.put(keys.full, processed.value.full.bytes);
      await this.imageFiles.put(keys.thumb, processed.value.thumb.bytes);
      outcome = await this.requestStore.addImage(
        id,
        {
          id: imageId,
          caption: checkedCaption.value,
          originalType: upload.value,
          originalByteSize: bytes.length,
          processed: processed.value,
        },
        actor,
      );
    } catch (error) {
      await this.imageFiles.remove(keys.full, keys.thumb);
      throw error;
    }
    if (outcome.kind !== 'ok') await this.imageFiles.remove(keys.full, keys.thumb);
    return this.answer(outcome, reply);
  }

  /** A picture's caption (`''` clears it), on an open request, by any console user. */
  @Patch('requests/:id/images/:imageId')
  async captionImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ConsoleRequestDetail> {
    const actor = await this.person(request);
    if (!REQUEST_ID.test(id) || !IMAGE_ID.test(imageId)) throw new NotFoundException(NO_IMAGE);
    const raw =
      typeof body === 'object' && body !== null ? (body as { caption?: unknown }).caption : null;
    if (raw === undefined) throw invalid('A caption is text.');
    const checked = checkCaption(raw);
    if (!checked.ok) throw invalid(checked.reason);
    return this.answer(
      await this.requestStore.captionImage(id, imageId, checked.value, actor),
      reply,
    );
  }

  /** Removes a picture from an open request, by any console user; its files go with it. */
  @Delete('requests/:id/images/:imageId')
  @HttpCode(200)
  async removeImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ConsoleRequestDetail> {
    const actor = await this.person(request);
    if (!REQUEST_ID.test(id) || !IMAGE_ID.test(imageId)) throw new NotFoundException(NO_IMAGE);
    const { outcome, keys } = await this.requestStore.removeImage(id, imageId, actor);
    await this.imageFiles.remove(...keys);
    return this.answer(outcome, reply);
  }

  /** The stored picture, to a console session only. */
  @Get('requests/:id/images/:imageId')
  async image(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.serveImage(id, imageId, 'full', request, reply);
  }

  /** Its thumbnail (480 px), to a console session only. */
  @Get('requests/:id/images/:imageId/thumb')
  async imageThumb(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.serveImage(id, imageId, 'thumb', request, reply);
  }

  /**
   * Streams a picture: never cached by anyone but the viewer's own browser
   * (`private`), shown in place rather than saved, its type not to be
   * guessed, and nothing in it able to run (`sandbox`).
   */
  private async serveImage(
    id: string,
    imageId: string,
    size: 'full' | 'thumb',
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    await this.person(request);
    const row =
      REQUEST_ID.test(id) && IMAGE_ID.test(imageId)
        ? await this.requestStore.imageFile(imageId, id)
        : null;
    const file =
      row === null
        ? null
        : await this.imageFiles.open(size === 'full' ? row.storage_key : row.thumb_key);
    if (row === null || file === null) throw new NotFoundException(NO_IMAGE);
    const name = `request-${id.slice(0, 8)}-${row.position}${size === 'thumb' ? '-thumb' : ''}.webp`;
    void reply
      .status(200)
      .header('content-type', row.content_type)
      .header('content-length', String(file.size))
      .header('cache-control', 'private, max-age=3600')
      .header('content-disposition', `inline; filename="${name}"`)
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('referrer-policy', 'no-referrer')
      .send(file.stream);
  }

  @Get('audit')
  async audit(@Req() request: FastifyRequest): Promise<{ entries: ConsoleAuditEntry[] }> {
    await this.person(request);
    return { entries: await this.store.auditTrail() };
  }

  /** A request store's outcome as the answer: the request, or 429, 404 or 409. */
  private answer(outcome: RequestOutcome, reply: FastifyReply): ConsoleRequestDetail {
    switch (outcome.kind) {
      case 'ok':
        return outcome.request;
      case 'limited':
        return refuseOverRate(
          reply,
          { ok: false, retryAfterSeconds: outcome.retryAfterSeconds },
          outcome.ceiling === IMAGE_CEILING
            ? 'That is the most pictures an hour allows.'
            : 'That is the most changes to the requests an hour allows.',
        );
      case 'missing':
        throw new NotFoundException(outcome.what === 'image' ? NO_IMAGE : NO_REQUEST);
      case 'refused':
        throw new ConflictException({
          error: 'conflict',
          message: outcome.reason,
        } satisfies ApiError);
    }
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
