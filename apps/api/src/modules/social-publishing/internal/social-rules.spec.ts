import { describe, expect, it } from 'vitest';
import type { SocialCardPayload, SocialPostKind } from '@fmip/contracts';
import {
  SOCIAL_DAILY_CAP,
  SOCIAL_ELIGIBLE_RUN,
  SOCIAL_NETWORKS,
  SOCIAL_POST_FINAL_STATES,
  SOCIAL_POST_STATES,
  SOCIAL_SENSITIVE_TOPICS,
} from '@fmip/contracts/console';
import {
  type AutomationState,
  type SocialCandidate,
  type SocialFacts,
  FORECAST_FRESH_MS,
  RESULT_SETTLED_MS,
  X_MAX_LENGTH,
  afterEvent,
  approver,
  backToPerson,
  buildBody,
  canMove,
  checkGates,
  checkLevelChange,
  checkPersonApproval,
  checkRejection,
  checkSwitch,
  dueSlot,
  expiresAt,
  isEligible,
  londonDay,
  nextToPublish,
  publishingOutcome,
  rankCandidates,
  sensitiveTopicsIn,
  sensitivity,
  withoutOwnNames,
  slotInstants,
  templateVersion,
  xLength,
} from './social-rules';

const NOW = new Date('2026-11-14T15:00:00.000Z');
const ago = (ms: number): string => new Date(NOW.getTime() - ms).toISOString();
const MINUTE = 60_000;

function facts(kind: SocialPostKind, change: Partial<SocialFacts> = {}): SocialFacts {
  const finished = kind !== 'forecast_pre_match';
  return {
    kind,
    fixture: {
      status: finished ? 'finished' : 'scheduled',
      kick_off: finished ? ago(150 * MINUTE) : new Date(NOW.getTime() + 2 * 3600_000).toISOString(),
      coverage: 'available',
      last_updated_at: finished ? ago(45 * MINUTE) : ago(10 * MINUTE),
      score_dispute: false,
    },
    forecast: kind === 'result' ? null : { id: 'f-1', version: 'v3.2', status: 'available' },
    shown_forecast: kind === 'result' ? null : { id: 'f-1', version: 'v3.2' },
    evaluation: kind === 'model_verdict' ? { forecast_id: 'f-1', correct: true } : null,
    products: kind === 'result' ? [] : ['model'],
    ...change,
  };
}

const withFixture = (
  kind: SocialPostKind,
  change: Partial<SocialFacts['fixture']>,
): SocialFacts => {
  const base = facts(kind);
  return { ...base, fixture: { ...base.fixture, ...change } };
};

