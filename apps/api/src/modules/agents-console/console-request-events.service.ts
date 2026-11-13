import { Injectable, Logger } from '@nestjs/common';
import type { ConsoleMe } from '@fmip/contracts';

/** A request just filed: what a listener may tell others, nothing more. */
export interface FiledRequest {
  id: string;
  title: string;
  filer: ConsoleMe;
}

export type FiledRequestListener = (request: FiledRequest) => Promise<unknown>;

/**
 * A new teammate request, told to whoever listens (T-1832, D-425), after it
 * is saved. `agents-console` holds no push channel (its command-line tool
 * must start without one), so `console-reminders`, which has it, registers
 * its sender here; with no listener (the command line), nothing happens.
 * The listener runs on its own: `filed` returns at once, and a listener's
 * failure is logged, never thrown, so it can never fail the request.
 */
@Injectable()
export class ConsoleRequestEvents {
  private readonly log = new Logger('ConsoleRequestEvents');
  private listener: FiledRequestListener | null = null;

  listen(listener: FiledRequestListener): void {
    this.listener = listener;
  }

  /** Tells the listener, without waiting for it; returns its promise for tests. */
  filed(request: FiledRequest): Promise<void> {
    const listener = this.listener;
    if (listener === null) return Promise.resolve();
    return Promise.resolve()
      .then(() => listener(request))
      .then(
        () => undefined,
        (error: unknown) => {
          this.log.warn('new-request notification failed', {
            event: 'console_request.alert_failed',
            request_id: request.id,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      );
  }
}
