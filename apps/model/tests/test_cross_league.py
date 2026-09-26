"""Clubs of different leagues on one scale (T-533).

The joint fit is checked three ways: with one group and a group ridge that
pins the group to zero it is the per-division fit, so its analytic gradient
lands where the numerical one does; on two simulated leagues whose clubs
differ by a known margin it recovers that margin from the matches between
them; and a club with few matches sits near its league, not near zero.
"""

from collections.abc import Mapping, Sequence
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta

import numpy as np
import pytest
from scipy.optimize import check_grad

from fmip_model.model.cross_league import (
    CROSS_LEAGUE,
    OTHER_GROUP,
    fit_joint,
    groups_for,
    joint_problem,
)
from fmip_model.model.dixon_coles import MatchObservation, fit
from fmip_model.model.version import BASELINE, CrossLeague, load_candidate
from fmip_model.service.contract import ForecastRequest
from fmip_model.service.forecaster import Forecaster, TrainingSource

FIT_DATE = date(2025, 6, 1)


def league(prefix: str, rng: np.random.Generator, start: date) -> list[MatchObservation]:
    """A double round robin of 12 clubs with a spread of net strengths around their league's."""
    teams = [f"{prefix}{i}" for i in range(12)]
    spread = {t: 0.4 - i * (0.8 / 11) for i, t in enumerate(teams)}
    out: list[MatchObservation] = []
    day = start
    for home in teams:
        for away in teams:
            if home == away:
                continue
            # Within one league the league's own level cancels.
            lam = np.exp(spread[home] / 2 - spread[away] / 2 + 0.25)
            mu = np.exp(spread[away] / 2 - spread[home] / 2)
            out.append(
                MatchObservation(day, home, away, int(rng.poisson(lam)), int(rng.poisson(mu)))
            )
            day += timedelta(days=2)
    return out


def cross(
    a_teams: Sequence[str], b_teams: Sequence[str], margin: float, rng: np.random.Generator
) -> list[MatchObservation]:
    """Matches between the two leagues' clubs; league A is ``margin`` stronger (net)."""
    out: list[MatchObservation] = []
    day = date(2024, 9, 1)
    for i, a in enumerate(a_teams):
        for j, b in enumerate(b_teams):
            if (i + j) % 2:
                continue
            home_a = (i + j) % 4 == 0
            home, away = (a, b) if home_a else (b, a)
            edge = margin if home_a else -margin
            lam = np.exp(edge / 2 + 0.25)
            mu = np.exp(-edge / 2)
            out.append(
                MatchObservation(day, home, away, int(rng.poisson(lam)), int(rng.poisson(mu)))
            )
            day += timedelta(days=3)
    return out


def test_the_analytic_gradient_is_the_gradient() -> None:
    rng = np.random.default_rng(4)
    tagged = [("A1", m) for m in league("A", rng, date(2024, 8, 1))] + [
        (CROSS_LEAGUE, m) for m in league("B", rng, date(2024, 8, 1))[:40]
    ]
    problem = joint_problem(
        [m for _, m in tagged],
        groups_for(tagged),
        FIT_DATE,
        xi=0.003,
        team_ridge=0.1,
        group_ridge=0.02,
    )
    theta = rng.normal(0.0, 0.2, size=problem.theta0.shape)
    theta[-1] = 0.05  # rho small enough that every correction stays positive
    error = check_grad(lambda t: problem.objective(t)[0], lambda t: problem.objective(t)[1], theta)
    assert error < 1e-3 * np.linalg.norm(problem.objective(theta)[1])


def test_one_group_pinned_to_zero_is_the_per_division_fit() -> None:
    rng = np.random.default_rng(11)
    matches = league("A", rng, date(2024, 8, 1))
    joint = fit_joint(matches, {}, FIT_DATE, xi=0.003, team_ridge=0.05, group_ridge=1e6)
    single = fit(matches, FIT_DATE, xi=0.003, ridge=0.05)
    # The same optimum, to the tolerance of the per-division fit's numerical gradient.
    for team in single.teams:
        assert joint.attack[team] == pytest.approx(single.attack[team], abs=1e-3)
        assert joint.defence[team] == pytest.approx(single.defence[team], abs=1e-3)
    assert joint.home_advantage == pytest.approx(single.home_advantage, abs=1e-3)
    assert joint.rho == pytest.approx(single.rho, abs=1e-3)


