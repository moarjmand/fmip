import type {
  SocialCardPayload,
  SocialConsolePost,
  SocialConsoleView,
  SocialPostKind,
  SocialPostState,
} from '@fmip/contracts';

/**
 * The social tab's answer (T-1836) for `social.spec.tsx` and the console's
 * Persian scan: the approved design's matches (2026-11-15), one post of each
 * state, with the English the API really sends (captions, the job's reasons,
 * the publisher's error) and a person's Persian reasons.
 */

const team = (id: string, name: string, code: string | null) => ({
  id,
  name,
  short_name: null,
  code,
});
const NEW = team('t-new', 'Newcastle United', 'NEW');
const ARS = team('t-ars', 'Arsenal', 'ARS');
const NOR = team('t-nor', 'Norway', 'NOR');
const WAL = team('t-wal', 'Wales', 'WAL');
const model = {
  name: 'The Stadiomind model' as const,
  version: 'dixon-coles-elo@0.7.0',
  forecast_id: 'fc-1',
  computed_at: '2026-11-14T17:32:00Z',
};

const FORECAST: SocialCardPayload = {
  kind: 'forecast_pre_match',
  fixture_id: 'fx-1',
  competition: { id: 'c-pl', name: 'Premier League' },
  round: 'Matchday 11',
  kick_off: '2026-11-21T17:30:00Z',
  home: NEW,
  away: ARS,
  model,
  percent: { home: 17.7, draw: 25.3, away: 57 },
};
const RESULT: SocialCardPayload = {
  kind: 'result',
  fixture_id: 'fx-2',
  competition: { id: 'c-nl', name: 'UEFA Nations League A' },
  round: null,
  kick_off: '2026-11-14T19:45:00Z',
  home: NOR,
  away: WAL,
  score: { home: 3, away: 1 },
  after_extra_time: false,
  penalties: null,
};

const FORECAST_X = [
  'Newcastle United v Arsenal',
  'Premier League · Kick-off 17:30 UK time',
  '',
  'The Stadiomind model (dixon-coles-elo@0.7.0):',
  'Newcastle United win 17.7% · Draw 25.3% · Arsenal win 57%',
  '',
  'https://traveltohormuz.ir/en/match/fx-1',
].join('\n');
const FORECAST_IG = FORECAST_X.split('\n').slice(0, 5).join('\n');
const RESULT_X = [
  'Full time: Norway 3–1 Wales',
  'UEFA Nations League A',
  '',
  'https://traveltohormuz.ir/en/match/fx-2',
].join('\n');

let n = 0;
function post(
  kind: SocialPostKind,
  network: 'x' | 'instagram',
  state: SocialPostState,
  payload: SocialCardPayload,
  body: string,
  extra: Partial<SocialConsolePost> = {},
): SocialConsolePost {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    fixture_id: payload.fixture_id,
    kind,
    network,
    state,
    origin: 'template',
    body,
    payload,
    failed_gates: [],
    sensitive: null,
    edited_from: null,
    created_at: '2026-11-16T07:05:00Z',
    expires_at: '2026-11-21T17:30:00Z',
    approved_by: null,
    approved_at: null,
    decided_by: null,
    decided_at: null,
    decided_reason: null,
    post_day: null,
    slot: null,
    published_at: null,
    last_error: null,
    updated_at: '2026-11-16T07:05:00Z',
    ...extra,
  };
}

export const SOCIAL_VIEW: SocialConsoleView = {
  checked_at: '2026-11-16T10:00:00Z',
  viewer: { name: 'مصطفی', owner: true },
  switch: { stopped: false, changed_at: null, changed_by: null, reason: null },
  key: { state: 'set', set_at: '2026-11-15T20:00:00Z', set_by: 'mostafa' },
  health: {
    checked_at: '2026-11-16T10:00:00Z',
    publisher: 'buffer',
    key: 'set',
    stopped: false,
    scheduled: true,
    paused_until: null,
    networks: [
      {
        network: 'x',
        last_published_at: '2026-11-16T08:30:00Z',
        last_attempt: { state: 'published', at: '2026-11-16T08:30:05Z' },
      },
      { network: 'instagram', last_published_at: null, last_attempt: null },
    ],
  },
  today: {
    day: '2026-11-16',
    networks: [
      { network: 'x', used: 3, cap: 5 },
      { network: 'instagram', used: 1, cap: 5 },
    ],
  },
  automation: [
    {
      kind: 'forecast_pre_match',
      level: 'approval',
      clean_run: 9,
      eligible: false,
      level_changed_at: null,
      level_changed_by: null,
    },
    {
      kind: 'model_verdict',
      level: 'approval',
      clean_run: 14,
      eligible: true,
      level_changed_at: null,
      level_changed_by: null,
    },
    {
      kind: 'result',
      level: 'automatic',
      clean_run: 16,
      eligible: true,
      level_changed_at: '2026-11-15T21:00:00Z',
      level_changed_by: 'mostafa',
    },
  ],
  queue: [
    post('forecast_pre_match', 'x', 'pending_approval', FORECAST, FORECAST_X, {
      sensitive: 'betting',
    }),
    post('forecast_pre_match', 'instagram', 'pending_approval', FORECAST, FORECAST_IG, {
      sensitive: 'betting',
      failed_gates: ['freshness'],
    }),
    post('result', 'x', 'unknown', RESULT, RESULT_X, {
      approved_by: 'automation',
      approved_at: '2026-11-15T07:00:00Z',
      post_day: '2026-11-16',
      slot: 1,
      last_error: 'buffer did not answer: TimeoutError',
    }),
  ],
  history: [
    post('result', 'instagram', 'published', RESULT, RESULT_X.split('\n').slice(0, 2).join('\n'), {
      approved_by: 'mostafa',
      approved_at: '2026-11-15T07:00:00Z',
      published_at: '2026-11-15T08:30:02Z',
      post_day: '2026-11-15',
      slot: 1,
    }),
    post('forecast_pre_match', 'x', 'rejected', FORECAST, FORECAST_X, {
      decided_by: 'maryam',
      decided_at: '2026-11-15T09:00:00Z',
      decided_reason: 'متن یا لحن: خط دوم بهتر شود',
    }),
    post('result', 'x', 'expired', RESULT, RESULT_X, {
      decided_reason: null,
      updated_at: '2026-11-15T16:30:00Z',
    }),
  ],
  audit: [
    {
      at: '2026-11-16T08:30:05Z',
      actor: 'automation',
      action: 'social.claim',
      target: 'social_post:p1',
      reason: 'claimed slot 3 of 2026-11-16',
      previous: { state: 'approved' },
    },
    {
      at: '2026-11-16T08:00:00Z',
      actor: 'maryam',
      action: 'social.reject',
      target: 'social_post:p2',
      reason: 'متن یا لحن: خط دوم بهتر شود',
      previous: { state: 'pending_approval', clean_run: 9 },
    },
    {
      at: '2026-11-15T20:00:00Z',
      actor: 'mostafa',
      action: 'social.credential',
      target: 'social_credential:buffer',
      reason: 'the publisher key was entered',
      previous: { key: 'not set' },
    },
    {
      at: '2026-11-15T19:00:00Z',
      actor: 'automation',
      action: 'social.expire',
      target: 'social_post:p3',
      reason: 'a gate failed at publishing: freshness',
      previous: { state: 'approved' },
    },
  ],
};