describe('checkGates (T-1834, D-427 point 3)', () => {
  it.each(['forecast_pre_match', 'model_verdict', 'result'] as const)(
    'passes a clean %s',
    (kind) => {
      expect(checkGates(facts(kind), NOW)).toEqual({
        checked_at: NOW.toISOString(),
        passed: true,
        failed: [],
      });
    },
  );

  it.each(['limited', 'not_supplied', 'delayed'] as const)(
    'refuses coverage %s alone',
    (coverage) => {
      for (const kind of ['forecast_pre_match', 'model_verdict', 'result'] as const) {
        expect(checkGates(withFixture(kind, { coverage }), NOW).failed).toEqual(['coverage']);
      }
    },
  );

  it.each(['postponed', 'suspended', 'abandoned', 'cancelled', 'awarded', 'live'] as const)(
    'gives a %s match no post of any kind',
    (status) => {
      for (const kind of ['forecast_pre_match', 'model_verdict', 'result'] as const) {
        expect(checkGates(withFixture(kind, { status }), NOW).failed).toEqual(['fixture_status']);
      }
    },
  );

  it('refuses a forecast post once kick-off has passed', () => {
    const check = checkGates(withFixture('forecast_pre_match', { kick_off: ago(MINUTE) }), NOW);
    expect(check.failed).toEqual(['fixture_status']);
  });

  it('refuses a result not yet settled 30 minutes, and passes it at 30', () => {
    const early = withFixture('result', { last_updated_at: ago(RESULT_SETTLED_MS - MINUTE) });
    expect(checkGates(early, NOW).failed).toEqual(['freshness']);
    const settled = withFixture('result', { last_updated_at: ago(RESULT_SETTLED_MS) });
    expect(checkGates(settled, NOW).passed).toBe(true);
  });

  it('refuses a forecast post whose fixture was read more than six hours ago', () => {
    const stale = withFixture('forecast_pre_match', {
      last_updated_at: ago(FORECAST_FRESH_MS + MINUTE),
    });
    expect(checkGates(stale, NOW).failed).toEqual(['freshness']);
  });

  it('refuses a missing or future last_updated_at as not fresh', () => {
    expect(checkGates(withFixture('result', { last_updated_at: null }), NOW).failed).toEqual([
      'freshness',
    ]);
    const future = new Date(NOW.getTime() + MINUTE).toISOString();
    expect(
      checkGates(withFixture('forecast_pre_match', { last_updated_at: future }), NOW).failed,
    ).toEqual(['freshness']);
  });

  it('refuses a score dispute alone', () => {
    expect(checkGates(withFixture('result', { score_dispute: true }), NOW).failed).toEqual([
      'score_dispute',
    ]);
    expect(checkGates(withFixture('model_verdict', { score_dispute: true }), NOW).failed).toEqual([
      'score_dispute',
    ]);
  });

  it('refuses a forecast that is not the one the match page shows', () => {
    const otherId = facts('forecast_pre_match', { shown_forecast: { id: 'f-2', version: 'v3.2' } });
    const otherVersion = facts('model_verdict', { shown_forecast: { id: 'f-1', version: 'v3.3' } });
    const none = facts('forecast_pre_match', { shown_forecast: null });
    for (const f of [otherId, none]) expect(checkGates(f, NOW).failed).toEqual(['forecast_shown']);
    expect(checkGates(otherVersion, NOW).failed).toEqual(['forecast_shown']);
  });

  it('gives no forecast post without an available forecast', () => {
    const absent = facts('forecast_pre_match', { forecast: null });
    const unavailable = facts('forecast_pre_match', {
      forecast: { id: 'f-1', version: 'v3.2', status: 'unavailable' },
    });
    expect(checkGates(absent, NOW).failed).toEqual(['forecast_shown']);
    expect(checkGates(unavailable, NOW).failed).toEqual(['forecast_shown']);
  });

  it('gives a verdict only from a stored evaluation of that forecast', () => {
    expect(checkGates(facts('model_verdict', { evaluation: null }), NOW).failed).toEqual([
      'evaluation_stored',
    ]);
    const other = facts('model_verdict', { evaluation: { forecast_id: 'f-9', correct: true } });
    expect(checkGates(other, NOW).failed).toEqual(['evaluation_stored']);
  });

  it('keeps one prediction product a post (rule 6)', () => {
    expect(checkGates(facts('result', { products: ['model'] }), NOW).failed).toEqual([
      'one_product',
    ]);
    expect(
      checkGates(facts('forecast_pre_match', { products: ['model', 'community'] }), NOW).failed,
    ).toEqual(['one_product']);
    expect(checkGates(facts('model_verdict', { products: ['founder'] }), NOW).failed).toEqual([
      'one_product',
    ]);
    expect(checkGates(facts('model_verdict', { products: [] }), NOW).failed).toEqual([
      'one_product',
    ]);
  });

  it('ends a post whose gates fail at publishing: superseded for a changed forecast, else expired', () => {
    expect(publishingOutcome(checkGates(facts('result'), NOW))).toBe('publish');
    const changed = facts('forecast_pre_match', { shown_forecast: { id: 'f-2', version: 'v3.2' } });
    expect(publishingOutcome(checkGates(changed, NOW))).toBe('superseded');
    expect(publishingOutcome(checkGates(withFixture('result', { score_dispute: true }), NOW))).toBe(
      'expired',
    );
  });
});

describe('expiresAt', () => {
  it('ends a forecast post at kick-off', () => {
    expect(expiresAt('forecast_pre_match', '2026-11-14T20:00:00.000Z', NOW).toISOString()).toBe(
      '2026-11-14T20:00:00.000Z',
    );
  });

  it('keeps a verdict or result until 16:30 London time the next day, in winter and in summer', () => {
    expect(expiresAt('result', '', NOW).toISOString()).toBe('2026-11-15T16:30:00.000Z');
    // 22:00 London on 1 July: valid through the next morning's slots.
    const summer = new Date('2026-07-01T21:00:00.000Z');
    expect(expiresAt('model_verdict', '', summer).toISOString()).toBe('2026-07-02T15:30:00.000Z');
  });

  it('lets an evening match’s results take the next morning’s slots instead of all racing for the last one', () => {
    // A 20:00 kick-off settles about 22:25 London: the last slot (21:45) has passed.
    const settled = new Date('2026-11-14T22:25:00.000Z');
    const expiry = expiresAt('result', '', settled).toISOString();
    const morning = new Date('2026-11-15T08:35:00.000Z');
    const results = ['r1', 'r2'].map((id) => ({
      id,
      kind: 'result' as const,
      competition_rank: 1,
      kick_off: '2026-11-14T20:00:00.000Z',
      expires_at: expiry,
    }));
    expect(nextToPublish(results, morning, [])?.slot).toBe(1);
    expect(nextToPublish(results, new Date('2026-11-15T12:05:00.000Z'), [1])?.slot).toBe(2);
  });
});

