import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { AskResponse } from '@fmip/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import {
  AbsentIntelligence,
  type Completion,
  type CompletionRequest,
  type Intelligence,
  LANGUAGE_MODEL,
} from '../intelligence/intelligence.port';
import { AskModule } from './ask.module';
import { readIntent } from './ask.service';

/**
 * Natural-language search through the API (T-420 to T-422), with a scripted
 * model against the seed: a readable intent finds Liverpool by id and says
 * how the question was read; an unreadable answer, a refusal and a call
 * that fails each fall back to keywords with the reason; a deployment with
 * no model is keyword search with one sentence more; and the reading is
 * strict about what it accepts.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const LIVERPOOL = '00000000-0000-4000-8000-000000000602';

describe('readIntent', () => {
  it('accepts exactly the schema, with or without a code fence, and nothing else', () => {
    expect(readIntent('{"names":["Liverpool"],"types":["team"]}')).toEqual({
      names: ['Liverpool'],
      types: ['team'],
    });
    expect(readIntent('```json\n{"names": ["Salah", "Liverpool"], "types": []}\n```')).toEqual({
      names: ['Salah', 'Liverpool'],
      types: [],
    });
    for (const bad of [
      'Liverpool are a team.',
      '{"names":["Liverpool"]}',
      '{"names":["Liverpool"],"types":["club"]}',
      '{"names":["Liverpool"],"types":["team"],"answer":"yes"}',
      '{"names":["L"],"types":[]}',
      '{"names":"Liverpool","types":[]}',
      '[]',
    ]) {
      expect(readIntent(bad), bad).toBeNull();
    }
  });
});

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('ask', () => {
  let app: NestFastifyApplication;
  let absent: NestFastifyApplication;
  let script: Completion = {
    text: '',
    model: 'scripted-1',
    stop: 'end_turn',
    input_tokens: 10,
    output_tokens: 5,
  };
  let fail = false;
  const asked: CompletionRequest[] = [];
  const scripted: Intelligence = {
    model: {
      provider: 'scripted',
      model: 'scripted-1',
      complete: async (request) => {
        asked.push(request);
        if (fail) throw new Error('unreachable');
        return script;
      },
    },
  };

  async function boot(intelligence: Intelligence): Promise<NestFastifyApplication> {
    const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, AskModule] })
      .overrideProvider(LANGUAGE_MODEL)
      .useValue(intelligence)
      .compile();
    const application = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await application.init();
    await application.getHttpAdapter().getInstance().ready();
    return application;
  }

  const ask = async (application: NestFastifyApplication, q: string) => {
    const response = await application.inject({
      method: 'GET',
      url: `/ask?q=${encodeURIComponent(q)}`,
    });
    return { status: response.statusCode, body: response.json<AskResponse>() };
  };

  beforeAll(async () => {
    app = await boot(scripted);
    absent = await boot(new AbsentIntelligence());
  });

  afterAll(async () => {
    await app.close();
    await absent.close();
  });

  it('reads the question into names and kinds, answers with the search by id, and says how it read it', async () => {
    script = { ...script, text: '{"names":["Liverpool"],"types":["team"]}', stop: 'end_turn' };
    const { status, body } = await ask(app, 'Who are Liverpool playing next?');
    expect(status).toBe(200);
    expect(body.interpretation).toMatchObject({
      coverage: 'available',
      data: { names: ['Liverpool'], types: ['team'] },
    });
    expect(body.reason).toBeNull();
    expect(body.results.map((r) => r.id)).toContain(LIVERPOOL);
    expect(body.results.every((r) => r.type === 'team')).toBe(true);
    // The model is asked the question and nothing else; the instruction is the standing one.
    const request = asked[asked.length - 1]!;
    expect(request.prompt).toBe('Who are Liverpool playing next?');
    expect(request.system).toContain('Do not answer the question');
  });

  it('falls back to keywords with the reason when the answer is unreadable, refused, or the call fails', async () => {
    script = { ...script, text: 'Liverpool are playing Everton.', stop: 'end_turn' };
    expect((await ask(app, 'Liverpool')).body).toMatchObject({
      interpretation: { coverage: 'not_supplied', data: null },
      reason: 'unreadable',
    });
    script = { ...script, text: '', stop: 'refusal' };
    expect((await ask(app, 'Liverpool')).body.reason).toBe('unreadable');
    script = { ...script, text: '{"names":[],"types":["team"]}', stop: 'end_turn' };
    expect((await ask(app, 'Who is the best?')).body.reason).toBe('nothing_named');
    fail = true;
    const failed = await ask(app, 'Liverpool');
    fail = false;
    expect(failed.body.reason).toBe('failed');
    expect(failed.body.results.map((r) => r.id)).toContain(LIVERPOOL);
  });

  it('is keyword search with one sentence more on a deployment with no model, and refuses a question that is not one', async () => {
    const { body } = await ask(absent, 'Liverpool');
    expect(body.reason).toBe('no_model');
    expect(body.interpretation.coverage).toBe('not_supplied');
    expect(body.results.map((r) => r.id)).toContain(LIVERPOOL);
    expect((await ask(absent, 'L')).status).toBe(400);
    expect((await ask(absent, 'x'.repeat(201))).status).toBe(400);
  });
});
