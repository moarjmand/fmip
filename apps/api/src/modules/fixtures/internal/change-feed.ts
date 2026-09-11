import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import { PG_POOL } from '../../../database/database.module';

export interface FixtureChange {
  fixtureId: string;
  table: string;
  /** ISO 8601, the database clock. */
  at: string;
}

export type ChangeListener = (change: FixtureChange) => void;

/** The channel `notify_fixture_change()` raises (migration 1758700000000). */
export const CHANNEL = 'fixture_change';

/**
 * LISTENs on Postgres for fixture changes and fans them out in-process
 * (D-034). One dedicated connection, taken from the pool the first time
 * anyone subscribes and held until the module shuts down; the pool's
 * ordinary connections are never blocked by it.
 *
 * Failure is visible, not silent: if the connection drops, every listener
 * gets `onError` and the feed reconnects with a delay; subscribers that hold
 * an SSE session send the client a `stale` event, so the page can say it.
 */
@Injectable()
export class FixtureChangeFeed implements OnModuleDestroy {
  private client: PoolClient | null = null;
  private connecting: Promise<void> | null = null;
  private closed = false;
  private readonly listeners = new Set<ChangeListener>();
  private readonly errorListeners = new Set<(error: Error) => void>();

  /** Pause before re-LISTENing after the connection dropped. */
  reconnectDelayMs = 2_000;

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async subscribe(listener: ChangeListener, onError?: (error: Error) => void): Promise<() => void> {
    this.listeners.add(listener);
    if (onError !== undefined) this.errorListeners.add(onError);
    await this.ensureListening();
    return () => {
      this.listeners.delete(listener);
      if (onError !== undefined) this.errorListeners.delete(onError);
    };
  }

  /** How many subscribers are attached; the health of the gateway in one number. */
  get subscribers(): number {
    return this.listeners.size;
  }

  private async ensureListening(): Promise<void> {
    if (this.client !== null || this.closed) return;
    if (this.connecting === null) {
      this.connecting = this.connect().finally(() => {
        this.connecting = null;
      });
    }
    await this.connecting;
  }

  private async connect(): Promise<void> {
    const client = await this.pool.connect();
    client.on('notification', (message) => {
      if (message.channel !== CHANNEL || message.payload === undefined) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(message.payload);
      } catch {
        return;
      }
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        typeof (parsed as { fixture_id?: unknown }).fixture_id !== 'string'
      ) {
        return;
      }
      const p = parsed as { fixture_id: string; table?: unknown; at?: unknown };
      const change: FixtureChange = {
        fixtureId: p.fixture_id,
        table: typeof p.table === 'string' ? p.table : 'unknown',
        at: typeof p.at === 'string' ? p.at : new Date().toISOString(),
      };
      for (const listener of this.listeners) listener(change);
    });
    client.on('error', (error: Error) => {
      this.dropClient();
      for (const listener of this.errorListeners) listener(error);
      if (!this.closed && this.listeners.size > 0) {
        setTimeout(() => void this.ensureListening().catch(() => undefined), this.reconnectDelayMs);
      }
    });
    await client.query(`LISTEN ${CHANNEL}`);
    this.client = client;
  }

  private dropClient(): void {
    const client = this.client;
    this.client = null;
    if (client !== null) {
      // A client that errored is not safe to reuse; destroy it rather than
      // returning it to the pool.
      client.release(true);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.closed = true;
    const client = this.client;
    this.client = null;
    if (client !== null) {
      try {
        await client.query(`UNLISTEN ${CHANNEL}`);
      } catch {
        // The connection may already be gone; releasing is what matters.
      }
      client.release();
    }
  }
}
