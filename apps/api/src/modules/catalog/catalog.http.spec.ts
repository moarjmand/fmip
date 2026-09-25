import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CatalogModule } from './catalog.module';

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('catalog reads', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, CatalogModule],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists the seeded countries by name, with codes and no provider fields', async () => {
    const response = await app.inject({ method: 'GET', url: '/countries' });

    expect(response.statusCode).toBe(200);
    const { countries } = response.json() as { countries: { code: string; name: string }[] };
    const names = countries.map((c) => c.name);

    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(countries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ENG', iso2: null, name: 'England' }),
        expect.objectContaining({ code: 'IRN', iso2: 'IR', name: 'Iran' }),
      ]),
    );
    expect(Object.keys(countries[0] ?? {}).sort()).toEqual(['code', 'id', 'iso2', 'name']);
  });

  /**
   * Registration offers these rows and requires one, so a database the seed
   * never touched -- every production one -- must hold them from its
   * migrations (D-078). The first production deploy found the list empty.
   */
  it('offers every FIFA member association, in the order a reader expects', async () => {
    const response = await app.inject({ method: 'GET', url: '/countries' });
    const { countries } = response.json() as {
      countries: { code: string; iso2: string | null; name: string }[];
    };
    const codes = new Set(countries.map((c) => c.code));
    for (const code of ['AFG', 'CIV', 'ENG', 'IRN', 'KVX', 'SCO', 'TAH', 'USA', 'ZIM']) {
      expect(codes.has(code)).toBe(true);
    }
    expect(countries.filter((c) => /^[A-Z]{3}$/.test(c.code)).length).toBeGreaterThanOrEqual(211);
    // Kosovo is a FIFA member without an ISO 3166 code; nothing is invented.
    expect(countries.find((c) => c.code === 'KVX')).toMatchObject({ iso2: null, name: 'Kosovo' });

    // Byte order would put these after "Czechia" and "Turks and Caicos Islands".
    const names = countries.map((c) => c.name);
    const at = (name: string) => names.indexOf(name);
    expect(at('Costa Rica')).toBeLessThan(at("Côte d'Ivoire"));
    expect(at("Côte d'Ivoire")).toBeLessThan(at('Croatia'));
    expect(at('Tunisia')).toBeLessThan(at('Türkiye'));
    expect(at('Türkiye')).toBeLessThan(at('Turkmenistan'));
  });

  it('lists active teams and competitions by name for the follow controls', async () => {
    const teams = await app.inject({ method: 'GET', url: '/teams' });
    const competitions = await app.inject({ method: 'GET', url: '/competitions' });

    expect(teams.statusCode).toBe(200);
    expect(teams.json().teams).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Liverpool', code: 'LIV', kind: 'club' }),
        expect.objectContaining({ name: 'Iran', kind: 'national' }),
      ]),
    );
    expect(competitions.json().competitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Premier League', short_name: 'PL', scope: 'domestic' }),
        expect.objectContaining({
          name: 'UEFA Champions League',
          scope: 'continental',
          country_id: null,
        }),
      ]),
    );
  });
});