def test_the_margin_between_two_leagues_is_learned_from_the_matches_between_them() -> None:
    rng = np.random.default_rng(5)
    a = league("A", rng, date(2023, 8, 1))
    b = league("B", rng, date(2023, 8, 1))
    margin = 0.6
    between = cross([f"A{i}" for i in range(12)], [f"B{i}" for i in range(12)], margin, rng)
    tagged = [("A1", m) for m in a] + [("B1", m) for m in b] + [(CROSS_LEAGUE, m) for m in between]
    groups = groups_for(tagged)
    model = fit_joint(
        [m for _, m in tagged], groups, FIT_DATE, xi=0.0005, team_ridge=0.1, group_ridge=0.01
    )
    net_a = np.mean([model.strength(f"A{i}") for i in range(12)])
    net_b = np.mean([model.strength(f"B{i}") for i in range(12)])
    # Within their own leagues the two are identical; only the cross matches say A is better.
    assert net_a - net_b == pytest.approx(margin, abs=0.25)


def test_a_club_with_few_matches_sits_near_its_league_not_near_zero() -> None:
    rng = np.random.default_rng(9)
    strong = league("S", rng, date(2023, 8, 1))
    # Three weak clubs from a league the model does not hold, each with a few cup matches.
    visitors = ["X0", "X1", "X2"]
    cups: list[MatchObservation] = []
    day = date(2024, 9, 10)
    for x in visitors:
        for s in ("S0", "S3", "S6", "S9"):
            cups.append(MatchObservation(day, s, x, int(rng.poisson(2.6)), int(rng.poisson(0.5))))
            day += timedelta(days=5)
    newcomer = MatchObservation(day, "S5", "X3", 2, 0)  # one match only
    tagged = [("S1", m) for m in strong] + [(CROSS_LEAGUE, m) for m in [*cups, newcomer]]
    groups = groups_for(tagged)
    assert groups["X3"] == OTHER_GROUP
    model = fit_joint(
        [m for _, m in tagged], groups, FIT_DATE, xi=0.0005, team_ridge=0.5, group_ridge=0.01
    )
    others = np.mean([model.strength(x) for x in visitors])
    assert others < -0.5
    # The newcomer is judged mostly by its group's level, well below the average club.
    assert model.strength("X3") < -0.4


def test_groups_follow_the_latest_domestic_league_and_cups_decide_nothing() -> None:
    d = date(2024, 1, 1)
    tagged = [
        ("E1", MatchObservation(d, "promoted", "x", 1, 0)),
        ("E0", MatchObservation(d + timedelta(days=200), "promoted", "y", 0, 0)),
        (CROSS_LEAGUE, MatchObservation(d + timedelta(days=300), "promoted", "abroad", 1, 1)),
    ]
    groups = groups_for(tagged)
    assert groups["promoted"] == "E0"
    assert groups["x"] == "E1" and groups["y"] == "E0"
    assert groups["abroad"] == OTHER_GROUP


# --- the service -----------------------------------------------------------------

HOME = "00000000-0000-4000-8000-00000000a001"
AWAY = "00000000-0000-4000-8000-00000000b001"
STRANGER = "00000000-0000-4000-8000-00000000c999"
NOW = datetime(2025, 6, 2, 12, 0, tzinfo=UTC)
CANDIDATE = replace(
    BASELINE,
    version="0.9.0",
    history_days=1100,
    cross_league=CrossLeague(xi=0.001, team_ridge=0.1, group_ridge=0.01),
)


