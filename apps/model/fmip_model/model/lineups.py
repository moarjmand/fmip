"""Line-ups and absences in expected goals (T-534, D-086).

The API sends each side's XI strength with a request (``xi_strength``): the
mean season rating of the announced XI, or else of the last XI less the
players reported out (D-081). A version with a ``lineup_beta`` moves the
expected goals by the difference between the two:

    lambda' = lambda * exp(beta * (home_xi - away_xi))
    mu'     = mu     * exp(-beta * (home_xi - away_xi))

so a side fielding a stronger XI than its results so far suggest scores more
and concedes less. ``beta`` is one number, fitted on our own recorded matches
by maximum likelihood with the fitted model's expected goals as offsets;
the history the model trains on holds no line-ups (D-081).

``XI_BEFORE_KICKOFF_SQL`` measures a finished match the way the API measured
it before the kick-off, from the XI that actually started: each starter's
mean rating over the season's earlier matches in which they played 20
minutes or more, and a side only when seven starters are rated.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from math import exp, lgamma, log

from psycopg import Connection
from scipy.optimize import minimize_scalar

from .poisson import dixon_coles_tau

RATED_MINUTES = 20
MIN_RATED_STARTERS = 7

XI_BEFORE_KICKOFF_SQL = """
WITH rated AS (
  SELECT r.person_id, f.season_id, f.kickoff_at, r.value::float8 AS rating
    FROM fixture_player_stat r
    JOIN fixture_player_stat m
      ON m.participant_id = r.participant_id AND m.person_id = r.person_id
     AND m.metric = 'minutes' AND m.value >= %(minutes)s
    JOIN fixture_participant fp ON fp.id = r.participant_id
    JOIN fixture f ON f.id = fp.fixture_id
   WHERE r.metric = 'rating'
),
starters AS (
  SELECT f.id AS fixture_id, c.football_data_division AS division, f.season_id, f.kickoff_at,
         fp.side, fp.team_id, l.person_id
    FROM fixture f
    JOIN season s ON s.id = f.season_id
    JOIN competition c ON c.id = s.competition_id
    JOIN fixture_participant fp ON fp.fixture_id = f.id
    JOIN lineup l ON l.participant_id = fp.id AND l.role = 'starter'
   WHERE f.status = 'finished' AND c.football_data_division = ANY(%(divisions)s)
),
prior AS (
  SELECT st.fixture_id, st.division, st.kickoff_at, st.side, st.team_id, avg(r.rating) AS rating
    FROM starters st
    JOIN rated r
      ON r.person_id = st.person_id AND r.season_id = st.season_id AND r.kickoff_at < st.kickoff_at
   GROUP BY st.fixture_id, st.division, st.kickoff_at, st.side, st.team_id, st.person_id
),
sides AS (
  SELECT fixture_id, division, kickoff_at, side, team_id, avg(rating) AS xi, count(*) AS rated
    FROM prior GROUP BY fixture_id, division, kickoff_at, side, team_id
   HAVING count(*) >= %(min_rated)s
)
SELECT h.fixture_id::text, h.division, (h.kickoff_at AT TIME ZONE 'UTC')::date,
       h.team_id::text, a.team_id::text, h.xi, a.xi
  FROM sides h JOIN sides a ON a.fixture_id = h.fixture_id AND a.side = 'away'
 WHERE h.side = 'home'
"""


@dataclass(frozen=True)
class RecordedXi:
    fixture_id: str
    division: str
    day: date
    home_team_id: str
    away_team_id: str
    home_xi: float
    away_xi: float

    @property
    def difference(self) -> float:
        return self.home_xi - self.away_xi


def xi_before_kickoff(
    conn: Connection[tuple[object, ...]], divisions: Sequence[str]
) -> list[RecordedXi]:
    """Both XIs of every finished match of these divisions that can be measured."""
    with conn.cursor() as cur:
        cur.execute(
            XI_BEFORE_KICKOFF_SQL,
            {
                "minutes": RATED_MINUTES,
                "divisions": list(divisions),
                "min_rated": MIN_RATED_STARTERS,
            },
        )
        rows = cur.fetchall()
    return [
        RecordedXi(
            fixture_id=str(r[0]),
            division=str(r[1]),
            day=r[2],  # type: ignore[arg-type]
            home_team_id=str(r[3]),
            away_team_id=str(r[4]),
            home_xi=float(str(r[5])),
            away_xi=float(str(r[6])),
        )
        for r in rows
    ]


def adjusted(lam: float, mu: float, beta: float, difference: float) -> tuple[float, float]:
    """Expected goals moved by the difference between the XIs."""
    return lam * exp(beta * difference), mu * exp(-beta * difference)


@dataclass(frozen=True)
class LineupSample:
    """One recorded match: the fitted model's expected goals, the XIs' difference, the score."""

    lam: float
    mu: float
    rho: float
    difference: float
    home_goals: int
    away_goals: int


def score_log_likelihood(sample: LineupSample, beta: float) -> float:
    lam, mu = adjusted(sample.lam, sample.mu, beta, sample.difference)
    x, y = sample.home_goals, sample.away_goals
    tau = dixon_coles_tau(x, y, lam, mu, sample.rho)
    if tau <= 0:
        return -1e9
    return x * log(lam) - lam - lgamma(x + 1) + y * log(mu) - mu - lgamma(y + 1) + log(tau)


def fit_beta(samples: Sequence[LineupSample], bound: float = 2.0) -> float:
    """The ``beta`` that makes the recorded scores most likely, within ``[-bound, bound]``."""
    if not samples:
        raise ValueError("no recorded match with both XIs measured")
    result = minimize_scalar(
        lambda beta: -sum(score_log_likelihood(s, beta) for s in samples),
        bounds=(-bound, bound),
        method="bounded",
        options={"xatol": 1e-5},
    )
    return float(result.x)
