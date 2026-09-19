import type {
  CommunityConsensusResponse,
  CoverageState,
  ForecastVersionsResponse,
  MatchCentre,
  SummaryGrounding,
} from '@fmip/contracts';

/**
 * The facts a summary is written from (T-410): the match record as the
 * match centre already serves it, each part under its coverage state, and
 * nothing else. The document is the whole prompt input and is stored with
 * the version, so a wrong sentence can be traced to what the model was
 * given rather than argued about.
 *
 * Two things are deliberate. Absence is *named*: a part that is
 * `not_supplied` is in the document as `not_supplied` with no data, so the
 * model is told what is unknown rather than left to fill it. And the
 * forecast and the consensus are numbers with their labels, never asked to
 * be reconciled (rule 6).
 */
export const FACTS_VERSION = 'facts@1';
export const PROMPT_VERSION = 'match-summary@1';

export interface MatchFacts {
  facts_version: typeof FACTS_VERSION;
  match: {
    id: string;
    competition: string;
    season: string;
    stage: string | null;
    round: string | null;
    kickoff_at: string;
    status: string;
    venue: string | null;
    city: string | null;
    neutral_venue: boolean;
    referee: string | null;
    attendance: number | null;
  };
  home: { id: string; name: string; formation: string | null; coach: string | null };
  away: { id: string; name: string; formation: string | null; coach: string | null };
  score: MatchCentre['fixture']['scores'];
  timeline: {
    coverage: CoverageState;
    incidents: {
      minute: number;
      added_time: number | null;
      kind: string;
      side: 'home' | 'away' | null;
      player: string | null;
      related_player: string | null;
      detail: string | null;
    }[];
  };
  statistics: {
    coverage: CoverageState;
    rows: { metric: string; home: number | null; away: number | null }[];
  };
  lineups: {
    coverage: CoverageState;
    home: { name: string; role: string; position: string | null; captain: boolean }[];
    away: { name: string; role: string; position: string | null; captain: boolean }[];
  };
  form: {
    coverage: CoverageState;
    home: {
      opponent: string;
      home: boolean;
      goals_for: number;
      goals_against: number;
      result: string;
    }[];
    away: {
      opponent: string;
      home: boolean;
      goals_for: number;
      goals_against: number;
      result: string;
    }[];
  };
  head_to_head: {
    coverage: CoverageState;
    entries: {
      kickoff_at: string;
      home: string;
      away: string;
      full_time: { home: number; away: number };
    }[];
  };
  forecast: {
    coverage: CoverageState;
    /** The statistical model's probabilities, as percentages, labelled as its. */
    probabilities: { home: number; draw: number; away: number } | null;
    model_version: string | null;
    computed_at: string | null;
  };
  consensus: {
    coverage: CoverageState;
    /** Members counted, and the crowd's shares as percentages, labelled as theirs. */
    sample: number | null;
    crowd: { home: number; draw: number; away: number } | null;
  };
}

const NOT_SUPPLIED: CoverageState = 'not_supplied';

export function assembleFacts(
  centre: MatchCentre,
  forecast: ForecastVersionsResponse | null,
  consensus: CommunityConsensusResponse | null,
): MatchFacts {
  const f = centre.fixture;
  const team = (side: MatchCentre['fixture']['home']) => ({
    id: side.id,
    name: side.name,
    formation: side.formation,
    coach: side.coach?.name ?? null,
  });
  const players = (
    list: { name: string; role: string; position: string | null; is_captain: boolean }[],
  ) =>
    list.map((p) => ({ name: p.name, role: p.role, position: p.position, captain: p.is_captain }));
  const form = (list: MatchCentre['form']['home']) =>
    (list.data ?? []).map((e) => ({
      opponent: e.opponent.name,
      home: e.home,
      goals_for: e.goals_for,
      goals_against: e.goals_against,
      result: e.result,
    }));
  const latest = forecast?.latest ?? null;
  const percent = (p: { home: number; draw: number; away: number } | null) =>
    p === null
      ? null
      : { home: round1(p.home * 100), draw: round1(p.draw * 100), away: round1(p.away * 100) };
  const crowd = consensus?.data?.crowd.shares ?? null;
  return {
    facts_version: FACTS_VERSION,
    match: {
      id: f.id,
      competition: f.competition.name,
      season: f.season.label,
      stage: f.stage?.name ?? null,
      round: f.round,
      kickoff_at: f.kickoff_at,
      status: f.status,
      venue: f.venue?.name ?? null,
      city: f.venue?.city ?? null,
      neutral_venue: f.is_neutral_venue,
      referee: f.referee?.name ?? null,
      attendance: f.attendance,
    },
    home: team(f.home),
    away: team(f.away),
    score: f.scores,
    timeline: {
      coverage: centre.timeline.coverage,
      incidents: (centre.timeline.data ?? []).map((i) => ({
        minute: i.minute,
        added_time: i.added_time,
        kind: i.kind,
        side: i.side,
        player: i.player?.name ?? null,
        related_player: i.related_player?.name ?? null,
        detail: i.detail,
      })),
    },
    statistics: {
      coverage: centre.statistics.coverage,
      rows: (centre.statistics.data ?? []).map((r) => ({
        metric: r.metric,
        home: r.home,
        away: r.away,
      })),
    },
    lineups: {
      coverage: centre.lineups.coverage,
      home: players(centre.lineups.data?.home ?? []),
      away: players(centre.lineups.data?.away ?? []),
    },
    form: {
      coverage: worst(centre.form.home.coverage, centre.form.away.coverage),
      home: form(centre.form.home),
      away: form(centre.form.away),
    },
    head_to_head: {
      coverage: centre.head_to_head.coverage,
      entries: (centre.head_to_head.data ?? []).map((h) => ({
        kickoff_at: h.kickoff_at,
        home: h.home.name,
        away: h.away.name,
        full_time: h.full_time,
      })),
    },
    forecast: {
      coverage:
        forecast === null ? NOT_SUPPLIED : latest === null ? NOT_SUPPLIED : forecast.coverage,
      probabilities: percent(latest?.probabilities ?? null),
      model_version: latest?.model_version ?? null,
      computed_at: latest?.computed_at ?? null,
    },
    consensus: {
      coverage: consensus === null ? NOT_SUPPLIED : consensus.coverage,
      sample: consensus?.data?.sample ?? null,
      crowd: percent(crowd),
    },
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function worst(a: CoverageState, b: CoverageState): CoverageState {
  const order: CoverageState[] = ['available', 'limited', 'delayed', 'not_supplied'];
  return order[Math.max(order.indexOf(a), order.indexOf(b))] ?? NOT_SUPPLIED;
}

export function groundingOf(facts: MatchFacts): SummaryGrounding {
  return {
    timeline: facts.timeline.coverage,
    statistics: facts.statistics.coverage,
    lineups: facts.lineups.coverage,
    forecast: facts.forecast.coverage,
    consensus: facts.consensus.coverage,
  };
}
