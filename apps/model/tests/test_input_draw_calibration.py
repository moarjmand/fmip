"""The draw recalibration (T-1657, D-308) and the harness's second kind of input.

The harness runs here use a closed-form fit in place of the Dixon-Coles
optimiser (``plain_fitter``), so their numbers do not depend on SciPy's
optimiser and the term-input numbers below can be compared exactly with what
the harness gave before T-1657.
"""

import json
import math
from collections.abc import Iterator, Mapping, Sequence
from datetime import date, timedelta

import numpy as np
import pytest
from test_backtest_inputs import CANDIDATE, START, WINDOW, simulate

import fmip_model.backtest.inputs as harness
import fmip_model.backtest.walk_forward as walk
from fmip_model.backtest.inputs import (
    DivisionRun,
    MatchScore,
    draw_band_error,
    draw_reliability,
    judge,
    render,
    report_body,
    run_division,
)
from fmip_model.backtest.metrics import Forecast
from fmip_model.backtest.walk_forward import BacktestMatch, Fitter
from fmip_model.inputs import (
    CalibrationInput,
    InputContext,
    PastForecast,
    Probabilities,
    available,
    load,
)
from fmip_model.inputs.draw_calibration import DrawCalibration, DrawCalibrationInput, gap
from fmip_model.model.dixon_coles import FittedModel, MatchObservation, time_weights
from fmip_model.model.poisson import outcome_from_matrix, score_matrix
from fmip_model.model.version import ModelVersion

# --- synthetic forecasts with a known draw ------------------------------------------


def past(p: Probabilities, true_draw: float, rng: np.random.Generator, day: date) -> PastForecast:
    """A past match forecast ``p`` whose draw happens with ``true_draw``; home and away in
    the forecast's own ratio."""
    if rng.random() < true_draw:
        goals = (1, 1)
    else:
        goals = (1, 0) if rng.random() < p[0] / (p[0] + p[2]) else (0, 1)
    match = MatchObservation(day, "H", "A", *goals)
    return PastForecast(match, day - timedelta(days=1), p)


def jittered(p: Probabilities, rng: np.random.Generator) -> Probabilities:
    e = float(rng.uniform(-0.02, 0.02))
    return p[0] + e, p[1], p[2] - e


#: The live record's shape (D-303): even and big favourites calibrated, the
#: mid gap's draw said 27% and seen 19%.
CLUSTERS: dict[str, tuple[Probabilities, float]] = {
    "even": ((0.37, 0.28, 0.35), 0.28),
    "mid": ((0.465, 0.27, 0.265), 0.19),
    "big favourite": ((0.72, 0.18, 0.10), 0.18),
}
DAY = date(2024, 1, 10)


#: Past forecasts per cluster. The tolerances below hold with a margin over twelve
#: seeds (the worst: 0.0074 from the sample's own rate, 0.011 from the truth, 0.0088
#: moved where the draw was calibrated); the noise of a rate on 10,000 is about 0.0045.
PER_CLUSTER = 10_000


def test_it_lowers_an_over_forecast_draw_and_leaves_the_calibrated_bands_alone() -> None:
    rng = np.random.default_rng(1657)
    history = [
        past(jittered(p, rng), true_draw, rng, DAY)
        for p, true_draw in CLUSTERS.values()
        for _ in range(PER_CLUSTER)
    ]
    calibration = DrawCalibrationInput().calibrate("T9", history, DAY)
    assert calibration is not None and calibration.samples == 3 * PER_CLUSTER
    for i, (name, (p, true_draw)) in enumerate(CLUSTERS.items()):
        mine = history[PER_CLUSTER * i : PER_CLUSTER * (i + 1)]
        seen = sum(1 for h in mine if h.result == "D") / len(mine)
        after = calibration.apply(p)[1]
        assert after == pytest.approx(seen, abs=0.012), name
        assert after == pytest.approx(true_draw, abs=0.02), name
        if name == "mid":
            assert after < p[1] - 0.05  # learnt to lower it
        else:
            assert after == pytest.approx(p[1], abs=0.015)  # left alone