class TwoLeagues(TrainingSource):
    def __init__(self) -> None:
        rng = np.random.default_rng(21)
        a = league("A", rng, date(2023, 8, 1))
        b = league("B", rng, date(2023, 8, 1))
        between = cross([f"A{i}" for i in range(12)], [f"B{i}" for i in range(12)], 0.6, rng)
        # Two clubs are catalogue ids, as aliases make them.
        rename = {"A0": HOME, "B0": AWAY}

        def named(m: MatchObservation) -> MatchObservation:
            return replace(m, home=rename.get(m.home, m.home), away=rename.get(m.away, m.away))

        self.tagged = (
            [("A1", named(m)) for m in a]
            + [("B1", named(m)) for m in b]
            + [(CROSS_LEAGUE, named(m)) for m in between]
        )

    def aliases(self, division: str) -> Mapping[str, str]:
        return {}

    def matches(self, division: str, since: date, until: date) -> Sequence[MatchObservation]:
        return []

    def elo(self, day: date) -> Mapping[str, float]:
        return {}

    def every_match(self, since: date, until: date) -> Sequence[tuple[str, MatchObservation]]:
        return [(d, m) for d, m in self.tagged if since < m.date <= until]


def ask(forecaster: Forecaster, home: str = HOME, away: str = AWAY) -> object:
    return forecaster.forecast(
        ForecastRequest(
            fixture_id="00000000-0000-4000-8000-000000000999",
            home_team_id=home,
            away_team_id=away,
            division=CROSS_LEAGUE,
            kickoff_at=datetime(2025, 6, 3, 19, 0, tzinfo=UTC),
        )
    )


def test_the_published_version_says_it_rates_within_one_league() -> None:
    answer = ask(Forecaster(TwoLeagues(), clock=lambda: NOW))
    assert answer.status == "unavailable"  # type: ignore[attr-defined]
    assert answer.reason == "division_not_loaded"  # type: ignore[attr-defined]
    assert "within one league" in answer.detail  # type: ignore[attr-defined]


def test_a_version_with_the_scale_answers_under_its_own_name() -> None:
    answer = ask(Forecaster(TwoLeagues(), version=CANDIDATE, clock=lambda: NOW))
    assert answer.status == "available"  # type: ignore[attr-defined]
    assert answer.inputs.model_version == "dixon-coles-elo@0.9.0"  # type: ignore[attr-defined]
    p = answer.probabilities  # type: ignore[attr-defined]
    # A's club at home to B's: the stronger league at home is the favourite.
    assert p.home > p.away
    assert p.home + p.draw + p.away == pytest.approx(1.0, abs=1e-9)


def test_a_club_in_no_loaded_division_is_named_not_guessed() -> None:
    answer = ask(Forecaster(TwoLeagues(), version=CANDIDATE, clock=lambda: NOW), away=STRANGER)
    assert answer.status == "unavailable"  # type: ignore[attr-defined]
    assert answer.reason == "no_history"  # type: ignore[attr-defined]
    assert STRANGER in answer.detail  # type: ignore[attr-defined]


def test_the_candidate_file_carries_the_scale(tmp_path: object) -> None:
    import json
    from pathlib import Path

    path = Path(str(tmp_path)) / "c.json"
    path.write_text(
        json.dumps(
            {
                "version": "0.4.0",
                "cross_league": {"xi": 0.002, "team_ridge": 0.1, "group_ridge": 0.01},
            }
        )
    )
    version = load_candidate(path)
    assert version is not None
    assert version.cross_league == CrossLeague(0.002, 0.1, 0.01)
    assert version.as_dict()["cross_league"] == {
        "xi": 0.002,
        "team_ridge": 0.1,
        "group_ridge": 0.01,
    }


def test_the_backtest_forecasts_only_cross_league_matches_from_their_past() -> None:
    from fmip_model.backtest.cross_league import forecast_window, frequencies, score

    tagged = TwoLeagues().tagged
    crossing = [m for d, m in tagged if d == CROSS_LEAGUE]
    window = (crossing[20].date, crossing[-1].date)
    forecasts, skipped = forecast_window(
        tagged, window, CrossLeague(0.001, 0.1, 0.01), history_days=1100
    )
    assert len(forecasts) + skipped == len(
        [m for m in crossing if window[0] <= m.date <= window[1]]
    )
    assert forecasts and all(not f.outsider for f in forecasts)
    base = frequencies(forecasts)
    assert base.home + base.draw + base.away == pytest.approx(1.0)
    scored = score(forecasts, base)
    # Clubs of a league the fit rates 0.6 stronger: better than knowing nothing.
    assert scored.log_loss < scored.uniform_log_loss
