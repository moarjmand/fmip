import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CatalogModule } from './catalog.module';

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('GET /countries', () => {
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
});
