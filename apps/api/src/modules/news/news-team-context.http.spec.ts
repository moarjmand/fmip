import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresNewsStore, type LinkRule } from './internal/news-store';
import { FIXTURE_WINDOW, MINIMUM_NAME_LENGTH } from './news-clustering.service';

/**
 * Which team a story is filed under once D-211's rule has found the name
 * (T-1400, D-215), against the real schema. Every headline and summary below
 * stood on production's English pages on 2026-10-12 (summaries cut where
 * with "..."), filed under the team named in the test; those written for the
 * spec say so. The articles are dated 2026-10-04 12:00 UTC, the fixtures
 * placed around that date.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const ENGLAND_COUNTRY = '00000000-0000-4000-8000-000000000101';
const PL_2025 = '00000000-0000-4000-8000-000000000302';
const REGULAR_SEASON = '00000000-0000-4000-8000-000000000401';
const AT = '2026-10-04T12:00:00Z';
const RULE: LinkRule = {
  minimumKeyLength: MINIMUM_NAME_LENGTH,
  fixtureWindow: FIXTURE_WINDOW,
  persons: false,
};

const ids = {
  england: randomUUID(),
  spain: randomUUID(),
  spainWomen: randomUUID(),
  argentina: randomUUID(),
  brazil: randomUUID(),
  france: randomUUID(),
  italy: randomUUID(),
  croatia: randomUUID(),
  czechia: randomUUID(),
  senegal: randomUUID(),
  georgia: randomUUID(),
  derby: randomUUID(),
  junior: randomUUID(),
  arsenal: randomUUID(),
  watford: randomUUID(),
};
const fixtures: string[] = [];

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'news team context (T-1400)',
  () => {
    let pool: Pool;
    let store: PostgresNewsStore;
    let source: string;
    const stories: string[] = [];

    /** An article with one version, placed as the job places it; its links among `ids`. */
    async function filed(headline: string, summary: string | null = null): Promise<string[]> {
      const { id } = await store.upsertArticle(
        source,
        randomUUID(),
        `https://context.test/${randomUUID()}`,
      );
      await store.addVersion(id, 'en', 1, { headline, summary, byline: null, published_at: AT });
      stories.push(await store.storyOf(id));
      await store.linkEntities(id, RULE);
      return links(id);
    }

    async function links(articleId: string): Promise<string[]> {
      const { rows } = await pool.query<{ entity_id: string }>(
        `SELECT entity_id FROM article_entity
          WHERE article_id = $1 AND entity_type IN ('team', 'competition')`,
        [articleId],
      );
      const ours = Object.values(ids) as string[];
      return rows
        .map((r) => r.entity_id)
        .filter((e) => ours.includes(e))
        .sort();
    }

    const sorted = (...list: string[]): string[] => [...list].sort();

    async function fixture(kickoff: string, home: string, away: string): Promise<void> {
      const id = randomUUID();
      fixtures.push(id);
      await pool.query(
        `INSERT INTO fixture (id, season_id, stage_id, round, kickoff_at, status)
         VALUES ($1, $2, $3, 'Matchday 1', $4, 'scheduled')`,
        [id, PL_2025, REGULAR_SEASON, kickoff],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
        [id, home, away],
      );
    }

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });
      store = new PostgresNewsStore(pool);
      const teams: [string, string, 'club' | 'national', 'men' | 'women'][] = [
        [ids.england, 'England', 'national', 'men'],
        [ids.spain, 'Spain', 'national', 'men'],
        [ids.spainWomen, 'Spain', 'national', 'women'],
        [ids.argentina, 'Argentina', 'national', 'men'],
        [ids.brazil, 'Brazil', 'national', 'men'],
        [ids.france, 'France', 'national', 'men'],
        [ids.italy, 'Italy', 'national', 'men'],
        [ids.croatia, 'Croatia', 'national', 'men'],
        [ids.czechia, 'Czechia', 'national', 'men'],
        [ids.senegal, 'Senegal', 'national', 'men'],
        [ids.georgia, 'Georgia', 'national', 'men'],
        [ids.derby, 'Derby', 'club', 'men'],
        [ids.junior, 'Junior', 'club', 'men'],
        [ids.arsenal, 'Arsenal', 'club', 'men'],
        [ids.watford, 'Watford', 'club', 'men'],
      ];
      for (const [id, name, kind, gender] of teams) {
        await pool.query(
          `INSERT INTO team (id, country_id, name, kind, gender) VALUES ($1, $2, $3, $4, $5)`,
          [id, ENGLAND_COUNTRY, name, kind, gender],
        );
      }
      // The English names migration 1765861000000 records for the two clubs.
      await pool.query(
        `INSERT INTO entity_alias (entity_type, entity_id, alias, language, kind, source)
         VALUES ('team', $1, 'Derby County', 'en', 'name', 'test'),
                ('team', $2, 'Atlético Junior', 'en', 'name', 'test')`,
        [ids.derby, ids.junior],
      );
      // Around 4 October: England, Spain (both sides), Argentina and Brazil play;
      // France, Italy, Senegal and Georgia do not.
      await fixture('2026-10-05T18:45:00Z', ids.croatia, ids.england);
      await fixture('2026-10-03T18:45:00Z', ids.spain, ids.czechia);
      await fixture('2026-10-03T23:00:00Z', ids.spainWomen, ids.croatia);
      await fixture('2026-10-06T00:00:00Z', ids.argentina, ids.brazil);
      const src = await pool.query<{ id: string }>(
        `INSERT INTO news_source (name, homepage_url, feed_url, kind, rights, language)
         VALUES ($1, 'https://context.test', NULL, 'licensed', 'summary', 'en') RETURNING id`,
        [`Context ${randomUUID()}`],
      );
      source = src.rows[0]!.id;
    });

    afterAll(async () => {
      await pool.query(`DELETE FROM news_source WHERE id = $1`, [source]);
      if (stories.length > 0) {
        await pool.query(`DELETE FROM story WHERE id = ANY($1::uuid[])`, [stories]);
      }
      await pool.query(`DELETE FROM fixture_participant WHERE fixture_id = ANY($1::uuid[])`, [
        fixtures,
      ]);
      await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [fixtures]);
      const all = Object.values(ids);
      await pool.query(`DELETE FROM entity_alias WHERE entity_id = ANY($1::uuid[])`, [all]);
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [all]);
      await pool.end();
    });

    it('files a national team where the headline writes it as the football team', async () => {
      // A team word beside the name; no fixture needed.
      expect(
        await filed(
          'Watford sign Senegal international Diatta',
          'Watford sign Senegal international Krepin Diatta on a free transfer.',
        ),
      ).toEqual(sorted(ids.senegal, ids.watford));
      // "vs" with another national team on its other side.
      expect(
        await filed(
          'Today’s Papers: France vs Italy dominates as Zidane revisits Materazzi headbutt',
        ),
      ).toEqual(sorted(ids.france, ids.italy));
      // A fixture within three days.
      expect(await filed('Tuchel could unleash England’s wildcard against Croatia')).toEqual(
        sorted(ids.england, ids.croatia),
      );
      expect(
        await filed('Spain hold off Czechia to move within one point of quarter-finals'),
      ).toEqual(sorted(ids.spain, ids.czechia));
      // With neither, a country is not filed: France plays nobody around this date.
      expect(await filed('Ousmane Dembele compares his position for PSG and France')).toEqual([]);
    });

    it('does not file a country named as a place', async () => {
      for (const [headline, summary] of [
        [
          'Meanwhile in England: Premier League giants at their worst in decades',
          'What exactly are Man United doing while City are in court ...',
        ],
        [
          '💸 Official: Messi buys a club in Spain',
          'CD Eldense officially announced the acquisition of the club by Leo Messi ...',
        ],
        ['Sevilla manager names Barcelona the best team in Spain: ‘They are very hungry’', null],
        [
          'Lyon full-back Nicolás Tagliafico considers possible return to Argentina',
          'With less than a year to go before his contract with Olympique Lyonnais expires ...',
        ],
        // "World Cup" is near, but "to Brazil" is the country.
        [
          'From U-17 World Cup to Brazil: Indian football keeps finding hope, but how long does it last?',
          null,
        ],
      ] as const) {
        expect(await filed(headline, summary), headline).toEqual([]);
      }
      // After a place word, the team where the words say so: a possessive, the
      // verb before, another clause between them.
      expect(await filed('Talking points from England’s 7-0 thrashing of Croatia')).toEqual(
        sorted(ids.england, ids.croatia),
      );
      expect(
        await filed('Lionel Messi bids tearful farewell to Argentina: ‘The most wonderful thing’'),
      ).toEqual([ids.argentina]);
      expect(
        await filed('How Barcelona star was central to Spain’s press this international break'),
      ).toEqual([ids.spain]);
      // Production's "🚨XIs in: Portugal visit Denmark without Cristiano", with this spec's teams.
      expect(await filed('🚨XIs in: Spain visit Czechia without Yamal')).toEqual(
        sorted(ids.spain, ids.czechia),
      );
      // A place word followed by a team word is the team (written for the spec).
      expect(await filed('Rashford back in England squad for Croatia trip')).toContain(ids.england);
    });

    it('does not file American college football under Georgia', async () => {
      expect(
        await filed(
          'Soggy, windy and huge stakes: No. 2 Georgia vs. No. 6 Alabama takes center stage',
        ),
      ).toEqual([]);
    });

    it('does not file women’s football under a men’s team', async () => {
      expect(
        await filed(
          'Russo named England player of the year',
          'Arsenal forward Alessia Russo is named England women’s player of the year after scoring five goals in 10 games.',
        ),
      ).toEqual([]);
      expect(
        await filed('Unwanted stat emerges after Arsenal Women’s latest UWCL struggle 😓'),
      ).toEqual([]);
      // We hold a women's Spain here, so the women's match is filed under it.
      expect(
        await filed(
          'Spain strike first and beat the United States in Washington',
          'The Spain women’s national team, led by Sonia Bermúdez, beat the United States 2-0 ...',
        ),
      ).toEqual([ids.spainWomen]);
      expect(
        await filed(
          'USWNT has multiple scoring opportunities but falls to Spain, 2-0',
          'It was just the third time in 96 matches over 5½ years the U.S. trailed by multiple goals.',
        ),
      ).toEqual([ids.spainWomen]);
    });

    it('does not file an age group under the senior side', async () => {
      expect(await filed('🚨 Confirmed XI: Spain U21s must not slip up in Serravalle')).toEqual([]);
      expect(await filed('Max Dowman given ‘harsh’ straight red for England u19s v USA')).toEqual(
        [],
      );
      // Written for the spec.
      expect(await filed('Wales Under-23s gather for camp, England Under-21s next')).toEqual([]);
    });

    it('reads a shortened club name only where it cannot be the noun', async () => {
      for (const [headline, summary] of [
        [
          '⚔️ Fla-Flu, Derby and Gre-Nal: share your predictions for today’s derbies',
          'The Brasileirão will feature THREE derbies this Sunday (11), all at 5:30 p.m. There’s Fla-Flu in Rio, the São Paulo Derby and Gre-Nal in the south.',
        ],
        [
          'Christoph Zimmermann: “In The East Anglia Derby The Table Never Mattered, It’s The Biggest Fight”',
          'By Ben McFadyean.Germany made good on their loss against Greece ...',
        ],
        [
          '🤔 Derby weekend and European football feature in the quiz of the week',
          'Kick off your Monday with the Quiz of the Week on OneFootball.The Brasileirão returned with a bang ...',
        ],
        [
          'Derby defeat ‘one that got away’ for Pompey',
          'BBC Radio Solent’s Portsmouth commentator Andrew Moon reflects on Pompey’s defeat by Southampton in the Championship.',
        ],
        // The Title Case form of a production headline (written for the spec).
        ['10-Man Southampton Battle To Derby Win In Eckert’s First Game', null],
        [
          'Junior boys soccer forward’s hat trick leads East Brunswick past Manalapan',
          'East Brunswick hands Manalapan its first loss of the season.',
        ],
      ] as const) {
        expect(await filed(headline, summary), headline).toEqual([]);
      }
      // The club, where the words say it is the club.
      for (const [headline, summary] of [
        [
          'How perfect storm has rained on Derby’s parade',
          'BBC Sport looks at how Turki Alalshikh’s aborted takeover of Derby County has contributed to a poor start to their Championship season.',
        ],
        [
          'Difficult for Derby to build on last term - Eustace',
          'Head coach John Eustace says the "realism" at Derby County is that they will find it hard ...',
        ],
        [
          'Pick of the stats: Derby County v Wrexham',
          'The key stats before Derby County’s clash with Wrexham in the Championship on Saturday.',
        ],
        // First word, with the summary naming the club (written for the spec).
        ['Derby sack John Eustace after six straight defeats', 'Derby County have dismissed ...'],
      ] as const) {
        expect(await filed(headline, summary), headline).toEqual([ids.derby]);
      }
    });

    it('re-checks the links already stored by the same rule, as the migration does', async () => {
      const { id } = await store.upsertArticle(
        source,
        randomUUID(),
        `https://context.test/${randomUUID()}`,
      );
      stories.push(await store.storyOf(id));
      await store.addVersion(id, 'en', 1, {
        headline: 'Meanwhile in England: Premier League giants at their worst in decades',
        summary: null,
        byline: null,
        published_at: AT,
      });
      await pool.query(
        `INSERT INTO article_entity (article_id, entity_type, entity_id) VALUES ($1, 'team', $2)`,
        [id, ids.england],
      );
      const { rows } = await pool.query(`SELECT * FROM news_named_entities($1, $2, true)`, [
        id,
        MINIMUM_NAME_LENGTH,
      ]);
      expect(rows).toEqual([]);
    });
  },
);
