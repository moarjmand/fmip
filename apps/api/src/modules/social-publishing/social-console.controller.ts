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
import type {
  ApiError,
  ConsoleMe,
  SocialAutomationLevel,
  SocialConsoleView,
  SocialPostKind,
} from '@fmip/contracts';
import { SOCIAL_AUTOMATION_LEVELS, SOCIAL_POST_KINDS } from '@fmip/contracts/console';
import type { FastifyRequest } from 'fastify';
import { ConsoleSessions } from '../agents-console/console-sessions.service';
import type { SocialActor } from './internal/social-post-store';
import { SocialPublishingScheduler } from './social-publishing-scheduler.service';
import { SocialPublishingService } from './social-publishing.service';

/** The longest reason a person writes for an action; the audit row keeps it whole. */
export const SOCIAL_REASON_MAX = 500;
/** The longest caption accepted before the network's own count is checked. */
export const SOCIAL_CAPTION_MAX = 4000;
/** The longest reference a person copies from the publisher's page to settle a post. */
export const SOCIAL_REFERENCE_MAX = 200;

const POST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const SIGNED_OUT: ApiError = { error: 'unauthenticated', message: 'Sign in to the console.' };
const NO_POST: ApiError = { error: 'not_found', message: 'No such post.' };

const invalid = (message: string) =>
  new BadRequestException({ error: 'validation', message } satisfies ApiError);
const conflict = (message: string) =>
  new ConflictException({ error: 'conflict', message } satisfies ApiError);
const forbidden = (message: string) =>
  new ForbiddenException({ error: 'forbidden', message } satisfies ApiError);

/**
 * Every refusal the service and store answer, as the console's sentence and
 * status. The web words each in Persian (`app/console/words.ts`).
 */
const REFUSALS: Record<string, () => Error> = {
  not_found: () => new NotFoundException(NO_POST),
  not_waiting: () => conflict('This post is not waiting for approval.'),
  not_unknown: () => conflict('Only a post with no answer from the network is settled.'),
  reason_required: () => invalid('Give a reason.'),
  reference_required: () => invalid('Give the reference of the published post.'),
  no_change: () => conflict('It is already so.'),
  not_owner: () => forbidden('Only the console owner changes a level.'),
  not_eligible: () => conflict('A kind is raised only after 14 clean posts in a row.'),
  stopped: () => conflict('Publishing is stopped; resume it before raising a level.'),
  reason_not_fresh: () => conflict('Give this change a reason of its own.'),
  text_blank: () => invalid('Write the caption.'),
  too_long: () => invalid('The caption is too long for its network.'),
  figures_changed: () =>
    conflict(
      'Only the words may change: a figure, a team, the model, the verdict or the link may not.',
    ),
  other_product: () => conflict('A caption names no other prediction.'),
  sensitive_text: () => conflict('The caption touches a sensitive topic.'),
  key_invalid: () => invalid('That is not a key: no spaces, at most 1024 characters.'),
  no_secret_box: () => conflict('The server cannot seal a key: it has no session secret.'),
  not_set: () => conflict('No key is set.'),
};

