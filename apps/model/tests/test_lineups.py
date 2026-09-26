"""Line-ups and absences in expected goals (T-534).

The term is one number fitted by maximum likelihood with the fitted model's
expected goals as offsets: simulated matches with a known ``beta`` give it
back; a measured XI pair finds its training match a day apart at most; the
split scores the same matches with and without the term. Against the
database, a starter's rating is read only from the season's earlier matches.
"""

import os
import uuid
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta

import numpy as np
import pytest

from fmip_model.backtest.lineups import Dated, evaluate, pair
from fmip_model.model.dixon_coles import MatchObservation
from fmip_model.model.lineups import (
    LineupSample,
    RecordedXi,
    adjusted,
    fit_beta,
    xi_before_kickoff,
)
from fmip_model.model.version import BASELINE
from fmip_model.service.contract import Forecast, ForecastRequest, XiStrength
from fmip_model.service.forecaster import Forecaster, TrainingSource

DATABASE_URL = os.environ.get("DATABASE_URL")


def simulate(beta: float, n: int, seed: int) -> list[LineupSample]:
    rng = np.random.default_rng(seed)
    out: list[LineupSample] = []
    for _ in range(n):
        lam, mu = float(rng.uniform(0.9, 2.0)), float(rng.uniform(0.7, 1.6))
        difference = float(rng.normal(0.0, 0.35))
        true_lam, true_mu = adjusted(lam, mu, beta, difference)
        out.append(
            LineupSample(
                lam, mu, 0.0, difference, int(rng.poisson(true_lam)), int(rng.poisson(true_mu))
            )
        )
    return out


def test_no_term_leaves_the_expected_goals_alone_and_a_stronger_xi_moves_them() -> None:
    assert adjusted(1.5, 1.1, 0.0, 0.4) == (1.5, 1.1)
    lam, mu = adjusted(1.5, 1.1, 0.5, 0.4)
    assert lam > 1.5 and mu < 1.1


def test_the_fit_gives_back_the_term_the_matches_were_played_with() -> None:
    assert fit_beta(simulate(0.4, 4000, seed=1)) == pytest.approx(0.4, abs=0.1)
    assert fit_beta(simulate(0.0, 4000, seed=2)) == pytest.approx(0.0, abs=0.1)


def test_a_measured_pair_finds_its_training_match_a_day_apart_at_most() -> None:
    d = date(2026, 9, 20)
    matches = [
        MatchObservation(d, "h", "a", 1, 0),
        MatchObservation(d + timedelta(days=30), "a", "h", 2, 2),
    ]
    xis = [
        RecordedXi("f1", "E0", d + timedelta(days=1), "h", "a", 6.9, 6.5),
        RecordedXi("f2", "E0", d + timedelta(days=33), "a", "h", 6.6, 6.8),  # three days off
        RecordedXi("f3", "E0", d, "x", "y", 6.6, 6.8),  # clubs the training data lacks
    ]
    paired = pair(matches, xis)
    assert [(m.date, x.fixture_id) for m, x in paired] == [(d, "f1")]


