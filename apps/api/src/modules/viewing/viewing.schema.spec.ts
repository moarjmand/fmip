import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The viewing schema (T-311, blueprint 11) against the real database: a
 * listing is per territory and per service; a source says what it grants and
 * a highlight cannot carry more (`PL017`); coverage is per territory and a
 * supplied state has a source; a dropped source takes its listings and turns
 * the coverage it stood behind into `not_supplied` with the reason -- never
 * into an empty panel that reads as "not available".
 */
const DATABASE_URL = process.env.DATABASE_URL;
const PL_2025 = '00000000-0000-4000-8000-000000000302';
const REGULAR_SEASON = '00000000-0000-4000-8000-000000000401';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

interface Codeful {
  code?: string;
  constraint?: string;
}
const sqlstate = (error: unknown): string | undefined => (error as Codeful).code;
const constraintOf = (error: unknown): string | undefined => (error as Codeful).constraint;

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('viewing schema', () => {
  let pool: Pool;
  const fixture = randomUUID();
  const sources: string[] = [];
  const broadcasters: string[] = [];

  async function source(rights: 'link' | 'thumbnail' | 'embed'): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO viewing_source (name, homepage_url, kind, rights)
       VALUES ($1, 'https://listing.test', 'official_listing', $2) RETURNING id`,
      [`Listing ${rights} ${RUN}`, rights],
    );
    sources.push(rows[0]!.id);
    return rows[0]!.id;
  }

  async function broadcaster(name: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO broadcaster (name, homepage_url, kind) VALUES ($1, 'https://tv.test', 'tv') RETURNING id`,
      [`${name} ${RUN}`],
    );
    broadcasters.push(rows[0]!.id);
    return rows[0]!.id;
  }

  const option = (territory: string, broadcasterId: string, sourceId: string) =>
    pool.query(
      `INSERT INTO viewing_option (fixture_id, territory, broadcaster_id, source_id, access, url)
       VALUES ($1, $2, $3, $4, 'subscription', 'https://tv.test/watch')`,
      [fixture, territory, broadcasterId, sourceId],
    );

  const highlight = (
    territory: string,
    sourceId: string,
    kind: 'embed' | 'official_page',
    embedUrl: string | null,
    thumbnailUrl: string | null = null,
  ) =>
    pool.query(
      `INSERT INTO highlight (fixture_id, territory, source_id, kind, url, embed_url, thumbnail_url)
       VALUES ($1, $2, $3, $4, 'https://official.test/highlights', $5, $6)`,
      [fixture, territory, sourceId, kind, embedUrl, thumbnailUrl],
    );

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    await pool.query(
      `INSERT INTO fixture (id, season_id, stage_id, round, kickoff_at, status)
       VALUES ($1, $2, $3, 'Matchday 30', now() + interval '3 days', 'scheduled')`,
      [fixture, PL_2025, REGULAR_SEASON],
    );
  });

  afterAll(async () => {
    // The seed carries no coverage rows; a dropped source's row keeps the drop's note, not the run's.
    await pool.query(
      `DELETE FROM viewing_coverage WHERE season_id = $1 AND territory IN ('GB', 'IE', 'TR')`,
      [PL_2025],
    );
    await pool.query(`DELETE FROM fixture WHERE id = $1`, [fixture]);
    if (sources.length > 0) {
      await pool.query(`DELETE FROM viewing_source WHERE id = ANY($1::uuid[])`, [sources]);
    }
    if (broadcasters.length > 0) {
      await pool.query(`DELETE FROM broadcaster WHERE id = ANY($1::uuid[])`, [broadcasters]);
    }
    await pool.end();
  });

  it('stores a listing per territory and per service, against a territory that exists', async () => {
    const listing = await source('link');
    const sky = await broadcaster('Sky');
    await option('GB', sky, listing);
    await option('IE', sky, listing);
    await expect(option('GB', sky, listing)).rejects.toSatisfy(
      (e) => constraintOf(e) === 'viewing_option_one_per_service',
    );
    await expect(option('XX', sky, listing)).rejects.toSatisfy((e) => sqlstate(e) === '23503');
    await expect(
      pool.query(
        `INSERT INTO viewing_option (fixture_id, territory, broadcaster_id, source_id, access, url)
         VALUES ($1, 'GB', $2, $3, 'pirate', 'https://x')`,
        [fixture, sky, listing],
      ),
    ).rejects.toSatisfy((e) => constraintOf(e) === 'viewing_option_access_check');
    const { rows } = await pool.query<{ territory: string }>(
      `SELECT territory FROM viewing_option WHERE fixture_id = $1 ORDER BY territory`,
      [fixture],
    );
    expect(rows.map((r) => r.territory)).toEqual(['GB', 'IE']);
  });

  it('refuses a highlight that carries more than its source grants (PL017), and takes the official page from anyone', async () => {
    const linkOnly = await source('link');
    const thumbnails = await source('thumbnail');
    const embeds = await source('embed');

    await expect(highlight('GB', linkOnly, 'embed', 'https://player.test/1')).rejects.toSatisfy(
      (e) => sqlstate(e) === 'PL017',
    );
    await expect(
      highlight('GB', linkOnly, 'official_page', null, 'https://img.test/1.jpg'),
    ).rejects.toSatisfy((e) => sqlstate(e) === 'PL017');
    await expect(highlight('GB', thumbnails, 'embed', 'https://player.test/1')).rejects.toSatisfy(
      (e) => sqlstate(e) === 'PL017',
    );
    // The shape itself: an embed has a player and nothing else does.
    await expect(highlight('GB', embeds, 'embed', null)).rejects.toSatisfy(
      (e) => constraintOf(e) === 'highlight_embed_has_player',
    );
    await expect(
      highlight('GB', embeds, 'official_page', 'https://player.test/1'),
    ).rejects.toSatisfy((e) => constraintOf(e) === 'highlight_embed_has_player');

    await highlight('GB', linkOnly, 'official_page', null);
    await highlight('IE', thumbnails, 'official_page', null, 'https://img.test/1.jpg');
    await highlight('TR', embeds, 'embed', 'https://player.test/1', 'https://img.test/1.jpg');
    // One highlight per territory: the embed cleared for one country is not cleared for another.
    await expect(highlight('GB', embeds, 'embed', 'https://player.test/2')).rejects.toSatisfy(
      (e) => constraintOf(e) === 'highlight_one_per_territory',
    );
    const { rows } = await pool.query<{ territory: string; kind: string }>(
      `SELECT territory, kind FROM highlight WHERE fixture_id = $1 ORDER BY territory`,
      [fixture],
    );
    expect(rows).toEqual([
      { territory: 'GB', kind: 'official_page' },
      { territory: 'IE', kind: 'official_page' },
      { territory: 'TR', kind: 'embed' },
    ]);
  });

  it('keeps coverage per territory, insists a supplied state names its source, and turns a dropped source into not_supplied with the reason', async () => {
    const listing = await source('link');
    await expect(
      pool.query(
        `INSERT INTO viewing_coverage (season_id, territory, module, state, note)
         VALUES ($1, 'GB', 'viewing', 'available', $2)`,
        [PL_2025, `no source ${RUN}`],
      ),
    ).rejects.toSatisfy((e) => constraintOf(e) === 'viewing_coverage_supplied_has_source');
    await pool.query(
      `INSERT INTO viewing_coverage (season_id, territory, module, state, source_id, note)
       VALUES ($1, 'GB', 'viewing', 'available', $2, $3), ($1, 'TR', 'viewing', 'not_supplied', NULL, $3)`,
      [PL_2025, listing, `coverage ${RUN}`],
    );
    await expect(
      pool.query(
        `INSERT INTO viewing_coverage (season_id, territory, module, state, source_id, note)
         VALUES ($1, 'GB', 'viewing', 'limited', $2, $3)`,
        [PL_2025, listing, `twice ${RUN}`],
      ),
    ).rejects.toSatisfy((e) => constraintOf(e) === 'viewing_coverage_one_per_territory');

    const bbc = await broadcaster('BBC');
    await option('GB', bbc, listing);
    await pool.query(
      `UPDATE viewing_source SET dropped_at = now(), dropped_reason = 'asked to be dropped' WHERE id = $1`,
      [listing],
    );
    const options = await pool.query(`SELECT 1 FROM viewing_option WHERE source_id = $1`, [
      listing,
    ]);
    expect(options.rowCount).toBe(0);
    const coverage = await pool.query<{ state: string; source_id: string | null; note: string }>(
      `SELECT state, source_id, note FROM viewing_coverage
        WHERE season_id = $1 AND territory = 'GB' AND module = 'viewing'`,
      [PL_2025],
    );
    expect(coverage.rows[0]).toEqual({
      state: 'not_supplied',
      source_id: null,
      note: 'source dropped: asked to be dropped',
    });
    // The rule is in the schema, not in a writer: dropping without a reason is refused.
    await expect(
      pool.query(
        `UPDATE viewing_source SET dropped_at = now(), dropped_reason = NULL WHERE id = $1`,
        [listing],
      ),
    ).rejects.toSatisfy((e) => constraintOf(e) === 'viewing_source_dropped_is_whole');
  });
});