def dixon_coles_forecasts(n: int, rng: np.random.Generator) -> list[Probabilities]:
    out: list[Probabilities] = []
    for _ in range(n):
        sh, sa = rng.normal(0, 0.3, 2)
        o = outcome_from_matrix(score_matrix(math.exp(0.35 + sh - sa), math.exp(0.1 + sa - sh)))
        out.append((o.home_win, o.draw, o.away_win))
    return out


def test_a_calibrated_draw_is_left_about_where_it_was() -> None:
    rng = np.random.default_rng(7)
    forecasts = dixon_coles_forecasts(12000, rng)
    history = [past(p, p[1], rng, DAY) for p in forecasts]
    calibration = DrawCalibrationInput().calibrate("T9", history, DAY)
    assert calibration is not None
    moved = [abs(calibration.apply(p)[1] - p[1]) for p in forecasts if gap(p) < 0.7]
    # Over twelve seeds the worst were 0.0067 on average and 0.027 at the extremes.
    assert float(np.mean(moved)) < 0.01
    assert max(moved) < 0.04


def test_probabilities_still_sum_to_one_and_home_and_away_keep_their_ratio() -> None:
    rng = np.random.default_rng(3)
    forecasts = dixon_coles_forecasts(200, rng) + [(0.98, 0.015, 0.005), (0.005, 0.015, 0.98)]
    for a, b, c in [(0.0, 0.0, 0.0), (-0.2, -3.9, 7.0), (2.0, -5.0, 8.0), (-3.0, 4.0, -6.0)]:
        calibration = DrawCalibration(a, b, c, 1000)
        for p in forecasts:
            q = calibration.apply(p)
            assert sum(q) == pytest.approx(1.0, abs=1e-12)
            assert min(q) > 0
            assert q[0] / q[2] == pytest.approx(p[0] / p[2], rel=1e-12)
            Forecast(*q)  # the harness's own check
    assert DrawCalibration(0.0, 0.0, 0.0, 1).apply((0.5, 0.3, 0.2)) == pytest.approx(
        (0.5, 0.3, 0.2), abs=1e-15
    )


def test_too_little_history_is_not_read_and_nothing_after_the_fit_date_is() -> None:
    rng = np.random.default_rng(11)
    p, true_draw = CLUSTERS["mid"]
    history = [past(p, true_draw, rng, DAY) for _ in range(299)]
    assert DrawCalibrationInput().calibrate("T9", history, DAY) is None
    later = [past(p, true_draw, rng, DAY + timedelta(days=5)) for _ in range(50)]
    assert DrawCalibrationInput().calibrate("T9", history + later, DAY) is None
    calibration = DrawCalibrationInput().calibrate("T9", history + later, DAY + timedelta(days=5))
    assert calibration is not None and calibration.samples == 349


def test_the_input_is_found_by_name_and_is_a_recalibration() -> None:
    assert "draw_calibration" in available()
    built = load("draw_calibration", InputContext(None, ("E0",), date(2026, 1, 1)))
    assert isinstance(built, CalibrationInput)
    assert not isinstance(load("null", InputContext(None, ("E0",), date(2026, 1, 1))),
                          CalibrationInput)  # fmt: skip


# --- the harness ----------------------------------------------------------------------


def plain_fitter(version: ModelVersion) -> Fitter:
    """A closed-form fit: each club's time-weighted scoring and conceding rates."""

    def fit(
        history: Sequence[MatchObservation], fit_date: date, elo: Mapping[str, float] | None
    ) -> FittedModel:
        teams = sorted({m.home for m in history} | {m.away for m in history})
        w = time_weights([m.date for m in history], fit_date, version.xi)
        hg = np.array([m.home_goals for m in history], dtype=np.float64)
        ag = np.array([m.away_goals for m in history], dtype=np.float64)
        home_rate = float(w @ hg / w.sum())
        away_rate = float(w @ ag / w.sum())
        mean = (home_rate + away_rate) / 2
        scored = dict.fromkeys(teams, mean)
        conceded = dict.fromkeys(teams, mean)
        played = dict.fromkeys(teams, 1.0)
        for m, wi in zip(history, w, strict=True):
            scored[m.home] += wi * m.home_goals
            scored[m.away] += wi * m.away_goals
            conceded[m.home] += wi * m.away_goals
            conceded[m.away] += wi * m.home_goals
            played[m.home] += wi
            played[m.away] += wi
        half = 0.5 * math.log(home_rate / away_rate)
        return FittedModel(
            fit_date=fit_date,
            teams=tuple(teams),
            attack={t: math.log(scored[t] / played[t]) - half for t in teams},
            defence={t: math.log(conceded[t] / played[t] / mean) for t in teams},
            home_advantage=2 * half,
            rho=-0.05,
            xi=version.xi,
            matches_used=len(history),
            log_likelihood=0.0,
        )

    return fit


