import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { IngestStore, type RefResolver } from './internal/ingest-store';

/**
 * T-1394 (D-209): a match the live list answered about without a change is
 * told to the open pages as a `fixture_change` notification, the shape the
 * row triggers raise, so every stream re-sends its snapshot with the new
 * `live_answered_at`.
 */
const DATABASE_URL = process.env.DATABASE_URL;

const unused: RefResolver = {
  resolve: () => Promise.reject(new Error('not used')),
  link: () => Promise.reject(new Error('not used')),
};

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('noteLiveAnswered', () => {
  it('raises one fixture_change per match, marked as a live answer', async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const listener = await pool.connect();
    const ids: string[] = [randomUUID(), randomUUID()];
    try {
      const heard: { fixture_id: string; table: string; at: string }[] = [];
      listener.on('notification', (message) => {
        if (message.channel !== 'fixture_change' || message.payload === undefined) return;
        const parsed = JSON.parse(message.payload) as {
          fixture_id: string;
          table: string;
          at: string;
        };
        if (ids.includes(parsed.fixture_id)) heard.push(parsed);
      });
      await listener.query('LISTEN fixture_change');

      const store = new IngestStore(pool, unused);
      // The same match twice in one run is one notification.
      await store.noteLiveAnswered([ids[0]!, ids[1]!, ids[0]!]);
      await store.noteLiveAnswered([]);

      const deadline = Date.now() + 5_000;
      while (heard.length < 2 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(heard.map((h) => h.fixture_id).sort()).toEqual([...ids].sort());
      expect(heard.every((h) => h.table === 'live_answer')).toBe(true);
      expect(heard.every((h) => !Number.isNaN(Date.parse(h.at)))).toBe(true);
    } finally {
      await listener.query('UNLISTEN fixture_change');
      listener.release();
      await pool.end();
    }
  });
});