def test_the_split_scores_the_same_matches_with_and_without_the_term() -> None:
    start = date(2026, 8, 1)
    samples = [
        Dated(start + timedelta(days=i // 10), s) for i, s in enumerate(simulate(0.5, 3000, seed=3))
    ]
    split = start + timedelta(days=200)
    report = evaluate(samples, split)
    assert report.fitted_on + report.tested_on == len(samples)
    assert report.beta == pytest.approx(0.5, abs=0.15)
    assert report.gain > 0


# --- the measurement, against the schema ------------------------------------------


@pytest.fixture
def season() -> Iterator[dict[str, str]]:
    assert DATABASE_URL
    import psycopg

    ids = {k: str(uuid.uuid4()) for k in ("comp", "season", "home", "away", "f1", "f2")}
    people = [str(uuid.uuid4()) for _ in range(22)]
    parts = {k: str(uuid.uuid4()) for k in ("f1h", "f1a", "f2h", "f2a")}
    with psycopg.connect(DATABASE_URL) as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO competition (id, name, kind, scope, gender, football_data_division)"
            " VALUES (%s, 'Z8 line-up test', 'league', 'continental', 'men', 'Z8')",
            (ids["comp"],),
        )
        cur.execute(
            "INSERT INTO season (id, competition_id, label, start_date, end_date)"
            " VALUES (%s, %s, '2026/27', '2026-08-01', '2027-05-31')",
            (ids["season"], ids["comp"]),
        )
        cur.execute(
            "INSERT INTO team (id, name, kind, gender) VALUES"
            " (%s, 'Z8 Home', 'club', 'men'), (%s, 'Z8 Away', 'club', 'men')",
            (ids["home"], ids["away"]),
        )
        for p in people:
            cur.execute("INSERT INTO person (id, full_name) VALUES (%s, 'Z8 player')", (p,))
        for fixture, kickoff, home_part, away_part in (
            (ids["f1"], "2026-08-20T15:00:00Z", parts["f1h"], parts["f1a"]),
            (ids["f2"], "2026-08-27T15:00:00Z", parts["f2h"], parts["f2a"]),
        ):
            cur.execute(
                "INSERT INTO fixture (id, season_id, kickoff_at, status)"
                " VALUES (%s, %s, %s, 'finished')",
                (fixture, ids["season"], kickoff),
            )
            cur.execute(
                "INSERT INTO fixture_participant (id, fixture_id, team_id, side) VALUES"
                " (%s, %s, %s, 'home'), (%s, %s, %s, 'away')",
                (home_part, fixture, ids["home"], away_part, fixture, ids["away"]),
            )
            for part, squad in ((home_part, people[:11]), (away_part, people[11:])):
                for p in squad:
                    cur.execute(
                        "INSERT INTO lineup (participant_id, person_id, role)"
                        " VALUES (%s, %s, 'starter')",
                        (part, p),
                    )
        # Ratings in the first match only: the home XI played well, the away XI less so;
        # one home starter played ten minutes and is not rated.
        for part, squad, rating in (
            (parts["f1h"], people[:11], 7.4),
            (parts["f1a"], people[11:], 6.2),
        ):
            for i, p in enumerate(squad):
                minutes = 10 if (part == parts["f1h"] and i == 0) else 90
                cur.execute(
                    "INSERT INTO fixture_player_stat (participant_id, person_id, metric, value)"
                    " VALUES (%s, %s, 'rating', %s), (%s, %s, 'minutes', %s)",
                    (part, p, rating, part, p, minutes),
                )
    yield ids
    with psycopg.connect(DATABASE_URL) as conn, conn.cursor() as cur:
        cur.execute(
            "DELETE FROM fixture_player_stat WHERE participant_id = ANY(%s::uuid[])",
            (list(parts.values()),),
        )
        cur.execute(
            "DELETE FROM lineup WHERE participant_id = ANY(%s::uuid[])", (list(parts.values()),)
        )
        cur.execute(
            "DELETE FROM fixture_participant WHERE id = ANY(%s::uuid[])", (list(parts.values()),)
        )
        cur.execute("DELETE FROM fixture WHERE id = ANY(%s::uuid[])", ([ids["f1"], ids["f2"]],))
        cur.execute("DELETE FROM season WHERE id = %s", (ids["season"],))
        cur.execute("DELETE FROM competition WHERE id = %s", (ids["comp"],))
        cur.execute("DELETE FROM team WHERE id = ANY(%s::uuid[])", ([ids["home"], ids["away"]],))
        cur.execute("DELETE FROM person WHERE id = ANY(%s::uuid[])", (people,))


@pytest.mark.skipif(not DATABASE_URL, reason="DATABASE_URL not set")
def test_a_starter_is_rated_only_from_the_season_before_the_kickoff(
    season: dict[str, str],
) -> None:
    assert DATABASE_URL
    import psycopg

    with psycopg.connect(DATABASE_URL) as conn:
        measured = xi_before_kickoff(conn, ["Z8"])
    # The first match had no earlier ratings; the second reads the first's,
    # the ten-minute starter left out (ten rated of eleven, still seven or more).
    assert [(x.fixture_id, x.division) for x in measured] == [(season["f2"], "Z8")]
    assert measured[0].home_xi == pytest.approx(7.4)
    assert measured[0].away_xi == pytest.approx(6.2)
    assert measured[0].difference == pytest.approx(1.2)


# --- the forecaster ----------------------------------------------------------------


class OneLeague(TrainingSource):
    def __init__(self) -> None:
        rng = np.random.default_rng(8)
        teams = [f"c{i}" for i in range(8)]
        self._matches: list[MatchObservation] = []
        day = date(2024, 8, 1)
        for _ in range(3):
            for h in teams:
                for a in teams:
                    if h != a:
                        self._matches.append(
                            MatchObservation(
                                day, h, a, int(rng.poisson(1.4)), int(rng.poisson(1.1))
                            )
                        )
                        day += timedelta(days=2)

    def aliases(self, division: str) -> Mapping[str, str]:
        return {HOME: "c0", AWAY: "c1"}

    def matches(self, division: str, since: date, until: date) -> Sequence[MatchObservation]:
        return [m for m in self._matches if since <= m.date <= until]

    def elo(self, day: date) -> Mapping[str, float]:
        return {}


HOME = "00000000-0000-4000-8000-00000000d001"
AWAY = "00000000-0000-4000-8000-00000000d002"
NOW = datetime(2025, 12, 1, 12, 0, tzinfo=UTC)


def ask(forecaster: Forecaster, xi: XiStrength | None) -> Forecast:
    answer = forecaster.forecast(
        ForecastRequest(
            fixture_id="00000000-0000-4000-8000-00000000d999",
            home_team_id=HOME,
            away_team_id=AWAY,
            division="E0",
            kickoff_at=datetime(2025, 12, 2, 15, 0, tzinfo=UTC),
            xi_strength=xi,
        )
    )
    assert isinstance(answer, Forecast)
    return answer


def test_only_a_version_with_the_term_reads_the_xis_and_only_when_both_are_sent() -> None:
    stronger_home = XiStrength(home=7.3, away=6.5, confirmed=True)
    published = Forecaster(OneLeague(), clock=lambda: NOW)
    assert ask(published, stronger_home).probabilities == ask(published, None).probabilities

    candidate = Forecaster(
        OneLeague(), version=replace(BASELINE, version="0.9.1", lineup_beta=0.4), clock=lambda: NOW
    )
    without = ask(candidate, None)
    with_xis = ask(candidate, stronger_home)
    assert with_xis.probabilities.home > without.probabilities.home
    assert with_xis.expected_goals.home > without.expected_goals.home
    assert with_xis.expected_goals.away < without.expected_goals.away
    assert without.probabilities == ask(published, None).probabilities
