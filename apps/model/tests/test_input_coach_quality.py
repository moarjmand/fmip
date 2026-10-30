"""Coach quality as an input (T-1658, D-310): the baseline, the shrunk record, tenure, the harness.

Needs no database: the results and line-ups are built here.
"""

from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta

import numpy as np
import pytest

from fmip_model.backtest.inputs import run_division
from fmip_model.backtest.walk_forward import BacktestMatch
from fmip_model.inputs import InputContext, available
from fmip_model.inputs import coach_quality as cq
from fmip_model.inputs.coach_quality import (
    PSEUDO_COUNT,
    TENURE_CAP,
    Coaching,
    CoachQuality,
    Reading,
    Records,
    Scored,
    baseline,
    build,
    coach_quality_input,
    shrunk,
    tenure,
)
from fmip_model.model.dixon_coles import MatchObservation
from fmip_model.model.own_elo import EloMatch
from fmip_model.model.version import BASELINE
from fmip_model.training.coaches import LineUp

START = datetime(2024, 8, 3, 15, tzinfo=UTC)


def day(i: int) -> date:
    return (START + timedelta(days=7 * i)).date()


def club(team: str, coaches: Sequence[str | None], first: int = 0) -> list[LineUp]:
    """One line-up a week from week ``first``, naming ``coaches`` in turn."""
    return [
        LineUp(team, f"{team}-f{first + i}", START + timedelta(days=7 * (first + i)), "2024/25", c)
        for i, c in enumerate(coaches)
    ]


def test_the_baseline_reads_the_ratings_before_the_day(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cq, "WARM", 0)
    # A plays twice on the first day: both matches are expected from the ratings before it.
    first = baseline(
        [EloMatch("X1", day(0), "A", "B", 4, 0), EloMatch("X1", day(0), "A", "C", 4, 0)]
    )
    assert [(s.expected_home, s.expected_away) for s in first] == [
        (cq.HOME_GOALS, cq.AWAY_GOALS),
        (cq.HOME_GOALS, cq.AWAY_GOALS),
    ]