function refused(outcome: { refusal: string; gates?: string[] }): Error {
  if (outcome.refusal === 'gates_failed') {
    return conflict(`A gate fails now: ${(outcome.gates ?? []).join(', ')}.`);
  }
  return (REFUSALS[outcome.refusal] ?? (() => conflict('Refused.')))();
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** A person's reason: required, at most `SOCIAL_REASON_MAX` characters. */
function reasonOf(body: unknown): string {
  const reason = text((body as { reason?: unknown } | null)?.reason).trim();
  if (reason === '') throw REFUSALS.reason_required!();
  if (reason.length > SOCIAL_REASON_MAX) {
    throw invalid(`A reason is at most ${SOCIAL_REASON_MAX} characters.`);
  }
  return reason;
}

/**
 * The agents console's social tab (T-1836, D-427): the queue and its
 * decisions, the kill switch, each kind's level, the publisher's key and the
 * trail, behind the console's own session (`ConsoleSessions`), never a
 * member's. Either console person approves, rejects, edits a caption,
 * settles an unknown post, stops or resumes publishing and sets or clears the
 * key (D-427 as built: the teammate owns the Buffer account); only the owner
 * (`console_user.owner`, set by the CLI's `set-owner`) changes a level --
 * refused here with 403 whatever the page shows, and by the database again.
 * Every change is the store's one transaction with its
 * `console_audit` row. The key is taken and never given back: no answer, log
 * line or audit row holds it.
 *
 * CSRF as the console's other routes: the web calls these from its server
 * actions (same-origin, `SameSite=Strict` cookie on the console's host), and
 * the API takes JSON bodies only.
 */
@Controller('console/social')
export class SocialConsoleController {
  constructor(
    private readonly sessions: ConsoleSessions,
    private readonly social: SocialPublishingService,
    private readonly scheduler: SocialPublishingScheduler,
  ) {}

  @Get()
  async view(@Req() request: FastifyRequest): Promise<SocialConsoleView> {
    const me = await this.person(request);
    const owner = await this.social.isOwner(me.id);
    return this.social.consoleView({ name: me.display_name, owner }, await this.scheduler.health());
  }

  @Post('posts/:id/approve')
  @HttpCode(204)
  async approve(@Param('id') id: string, @Req() request: FastifyRequest): Promise<void> {
    const actor = this.actor(await this.person(request));
    this.postId(id);
    const outcome = await this.social.approve(id, actor);
    if (!outcome.ok) throw refused(outcome);
  }

  @Post('posts/:id/reject')
  @HttpCode(204)
  async reject(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const actor = this.actor(await this.person(request));
    this.postId(id);
    const outcome = await this.social.reject(id, actor, reasonOf(body));
    if (!outcome.ok) throw refused(outcome);
  }

  /** A caption's words only (`checkCaptionEdit`); answers the new post's id. */
  @Post('posts/:id/edit')
  async edit(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<{ id: string }> {
    const actor = this.actor(await this.person(request));
    this.postId(id);
    const caption = text((body as { body?: unknown } | null)?.body).replace(/\r\n?/g, '\n');
    if (caption.length > SOCIAL_CAPTION_MAX) throw REFUSALS.too_long!();
    const outcome = await this.social.edit(id, actor, caption, reasonOf(body));
    if (!outcome.ok) throw refused(outcome);
    return { id: outcome.value };
  }

  /** A post the network never answered for, settled from the publisher's own page. */
  @Post('posts/:id/settle')
  @HttpCode(204)
  async settle(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const actor = this.actor(await this.person(request));
    this.postId(id);
    const given = (body ?? {}) as { state?: unknown; reference?: unknown };
    if (given.state !== 'published' && given.state !== 'refused') {
      throw invalid('Choose published or refused.');
    }
    const reference = text(given.reference).trim();
    if (reference.length > SOCIAL_REFERENCE_MAX) throw invalid('That reference is too long.');
    const reason = reasonOf(body);
    const outcome = await this.social.settle(
      id,
      actor,
      given.state === 'published'
        ? { state: 'published', providerRef: reference }
        : { state: 'refused' },
      reason,
    );
    if (!outcome.ok) throw refused(outcome);
  }

  /** The kill switch: either console person stops or resumes publishing, with a reason. */
  @Post('switch')
  @HttpCode(204)
  async setSwitch(@Body() body: unknown, @Req() request: FastifyRequest): Promise<void> {
    const actor = this.actor(await this.person(request));
    const stop = (body as { stop?: unknown } | null)?.stop;
    if (typeof stop !== 'boolean') throw invalid('stop is true or false.');
    const outcome = await this.social.setSwitch(actor, stop, reasonOf(body));
    if (!outcome.ok) throw refused(outcome);
  }

  /** A kind's level: the owner's only, a raise only from 14 clean posts and while publishing runs. */
  @Post('levels/:kind')
  @HttpCode(204)
  async setLevel(
    @Param('kind') kind: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const me = await this.person(request);
    if (!(await this.social.isOwner(me.id))) throw REFUSALS.not_owner!();
    if (!(SOCIAL_POST_KINDS as readonly string[]).includes(kind)) {
      throw new NotFoundException({
        error: 'not_found',
        message: 'No such kind.',
      } satisfies ApiError);
    }
    const level = (body as { level?: unknown } | null)?.level;
    if (!(SOCIAL_AUTOMATION_LEVELS as readonly unknown[]).includes(level)) {
      throw invalid('A level is approval or automatic.');
    }
    const outcome = await this.social.setLevel(
      this.actor(me),
      kind as SocialPostKind,
      level as SocialAutomationLevel,
      reasonOf(body),
    );
    if (!outcome.ok) throw refused(outcome);
  }

  /**
   * The publisher's key, set or cleared by either console person (the
   * maintainer's answer, 2026-11-16: the teammate owns the Buffer account and
   * enters its key). Audited with who and when, never the value; answers
   * nothing back: the key is sealed and never returned.
   */
  @Post('key')
  @HttpCode(204)
  async setKey(@Body() body: unknown, @Req() request: FastifyRequest): Promise<void> {
    const me = await this.person(request);
    const key = text((body as { key?: unknown } | null)?.key);
    const outcome = await this.social.setKey(this.actor(me), key);
    if (!outcome.ok) throw refused(outcome);
  }

  @Post('key/clear')
  @HttpCode(204)
  async clearKey(@Body() body: unknown, @Req() request: FastifyRequest): Promise<void> {
    const me = await this.person(request);
    const outcome = await this.social.clearKey(this.actor(me), reasonOf(body));
    if (!outcome.ok) throw refused(outcome);
  }

  private async person(request: FastifyRequest): Promise<ConsoleMe> {
    const me = await this.sessions.person(request);
    if (me === null) throw new UnauthorizedException(SIGNED_OUT);
    return me;
  }

  /** The audit trail names a console person by their username, as the console's own rows do. */
  private actor(me: ConsoleMe): SocialActor {
    return { id: me.id, name: me.username };
  }

  private postId(id: string): void {
    if (!POST_ID.test(id)) throw new NotFoundException(NO_POST);
  }
}