describe('sensitivity (D-427 point 5)', () => {
  const examples: Record<(typeof SOCIAL_SENSITIVE_TOPICS)[number], string[]> = {
    politics: [
      'Club caught in political row',
      'Politicians react to final',
      'Election delays cup draw',
      'Government steps in over stadium',
      'Sanctions hit owner',
      'War forces match to move',
      'Club raises funds for Gaza',
      'Iran sanctions hit the federation',
      'Iran players stay silent during anthem',
      'Russian side banned again',
      'Fans protest against ticket prices',
      'Ceasefire talks halt league',
    ],
    accident: [
      'Team bus crash on motorway',
      'Player hurt in accident',
      'Tragedy before kick-off',
      'A tragic night',
      'Midfielder collapses on pitch, taken to hospital',
      'Keeper suffers cardiac arrest',
      'Coach in intensive care',
    ],
    death: [
      'Former captain dies aged 70',
      'Legend died on Sunday',
      'Death of club founder',
      'Fan killed outside ground',
      'Coach passed away',
      "Minute's silence for victims",
      'Minute’s silence held',
      'Minute of silence at Anfield',
      'Funeral held for striker',
      'Dead after collapse',
      'Former striker passes away at 54',
      'City mourns its captain',
      'Tributes paid, RIP legend',
      'Condolences to the family',
    ],
    racism: [
      'Racist chants reported',
      'Club condemns racism',
      'Racially abused online',
      'Player suffers abuse',
      'Discrimination charge',
      'Homophobic chanting investigated',
      'Antisemitic banner removed',
      'Sexist remarks by pundit',
      'Slur aimed at winger',
    ],
    violence: [
      'Fan stabbed outside stadium',
      'Terror alert delays kick-off',
      'Riot police called to derby',
      'Two arrested after assault on steward',
      'Violence mars cup tie',
      'Hooligans clash in city centre',
      'Gunman sparks stadium lockdown',
    ],
    betting: [
      'Midfielder banned for betting',
      'Bet placed on booking',
      'Odds slashed on title',
      'Bookmakers suspend market',
      'Gambling sponsor deal',
      'Wager row',
    ],
  };

  it.each(SOCIAL_SENSITIVE_TOPICS)('flags each %s word', (topic) => {
    for (const headline of examples[topic]) {
      expect(sensitivity([headline]), headline).toBe(topic);
    }
  });

  it('counts a failed headline read as sensitive (fail closed)', () => {
    expect(sensitivity(null)).toBe('headlines_unreadable');
  });

  it('passes ordinary headlines and an empty list', () => {
    expect(sensitivity([])).toBeNull();
    expect(
      sensitivity([
        'Arsenal crash out of the cup',
        'A dead ball specialist',
        'Die-hard fans travel north',
        'Better late than never for Spurs',
        'Bookings pile up in derby',
        'A dead rubber in Group B',
        'Late collapse costs Spurs',
        'The big guns meet at Anfield',
        'Gunners top the table',
        'A killer pass from Odegaard',
        'Attacking midfielder signs',
        'Shooting practice pays off',
        'He takes a stab at the title',
      ]),
    ).toBeNull();
  });

  it('reports the first topic found across the headlines', () => {
    expect(sensitivity(['Arsenal win', 'Betting probe opens', 'War of words'])).toBe('betting');
  });

  describe('a country’s own matches (review of PR #893, round 2)', () => {
    const iranQatar = { names: ['Iran', 'IRN', 'Qatar', 'QAT', 'World Cup Qualification'] };
    const persepolis = { names: ['Persepolis', 'PER', 'Sepahan', 'Persian Gulf Pro League'] };
    const ukraine = { names: ['Ukraine', 'UKR', 'Iceland', 'ISL', 'UEFA Nations League'] };
    const zenit = { names: ['Zenit', 'Spartak Moscow', 'Spartak', 'Russian Premier League'] };
    const israel = { names: ['Israel', 'ISR', 'Norway', 'NOR', 'World Cup Qualification'] };
    const cases: [string, { names: string[] }][] = [
      ['Iran beat Qatar 2-1 in World Cup qualifier', iranQatar],
      ['Taremi double sends Iran top of group', iranQatar],
      ['Iranian giants Persepolis sign striker', persepolis],
      ['Esteghlal 1-0 Sepahan: Persian Gulf Pro League round-up', persepolis],
      ['Persepolis win Tehran derby', persepolis],
      ['Team Melli squad announced', iranQatar],
      ['Ukraine 2-0 Iceland: Mudryk scores', ukraine],
      ['Zenit lead the Russian Premier League', zenit],
      ['Israel lose to Norway in qualifier', israel],
    ];

    it.each(cases)('lets "%s" go out, with or without the match’s names', (headline, context) => {
      expect(sensitivity([headline], context)).toBeNull();
      expect(sensitivity([headline])).toBeNull();
    });

    it('still sends a political headline about the same country to a person', () => {
      expect(sensitivity(['Iran players stay silent during anthem'], iranQatar)).toBe('politics');
      expect(sensitivity(['Iran sanctions hit the federation'], iranQatar)).toBe('politics');
      expect(sensitivity(['Iran banned from the World Cup'], iranQatar)).toBe('politics');
      expect(sensitivity(['Ukraine plays in the shadow of war'], ukraine)).toBe('politics');
      expect(sensitivity(['Election moves Israel match'], israel)).toBe('politics');
      expect(sensitivity(['Russian clubs suspended from Europe again'])).toBe('politics');
    });

    it('takes out a club’s or competition’s own name, not a word beside it', () => {
      const kenya = { names: ['Kenya Police', 'KPF', 'Gor Mahia', 'Kenyan Premier League'] };
      expect(sensitivity(['Kenya Police beat Gor Mahia'], kenya)).toBeNull();
      expect(sensitivity(['Kenya Police beat Gor Mahia'])).toBe('violence');
      expect(sensitivity(['Police called after Kenya Police match'], kenya)).toBe('violence');
      expect(withoutOwnNames('ARS beat the arsenal of rivals', { names: ['ARS'] })).toBe(
        '  beat the arsenal of rivals',
      );
    });
  });

  it('keeps football’s own phrases out of violence, death, accident and politics', () => {
    for (const headline of [
      'Red card for violent conduct',
      'City look to arrest slump',
      'Arsenal title assault gathers pace',
      'Liverpool launch assault on the top four',
      'Wolves run riot at Molineux',
      'Hospital pass costs Spurs',
      'Players protest penalty decision',
      'Club pays tribute to departing captain',
      'Memorial Cup final preview',
      'Pep: we killed the game',
    ]) {
      expect(sensitivity([headline]), headline).toBeNull();
    }
  });
});