def test_the_baseline_scores_only_warm_clubs_and_learns_their_strength(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(cq, "WARM", 2)
    results = [EloMatch("X1", day(i), "A", "B", 3, 0) for i in range(8)]
    results.append(EloMatch("X1", day(7), "C", "A", 0, 0))  # C has no earlier match
    scored = baseline(results)
    assert [s.date for s in scored] == [day(i) for i in range(2, 8)]
    assert all(s.home == "A" for s in scored)
    # A beats expectation every week, so its expected goals rise and B's fall.
    home = [s.expected_home for s in scored]
    away = [s.expected_away for s in scored]
    assert home == sorted(home) and home[0] > cq.HOME_GOALS
    assert away == sorted(away, reverse=True) and away[0] < cq.AWAY_GOALS


def test_the_record_is_shrunk_toward_zero_by_the_pseudo_count() -> None:
    assert shrunk(0.0, 0) == 0.0
    # One result of +2 moves the reading little ...
    assert shrunk(2.0, 1) == pytest.approx(2 / (1 + PSEUDO_COUNT))
    assert abs(shrunk(2.0, 1)) < 0.05
    # ... and PSEUDO_COUNT results read half their mean.
    n = int(PSEUDO_COUNT)
    assert shrunk(0.3 * n, n) == pytest.approx(0.15)


def test_tenure_grows_and_stops_at_the_cap() -> None:
    assert 0 < tenure(1) < tenure(10) < tenure(TENURE_CAP) == 1.0
    assert tenure(TENURE_CAP + 50) == 1.0


def test_the_record_follows_the_coach_across_clubs_strictly_before_the_day() -> None:
    lineups = club("A", ["x"] * 5 + ["y"] * 5) + club("B", ["z"] * 10 + ["x"] * 5)
    coaching = Coaching(lineups)
    scored = [Scored(day(i), "A", "C", 2, 0, 1.0, 1.0) for i in range(5)]  # x at A: +1 / -1
    scored += [Scored(day(10 + i), "D", "B", 1, 1, 1.0, 1.5) for i in range(5)]  # x at B, away
    records = Records(scored, coaching)
    # At B he scored 1 against 1.5 expected and conceded 1 against 1.
    assert records.before("x", day(12)) == (7, pytest.approx(5 - 1.0), pytest.approx(-5.0))
    assert records.before("x", day(10)) == (5, 5.0, -5.0)  # the day's own match is not in it
    assert records.before("y", day(12)) == (0, 0.0, 0.0)  # y's matches were not scored
    assert records.coaches == 1  # C and D name no one

    quality = CoachQuality(coaching, records, {})
    # B's latest line-up before day 12 names x, his third match at B (z's spell was seen).
    assert quality.reading("XL", "B", day(12)) == Reading(
        pytest.approx(4 / (7 + PSEUDO_COUNT)), pytest.approx(-5 / (7 + PSEUDO_COUNT)), tenure(2)
    )


def test_a_coach_who_cannot_be_told_is_never_read_and_a_new_one_reads_tenure_only() -> None:
    names: list[str | None] = ["x"] * (TENURE_CAP + 1) + ["y", None, "y"]
    quality = CoachQuality(Coaching(club("A", names)), Records([], Coaching([])), {})

    def read(week: int) -> Reading | None:
        return quality.reading("XL", "A", day(week))

    assert read(0) is None  # no line-up before the day
    assert read(1) is None  # the club's first stored coach, his spell may be new: never guessed
    assert read(TENURE_CAP) == Reading(0.0, 0.0, 1.0)  # past the cap he is known
    # y arrived by a change: one match in post, no record, a tenure-only reading.
    assert read(TENURE_CAP + 2) == Reading(0.0, 0.0, tenure(1))
    assert read(TENURE_CAP + 3) is None  # the latest line-up names no coach
    assert read(TENURE_CAP + 4) == Reading(0.0, 0.0, tenure(2))  # the gap counts for no one


def test_two_line_ups_on_one_day_are_not_told_apart() -> None:
    lineups = [
        LineUp("A", "f1", START, "2024/25", "x"),
        LineUp("A", "f2", START + timedelta(hours=3), "2024/25", "x"),
    ]
    coaching = Coaching(lineups)
    assert coaching.coach_on("A", day(0)) is None
    assert coaching.latest_before("A", day(1)) is None


def test_a_football_data_club_reaches_its_line_ups_through_the_alias() -> None:
    lineups = club("A", ["x"] * 3) + club("B", ["u"] + ["w"] * 5) + club("A", ["v"], 3)
    quality = CoachQuality(Coaching(lineups), Records([], Coaching([])), {("E0", "Arsenal"): "A"})
    on = day(5)
    assert quality.reading("E0", "Arsenal", on) == quality.reading("XL", "A", on)
    assert quality.reading("E0", "Arsenal", on) is not None
    term = coach_quality_input(quality).features
    x = term.features_of("E0", MatchObservation(on, "Arsenal", "B", 0, 0), [])
    assert x is not None
    home, away = quality.reading("XL", "A", on), quality.reading("XL", "B", on)
    assert home is not None and away is not None
    assert list(x[0]) == [home.scoring, away.conceding, home.tenure, away.tenure]
    assert list(x[1]) == [away.scoring, home.conceding, away.tenure, home.tenure]
    # An unaliased name reaches no line-up.
    assert term.features_of("E0", MatchObservation(on, "Chelsea", "B", 0, 0), []) is None


def test_the_input_is_found_and_needs_the_database() -> None:
    assert "coach_quality" in available()
    with pytest.raises(LookupError):
        build(InputContext(None, ("XL",), date(2025, 6, 30)))


def test_the_harness_fits_a_planted_coach_effect() -> None:
    rng = np.random.default_rng(1658)
    teams = [f"T{i}" for i in range(10)]
    coaches = [f"c{i}" for i in range(12)]
    quality_of = {c: (0.3, -0.3, 0.0)[i % 3] for i, c in enumerate(coaches)}
    rounds, spell = 180, 30
    # Every `spell` rounds, staggered by club, each coach moves on to the next club.
    coach_at = {
        t: [coaches[(i + (r + 3 * i) // spell) % len(coaches)] for r in range(rounds)]
        for i, t in enumerate(teams)
    }
    lineups: list[LineUp] = []
    results: list[EloMatch] = []
    matches: list[BacktestMatch] = []
    for r in range(rounds):
        kickoff = START + timedelta(days=4 * r)
        order = rng.permutation(teams)
        for k in range(5):
            h, a = str(order[2 * k]), str(order[2 * k + 1])
            qh, qa = quality_of[coach_at[h][r]], quality_of[coach_at[a][r]]
            hg = int(rng.poisson(1.4 * np.exp(qh - qa)))
            ag = int(rng.poisson(1.1 * np.exp(qa - qh)))
            for t in (h, a):
                lineups.append(LineUp(t, f"f{r}-{k}", kickoff, "2024/25", coach_at[t][r]))
            results.append(EloMatch("XL", kickoff.date(), h, a, hg, ag))
            matches.append(BacktestMatch(kickoff.date(), h, a, hg, ag))
    quality = CoachQuality.of(results, lineups, {})
    run = run_division(
        "XL",
        "our_records",
        matches,
        (matches[0].date + timedelta(days=4 * 120), matches[-1].date),
        candidate=BASELINE,
        model_input=coach_quality_input(quality),
        min_history=60,
    )
    applied = [s for s in run.scores if s.applied]
    assert applied

    def planted(team: str, on: date) -> float:
        return quality_of[coach_at[team][(on - START.date()).days // 4]]

    # Where the home side's coach is the better one, the term raises its chance.
    better = [
        s
        for s in applied
        if planted(s.match.home, s.match.date) > planted(s.match.away, s.match.date)
    ]
    worse = [
        s
        for s in applied
        if planted(s.match.home, s.match.date) < planted(s.match.away, s.match.date)
    ]
    assert better and worse
    assert np.mean([s.with_input.home - s.candidate.home for s in better]) > 0
    assert np.mean([s.with_input.home - s.candidate.home for s in worse]) < 0
