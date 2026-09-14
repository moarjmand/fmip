import { Controller, Get } from '@nestjs/common';
import type { ChatHealth } from '@fmip/contracts';
import { ChatGateway } from './chat.gateway';

/**
 * `GET /health/chat` (T-233).
 *
 * Public and read-only, like `/health/live` (T-071) beside it. It names no
 * member, no conversation and no message — only how many of each there are —
 * because an operational number that identifies who is talking to whom is not
 * an operational number.
 *
 * **A silent socket layer should be visible from here, not from a complaint.**
 * Three of these numbers are the ones that say something is wrong before anyone
 * reports it: `bus` other than `connected`, `latency_ms.p95` climbing, and
 * `connections` at zero on an instance that is serving HTTP.
 */
@Controller()
export class ChatHealthController {
  constructor(private readonly gateway: ChatGateway) {}

  @Get('health/chat')
  chat(): ChatHealth {
    return this.gateway.health();
  }
}