@pytest.fixture(scope="module")
def plain() -> Iterator[None]:
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(harness, "default_fitter", plain_fitter)
        patch.setattr(walk, "default_fitter", plain_fitter)
        yield


@pytest.fixture(scope="module")
def matches() -> list[BacktestMatch]:
    return simulate(effect=0.0, seed=5)[0]


@pytest.fixture(scope="module")
def null_run(plain: None, matches: list[BacktestMatch]) -> DivisionRun:
    null = load("null", InputContext(None, ("T9",), date(2026, 1, 1)))
    return run_division("T9", "football_data", matches, WINDOW, candidate=CANDIDATE,
                        model_input=null)  # fmt: skip


def test_an_existing_input_gives_the_numbers_it_gave_before_t1657(null_run: DivisionRun) -> None:
    """The ``null`` input's numbers, recorded from the harness as it was before T-1657
    (commit 4925703a) on the same simulated league and fit."""
    overall, groups = judge([null_run])
    fd = groups[0]
    assert (overall, fd.scored, fd.applied, null_run.refits) == ("failed", 350, 350, 24)
    assert null_run.calibration is None
    exact = pytest.approx
    assert fd.published is not None and fd.candidate is not None and fd.with_input is not None
    assert (fd.published.log_loss, fd.published.brier, fd.published.calibration_error) == exact(
        (0.92519, 0.54054, 0.06217), abs=1e-9
    )
    assert (fd.candidate.log_loss, fd.candidate.brier, fd.candidate.calibration_error) == exact(
        (0.92308, 0.53921, 0.06551), abs=1e-9
    )
    assert (
        fd.with_input.log_loss, fd.with_input.brier, fd.with_input.calibration_error
    ) == exact((0.92191, 0.53857, 0.0697), abs=1e-9)  # fmt: skip
    assert fd.difference == exact(-0.001168, abs=2e-6)
    assert fd.interval == exact((-0.005589, 0.002942), abs=2e-6)
    assert fd.calibration_interval == exact((-0.009448, 0.011725), abs=2e-6)
    first = null_run.scores[0]
    assert first.candidate.as_tuple() == exact(
        (0.6984685712189269, 0.19683639500777922, 0.10469503377329406), abs=1e-12
    )
    assert first.with_input.as_tuple() == exact(
        (0.6834188899632205, 0.204061864707466, 0.11251924532931357), abs=1e-7
    )
    # A term input's report has none of a recalibration's sections.
    body = report_body("null", "control", CANDIDATE, WINDOW, overall, groups, [null_run], "sim")
    assert "draw_reliability" not in body and "calibrations" not in body
    assert "The draw by the gap" not in render(body)


class Spy:
    """The draw calibration, recording what each refit was handed."""

    name = "spy_calibration"
    description = "leak check"

    def __init__(self) -> None:
        self.inner = DrawCalibrationInput(min_history=100)
        self.calls: list[tuple[date, list[PastForecast]]] = []

    def calibrate(
        self, division: str, history: Sequence[PastForecast], fit_date: date
    ) -> DrawCalibration | None:
        self.calls.append((fit_date, list(history)))
        return self.inner.calibrate(division, history, fit_date)


CALIBRATION_FROM = START + timedelta(days=30)


@pytest.fixture(scope="module")
def calibrated(plain: None, matches: list[BacktestMatch]) -> tuple[DivisionRun, Spy]:
    spy = Spy()
    run = run_division("T9", "football_data", matches, WINDOW, candidate=CANDIDATE,
                       model_input=spy, calibration_from=CALIBRATION_FROM)  # fmt: skip
    return run, spy