const team = (name: string, short: string | null = null, code: string | null = null) => ({
  id: `id-${name}`,
  name,
  short_name: short,
  code,
});
const base = {
  fixture_id: 'fx-1',
  competition: { id: 'c-1', name: 'Premier League' },
  kick_off: '2026-11-14T20:00:00.000Z',
  home: team('Arsenal', null, 'ARS'),
  away: team('Chelsea', null, 'CHE'),
};
const model = { name: 'The Stadiomind model' as const, version: 'v3.2', forecast_id: 'f-1' };
const payloads = {
  forecast_pre_match: {
    ...base,
    kind: 'forecast_pre_match',
    model,
    percent: { home: 48, draw: 27, away: 25 },
  },
  model_verdict: {
    ...base,
    kind: 'model_verdict',
    model,
    score: { home: 2, away: 1 },
    called: 'home',
    called_percent: 48,
    correct: true,
    after_extra_time: false,
  },
  result: {
    ...base,
    kind: 'result',
    score: { home: 2, away: 1 },
    after_extra_time: false,
    penalties: null,
  },
} satisfies Record<SocialPostKind, SocialCardPayload>;
const LINK = 'https://traveltohormuz.ir/en/matches/fx-1';

describe('buildBody, the fixed templates', () => {
  it('writes each kind for X with the link and for Instagram with none', () => {
    for (const kind of Object.keys(payloads) as SocialPostKind[]) {
      const x = buildBody(payloads[kind], 'x', LINK)!;
      const ig = buildBody(payloads[kind], 'instagram', LINK)!;
      expect(x.body.endsWith(LINK)).toBe(true);
      expect(ig.body).not.toMatch(/https?:/);
      expect(x.template_version).toBe(`${kind}@1`);
      expect(templateVersion(kind)).toBe(`${kind}@1`);
    }
  });

  it('words the forecast as the model with its version and kick-off in UK time', () => {
    expect(buildBody(payloads.forecast_pre_match, 'instagram', LINK)!.body).toBe(
      [
        'Arsenal v Chelsea',
        'Premier League · Kick-off 20:00 UK time',
        '',
        'The Stadiomind model (v3.2):',
        'Arsenal win 48% · Draw 27% · Chelsea win 25%',
      ].join('\n'),
    );
    const summer = { ...payloads.forecast_pre_match, kick_off: '2026-07-01T19:00:00.000Z' };
    expect(buildBody(summer, 'instagram', LINK)!.body).toContain('Kick-off 20:00 UK time');
  });

  it('says whether the model was right from the stored evaluation', () => {
    const right = buildBody(payloads.model_verdict, 'instagram', LINK)!.body;
    expect(right).toContain('The Stadiomind model (v3.2) pick: Arsenal win (48%)');
    expect(right).toContain('Yes: it got this one right.');
    const wrong = buildBody(
      { ...payloads.model_verdict, correct: false, called: 'draw', called_percent: 27 },
      'instagram',
      LINK,
    )!.body;
    expect(wrong).toContain('pick: Draw (27%)');
    expect(wrong).toContain('No: it got this one wrong.');
  });

  it('names the 90-minute score a verdict was judged on when the match went further (D-317)', () => {
    // 1-1 at 90, 2-1 after extra time: the model's draw was right on the 90 minutes.
    const body = buildBody(
      {
        ...payloads.model_verdict,
        score: { home: 1, away: 1 },
        after_extra_time: true,
        called: 'draw',
        called_percent: 31,
        correct: true,
      },
      'instagram',
      LINK,
    )!.body;
    expect(body).toContain('Arsenal 1–1 Chelsea after 90 minutes · Premier League');
    expect(body).toContain('pick: Draw (31%)');
    expect(body).not.toContain('2–1');
    const regular = buildBody(payloads.model_verdict, 'instagram', LINK)!.body;
    expect(regular).not.toContain('after 90 minutes');
  });

  it('writes a result after extra time and on penalties as the match page does', () => {
    const body = buildBody(
      {
        ...payloads.result,
        score: { home: 1, away: 1 },
        after_extra_time: true,
        penalties: { home: 3, away: 4 },
      },
      'instagram',
      LINK,
    )!.body;
    expect(body).toBe(
      [
        'Full time: Arsenal 1–1 Chelsea (aet)',
        'Chelsea won 4–3 on penalties',
        'Premier League',
      ].join('\n'),
    );
  });

  it('names no prediction product on the result (rule 6)', () => {
    for (const network of SOCIAL_NETWORKS) {
      expect(buildBody(payloads.result, network, LINK)!.body).not.toMatch(
        /model|forecast|founder|community|%/i,
      );
    }
  });

  it('touches no sensitive topic in any template, on either network', () => {
    for (const kind of Object.keys(payloads) as SocialPostKind[]) {
      for (const network of SOCIAL_NETWORKS) {
        for (const correct of [true, false]) {
          const payload =
            payloads[kind].kind === 'model_verdict'
              ? { ...payloads.model_verdict, correct }
              : payloads[kind];
          expect(sensitiveTopicsIn(buildBody(payload, network, LINK)!.body)).toEqual([]);
        }
      }
    }
  });

  it('counts a link as 23 on X, takes the short names when the full ones do not fit, and gives up beyond', () => {
    expect(xLength(`ab ${LINK}`)).toBe(3 + 23);
    expect(xLength('中')).toBe(2);
    const long = 'A'.repeat(100);
    const tight = {
      ...payloads.forecast_pre_match,
      home: team(long, 'Short Home'),
      away: team(long, 'Short Away'),
    };
    const built = buildBody(tight, 'x', LINK)!;
    expect(built.body).toContain('Short Home v Short Away');
    expect(xLength(built.body)).toBeLessThanOrEqual(X_MAX_LENGTH);
    const hopeless = { ...tight, home: team(long, long), away: team(long, long) };
    expect(buildBody(hopeless, 'x', LINK)).toBeNull();
    expect(buildBody(hopeless, 'instagram', LINK)).not.toBeNull();
  });

  it('carries no image address in any payload', () => {
    for (const payload of Object.values(payloads)) {
      const text = JSON.stringify(payload);
      // The same two patterns as the migration's CHECK `social_post_payload_no_image`.
      expect(text).not.toMatch(/"[a-z_]*(image|img|crest|logo|photo|picture|url|src)[a-z_]*"\s*:/i);
      expect(text).not.toMatch(/"\s*(https?:|data:|\/\/)/i);
    }
  });
});

describe('the daily cap as slots of a London day (D-427 point 4)', () => {
  const at = (iso: string): Date => new Date(iso);

  it('places the slots in London time across both changes of the clocks', () => {
    // 2026-03-29 and 2026-10-25 are the changes.
    expect(slotInstants('2026-03-28')[0]!.toISOString()).toBe('2026-03-28T08:30:00.000Z');
    expect(slotInstants('2026-03-29')[0]!.toISOString()).toBe('2026-03-29T07:30:00.000Z');
    expect(slotInstants('2026-10-24')[4]!.toISOString()).toBe('2026-10-24T20:45:00.000Z');
    expect(slotInstants('2026-10-25')[4]!.toISOString()).toBe('2026-10-25T21:45:00.000Z');
    expect(slotInstants('2026-11-14')).toHaveLength(SOCIAL_DAILY_CAP);
  });

  it('resets the day at midnight London time, not UTC', () => {
    expect(londonDay(at('2026-07-01T23:30:00.000Z'))).toBe('2026-07-02');
    expect(londonDay(at('2026-12-01T23:30:00.000Z'))).toBe('2026-12-01');
  });

  it('gives the latest slot whose time has come, once', () => {
    expect(dueSlot(at('2026-11-14T12:05:00.000Z'), [])).toEqual({
      post_day: '2026-11-14',
      slot: 2,
    });
    expect(dueSlot(at('2026-11-14T12:05:00.000Z'), [2])).toBeNull();
    // Summer: 12:05 London is 11:05 UTC.
    expect(dueSlot(at('2026-07-01T11:05:00.000Z'), [1])).toEqual({
      post_day: '2026-07-01',
      slot: 2,
    });
  });

  it('does not catch up a missed slot', () => {
    expect(dueSlot(at('2026-11-14T16:40:00.000Z'), [])).toEqual({
      post_day: '2026-11-14',
      slot: 3,
    });
  });

  it('publishes nothing between 23:00 and 07:00 or before the first slot', () => {
    for (const iso of [
      '2026-11-14T23:00:00.000Z',
      '2026-11-15T03:00:00.000Z',
      '2026-11-15T06:59:00.000Z',
    ]) {
      expect(dueSlot(at(iso), [])).toBeNull();
    }
    expect(dueSlot(at('2026-11-15T08:00:00.000Z'), [])).toBeNull();
    // Summer: 22:30 UTC is 23:30 in London.
    expect(dueSlot(at('2026-07-01T22:30:00.000Z'), [])).toBeNull();
  });

  it('never gives a sixth slot', () => {
    expect(dueSlot(at('2026-11-14T22:00:00.000Z'), [1, 2, 3, 4, 5])).toBeNull();
    const slots = new Set<number>();
    for (let m = 0; m < 24 * 60; m += 5) {
      const now = new Date(Date.parse('2026-11-14T00:00:00.000Z') + m * MINUTE);
      const due = dueSlot(now, [...slots]);
      if (due !== null) slots.add(due.slot);
    }
    expect([...slots]).toEqual([1, 2, 3, 4, 5]);
  });

  const candidate = (id: string, change: Partial<SocialCandidate> = {}): SocialCandidate => ({
    id,
    kind: 'result',
    competition_rank: 1,
    kick_off: '2026-11-14T15:00:00.000Z',
    expires_at: '2026-11-15T00:00:00.000Z',
    ...change,
  });

  it('ranks by competition order, then kick-off, then kind', () => {
    const ranked = rankCandidates([
      candidate('d', { competition_rank: null }),
      candidate('c', { competition_rank: 2 }),
      candidate('b', { kick_off: '2026-11-14T12:30:00.000Z' }),
      candidate('a2', { kind: 'model_verdict' }),
      candidate('a1', { kind: 'forecast_pre_match' }),
    ]);
    expect(ranked.map((c) => c.id)).toEqual(['b', 'a1', 'a2', 'c', 'd']);
  });

  it('gives fewer posts for fewer candidates and never pads', () => {
    const noon = at('2026-11-14T12:05:00.000Z');
    expect(nextToPublish([], noon, [])).toBeNull();
    const expired = candidate('x', { expires_at: '2026-11-14T12:00:00.000Z' });
    expect(nextToPublish([expired], noon, [])).toBeNull();
    expect(nextToPublish([expired, candidate('y')], noon, [1])).toEqual({
      post: candidate('y'),
      post_day: '2026-11-14',
      slot: 2,
    });
  });
});

describe('the state machine', () => {
  it('ends published, rejected, expired and superseded posts for good', () => {
    for (const from of SOCIAL_POST_FINAL_STATES) {
      for (const to of SOCIAL_POST_STATES) expect(canMove(from, to)).toBe(false);
    }
  });

  it('publishes only through a claim, and never retries an unknown one by itself', () => {
    expect(canMove('approved', 'published')).toBe(false);
    expect(canMove('pending_approval', 'publishing')).toBe(false);
    expect(canMove('approved', 'publishing')).toBe(true);
    expect(canMove('unknown', 'publishing')).toBe(false);
    expect(canMove('unknown', 'published')).toBe(true);
    expect(canMove('refused', 'publishing')).toBe(true);
    expect(canMove('publishing', 'publishing')).toBe(false);
  });

  it('sends a refused post back to a person, and lets a person reject any post not yet claimed', () => {
    expect(canMove('refused', 'pending_approval')).toBe(true);
    for (const from of ['pending_approval', 'approved', 'refused'] as const) {
      expect(canMove(from, 'rejected')).toBe(true);
      expect(checkRejection(from, 'not this one')).toEqual({ ok: true });
    }
    for (const from of ['publishing', 'unknown'] as const) {
      expect(checkRejection(from, 'too late')).toEqual({ ok: false, refusal: 'not_waiting' });
    }
  });
});

describe('backToPerson: a job-approved post after its kind is lowered', () => {
  const byJob = { approved_by_name: 'automation' } as const;
  const running = { level: 'automatic', stopped: false } as const;

  it('keeps it with the job while the kind is automatic and publishing runs', () => {
    expect(backToPerson({ ...byJob, state: 'approved' }, running)).toBe(false);
    expect(backToPerson({ ...byJob, state: 'refused' }, running)).toBe(false);
  });

  it('sends an approved or refused post back once the kind is lowered or publishing stops', () => {
    for (const state of ['approved', 'refused'] as const) {
      expect(backToPerson({ ...byJob, state }, { level: 'approval', stopped: false })).toBe(true);
      expect(backToPerson({ ...byJob, state }, { level: 'automatic', stopped: true })).toBe(true);
    }
  });

  it('leaves a person’s approval and a post already claimed alone', () => {
    const lowered = { level: 'approval', stopped: false } as const;
    expect(backToPerson({ state: 'refused', approved_by_name: 'Mostafa' }, lowered)).toBe(false);
    expect(backToPerson({ ...byJob, state: 'unknown' }, lowered)).toBe(false);
    expect(backToPerson({ ...byJob, state: 'publishing' }, lowered)).toBe(false);
  });

  it('follows an error from the lowering to the post: no retry by the job', () => {
    const lowered = afterEvent({ level: 'automatic', clean_run: 20 }, { type: 'publish_error' });
    const kind = { level: lowered.next.level, stopped: false };
    expect(backToPerson({ ...byJob, state: 'refused' }, kind)).toBe(true);
  });
});

describe('approval (D-427 point 6)', () => {
  const clean = {
    level: 'automatic',
    sensitive: false,
    origin: 'template',
    edited: false,
    stopped: false,
  } as const;

  it('lets the job approve only an automatic kind’s clean template post', () => {
    expect(approver(clean)).toBe('automation');
    expect(approver({ ...clean, level: 'approval' })).toBe('person');
    expect(approver({ ...clean, sensitive: true })).toBe('person');
    expect(approver({ ...clean, origin: 'llm' })).toBe('person');
    expect(approver({ ...clean, edited: true })).toBe('person');
    expect(approver({ ...clean, stopped: true })).toBe('person');
  });

  it('refuses a person’s approval of a post not waiting, or whose gates now fail, naming them', () => {
    const passing = checkGates(facts('result'), NOW);
    const failing = checkGates(withFixture('result', { score_dispute: true }), NOW);
    expect(checkPersonApproval('pending_approval', passing)).toEqual({ ok: true });
    expect(checkPersonApproval('approved', passing)).toEqual({ ok: false, refusal: 'not_waiting' });
    expect(checkPersonApproval('pending_approval', failing)).toEqual({
      ok: false,
      refusal: 'gates_failed',
      gates: ['score_dispute'],
    });
  });

  it('wants a reason to reject and to stop or resume publishing (either account)', () => {
    expect(checkRejection('pending_approval', 'off-brand')).toEqual({ ok: true });
    expect(checkRejection('pending_approval', '  ')).toEqual({
      ok: false,
      refusal: 'reason_required',
    });
    expect(checkRejection('published', 'late')).toEqual({ ok: false, refusal: 'not_waiting' });
    expect(checkSwitch(false, true, 'wrong score out')).toEqual({ ok: true });
    expect(checkSwitch(true, false, 'fixed')).toEqual({ ok: true });
    expect(checkSwitch(true, true, 'again')).toEqual({ ok: false, refusal: 'no_change' });
    expect(checkSwitch(false, true, '')).toEqual({ ok: false, refusal: 'reason_required' });
  });
});

describe('automation levels and the run of 14 (the maintainer’s answers, 2026-11-15)', () => {
  const change = {
    owner: true,
    from: 'approval',
    to: 'automatic',
    clean_run: 14,
    stopped: false,
    reason: 'earned',
  } as const;

  it('refuses a raise while publishing is stopped, but not a lowering', () => {
    expect(checkLevelChange({ ...change, stopped: true })).toEqual({
      ok: false,
      refusal: 'stopped',
    });
    expect(
      checkLevelChange({ ...change, from: 'automatic', to: 'approval', stopped: true }),
    ).toEqual({ ok: true });
  });

  it('lets only the owner change a level, raising only from eligible', () => {
    expect(checkLevelChange(change)).toEqual({ ok: true });
    expect(checkLevelChange({ ...change, owner: false })).toEqual({
      ok: false,
      refusal: 'not_owner',
    });
    expect(checkLevelChange({ ...change, clean_run: 13 })).toEqual({
      ok: false,
      refusal: 'not_eligible',
    });
    expect(checkLevelChange({ ...change, reason: ' ' })).toEqual({
      ok: false,
      refusal: 'reason_required',
    });
    expect(checkLevelChange({ ...change, from: 'automatic' })).toEqual({
      ok: false,
      refusal: 'no_change',
    });
    const lower = { ...change, from: 'automatic', to: 'approval', clean_run: 0 } as const;
    expect(checkLevelChange(lower)).toEqual({ ok: true });
    expect(checkLevelChange({ ...lower, owner: false })).toEqual({
      ok: false,
      refusal: 'not_owner',
    });
  });

  it('makes a kind eligible at the 14th clean post in a row, never automatic by itself', () => {
    let state: AutomationState = { level: 'approval', clean_run: 0 };
    for (let i = 1; i <= SOCIAL_ELIGIBLE_RUN; i += 1) {
      const out = afterEvent(state, { type: 'published', edited: false });
      expect(out.became_eligible).toBe(i === SOCIAL_ELIGIBLE_RUN);
      expect(out.next.level).toBe('approval');
      expect(out.lowered).toBeNull();
      state = out.next;
    }
    expect(state.clean_run).toBe(14);
    expect(isEligible(13)).toBe(false);
    expect(isEligible(14)).toBe(true);
    expect(afterEvent(state, { type: 'published', edited: false }).became_eligible).toBe(false);
  });

  it.each([
    [{ type: 'edited' }],
    [{ type: 'rejected' }],
    [{ type: 'publish_error' }],
    [{ type: 'published', edited: true }],
  ] as const)('resets the run on %o', (event) => {
    expect(afterEvent({ level: 'approval', clean_run: 13 }, event)).toEqual({
      next: { level: 'approval', clean_run: 0 },
      became_eligible: false,
      lowered: null,
    });
  });

  it.each([
    [{ type: 'edited' }],
    [{ type: 'rejected' }],
    [{ type: 'published', edited: true }],
  ] as const)(
    'resets an automatic kind’s run on %o and leaves it automatic (a person may always reject)',
    (event) => {
      expect(afterEvent({ level: 'automatic', clean_run: 20 }, event)).toEqual({
        next: { level: 'automatic', clean_run: 0 },
        became_eligible: false,
        lowered: null,
      });
    },
  );

  it('drops an automatic kind back to approval on a publishing error, audited as automation', () => {
    expect(afterEvent({ level: 'automatic', clean_run: 20 }, { type: 'publish_error' })).toEqual({
      next: { level: 'approval', clean_run: 0 },
      became_eligible: false,
      lowered: {
        action: 'social.level',
        actor_name: 'automation',
        reason: 'publishing error',
        previous: { level: 'automatic', clean_run: 20 },
        next: { level: 'approval', clean_run: 0 },
      },
    });
  });

  it('drops an automatic kind back on the kill switch, keeping its run (still eligible)', () => {
    const out = afterEvent({ level: 'automatic', clean_run: 20 }, { type: 'kill_switch' });
    expect(out.next).toEqual({ level: 'approval', clean_run: 20 });
    expect(out.lowered?.reason).toBe('kill switch');
    expect(out.lowered?.previous).toEqual({ level: 'automatic', clean_run: 20 });
    expect(
      afterEvent({ level: 'approval', clean_run: 5 }, { type: 'kill_switch' }).lowered,
    ).toBeNull();
  });

  it('keeps an automatic kind automatic while its posts go out clean', () => {
    expect(
      afterEvent({ level: 'automatic', clean_run: 30 }, { type: 'published', edited: false }),
    ).toEqual({
      next: { level: 'automatic', clean_run: 31 },
      became_eligible: false,
      lowered: null,
    });
  });
});