def test_a_recalibration_reads_only_out_of_sample_forecasts_up_to_its_fit_date(
    calibrated: tuple[DivisionRun, Spy],
) -> None:
    run, spy = calibrated
    assert spy.calls
    sizes = []
    for fit_date, history in spy.calls:
        assert history and all(h.match.date <= fit_date for h in history)
        assert all(h.fit_date < h.match.date for h in history)
        sizes.append(len(history))
    assert sizes == sorted(sizes)
    # The walk-forward before the window is part of the history from the first refit on.
    first = spy.calls[0][1]
    assert min(h.match.date for h in first) >= CALIBRATION_FROM
    assert any(h.match.date < WINDOW[0] for h in first)
    assert run.calibration is not None
    assert run.calibration.history_from == CALIBRATION_FROM
    assert run.calibration.before_window == sum(1 for h in first if h.match.date < WINDOW[0])
    assert 0 < run.calibration.calibrated_refits <= run.calibration.refits == len(spy.calls)
    assert set(run.calibration.last) == {"a", "b", "c", "samples"}


def test_the_candidate_and_published_columns_are_the_term_harness_own(
    calibrated: tuple[DivisionRun, Spy], null_run: DivisionRun
) -> None:
    run, _ = calibrated
    assert [s.match for s in run.scores] == [s.match for s in null_run.scores]
    assert [s.candidate for s in run.scores] == [s.candidate for s in null_run.scores]
    assert [s.published for s in run.scores] == [s.published for s in null_run.scores]
    applied = [s for s in run.scores if s.applied]
    skipped = [s for s in run.scores if not s.applied]
    assert applied and skipped  # the first refits had under 100 past forecasts
    assert all(s.with_input == s.candidate for s in skipped)
    assert all(sum(s.with_input.as_tuple()) == pytest.approx(1.0, abs=1e-12) for s in applied)


def test_the_report_carries_the_draw_reliability(calibrated: tuple[DivisionRun, Spy]) -> None:
    run, _ = calibrated
    overall, groups = judge([run])
    body = report_body("spy", "leak check", CANDIDATE, WINDOW, overall, groups, [run], "sim")
    json.dumps(body)  # dates written as text
    reliability = body["draw_reliability"]
    assert isinstance(reliability, dict)
    assert reliability["bands"] == [0.10, 0.25, 0.45]
    bands = reliability["groups"]["football_data"]["bands"]
    assert sum(b["matches"] for b in bands) == groups[0].applied
    calibrations = body["calibrations"]
    assert isinstance(calibrations, dict)
    assert calibrations["T9"]["history_from"] == CALIBRATION_FROM.isoformat()
    text = render(body)
    assert "## The draw by the gap between the sides" in text
    assert "| T9 | 2024-08-31 |" in text


def score(p: Probabilities, result: str, with_input: Probabilities | None = None) -> MatchScore:
    goals = {"H": (1, 0), "D": (0, 0), "A": (0, 1)}[result]
    match = BacktestMatch(DAY, "H", "A", *goals)
    f = Forecast(*p)
    return MatchScore(match, DAY, f, f, Forecast(*(with_input or p)), True)


def test_the_draw_reliability_bands_go_by_the_candidate_gap() -> None:
    scores = [
        score((0.36, 0.28, 0.36), "D"),
        score((0.36, 0.28, 0.36), "H"),
        score((0.47, 0.27, 0.26), "H", (0.50, 0.22, 0.28)),
        score((0.47, 0.27, 0.26), "A", (0.50, 0.22, 0.28)),
        score((0.80, 0.15, 0.05), "H"),
    ]
    bands = draw_reliability(scores)
    assert [(b.lower, b.upper, b.matches) for b in bands] == [
        (0.0, 0.10, 2), (0.10, 0.25, 2), (0.25, 0.45, 0), (0.45, None, 1)
    ]  # fmt: skip
    even, mid, empty, big = bands
    assert (even.said_candidate, even.seen) == (0.28, 0.5)
    assert (mid.said_candidate, mid.said_with_input, mid.seen) == (0.27, 0.22, 0.0)
    assert empty.seen is None and empty.seen_interval is None
    assert big.seen_interval is not None and big.seen_interval[0] == 0.0
    error = draw_band_error(bands)
    assert error["candidate"] == pytest.approx((2 * 0.22 + 2 * 0.27 + 0.15) / 5, abs=1e-4)
    assert error["with_input"] == pytest.approx((2 * 0.22 + 2 * 0.22 + 0.15) / 5, abs=1e-4)
