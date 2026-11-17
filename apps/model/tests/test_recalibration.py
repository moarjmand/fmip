"""D-450 (T-1876): the temperature and draw map, its fitter, and dixon-coles-elo@0.9.0."""

import json
import math
from collections.abc import Callable
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import numpy as np
import pytest
from test_service import FROZEN_NOW, FakeSource, request

from fmip_model.backtest.compare import choose_reference
from fmip_model.backtest.compare import main as compare_main
from fmip_model.backtest.cross_league import variants_main
from fmip_model.backtest.elo_prior import main as elo_prior_main
from fmip_model.backtest.inputs import main as inputs_main
from fmip_model.backtest.lineups import main as lineups_main
from fmip_model.backtest.new_divisions import main as new_divisions_main
from fmip_model.backtest.recalibration import (
    BASE_FILE,
    WINDOW_FROM,
    WINDOW_TO,
    Row,
    calibration_block,
    fit_temperature_draw,
    frozen_pair,
    mean_log_loss,
    read_window,
    screen,
    version_body,
)
from fmip_model.model.calibration import (
    HALF,
    Calibration,
    at_strength,
    read_calibration,
    temperature_draw,
)
from fmip_model.model.poisson import outcome_from_matrix, score_matrix
from fmip_model.model.version import (
    CANDIDATES_DIR,
    PUBLISHED,
    backtest_version,
    load_candidate,
    load_candidates,
    refuse_calibrated,
)
from fmip_model.service.contract import ForecastRequest
from fmip_model.service.forecaster import Forecaster

CANDIDATE_FILE = CANDIDATES_DIR / "dixon-coles-elo-0.9.0.json"
REPORT_DIR = Path(__file__).parent.parent / "reports" / "dixon-coles-elo-0.9.0"
EXPORT = REPORT_DIR / "recalibration_window_2026-10-10..2026-11-17.csv"

SAMPLES = [
    (0.6, 0.25, 0.15),
    (0.2, 0.3, 0.5),
    (0.34, 0.33, 0.33),
    (0.8, 0.15, 0.05),
    (0.05, 0.1, 0.85),
    (0.4979, 0.2561, 0.246),
]


def calibration(t: float = 1.2, b: float = -0.2) -> Calibration:
    return Calibration(
        temperature=t,
        beta_draw=b,
        fitted_temperature=1 + (t - 1) * 2,
        fitted_beta_draw=b * 2,
        strength=HALF,
        window_from=WINDOW_FROM,
        window_to=WINDOW_TO,
        matches=1000,
        decision="D-450",
    )


# --- the map ---


@pytest.mark.parametrize("p", SAMPLES)
@pytest.mark.parametrize(("t", "b"), [(1.0, 0.0), (1.3, -0.2), (0.7, 0.4), (2.5, -1.0)])
def test_the_map_keeps_three_positive_probabilities_summing_to_one(
    p: tuple[float, float, float], t: float, b: float
) -> None:
    mapped = temperature_draw(p, t, b)
    assert math.isclose(sum(mapped), 1.0, abs_tol=1e-12)
    assert all(0 < x < 1 for x in mapped)


@pytest.mark.parametrize("p", SAMPLES)
def test_temperature_one_and_no_draw_term_is_the_identity(p: tuple[float, float, float]) -> None:
    total = sum(p)
    expected = tuple(x / total for x in p)
    assert temperature_draw(p, 1.0, 0.0) == pytest.approx(expected, abs=1e-12)


@pytest.mark.parametrize("p", SAMPLES)
def test_a_draw_term_moves_only_the_draw_and_keeps_home_and_away_in_ratio(
    p: tuple[float, float, float],
) -> None:
    previous = temperature_draw(p, 1.0, 0.0)[1]
    for b in (-0.1, -0.3, -0.6):
        h, d, a = temperature_draw(p, 1.0, b)
        assert d < previous  # monotone: a lower beta, a lower draw
        assert h / a == pytest.approx(p[0] / p[2], rel=1e-12)
        previous = d


def test_a_temperature_above_one_lifts_the_favourite_and_lowers_the_underdog() -> None:
    for p in SAMPLES:
        if max(p) - min(p) < 1e-9 or len(set(p)) < 3:
            continue
        top, bottom = p.index(max(p)), p.index(min(p))
        last = temperature_draw(p, 1.0, 0.0)
        for t in (1.1, 1.3, 1.8):
            mapped = temperature_draw(p, t, 0.0)
            assert mapped[top] > last[top]
            assert mapped[bottom] < last[bottom]
            # The order of the three outcomes is kept.
            assert sorted(range(3), key=lambda k: mapped[k]) == sorted(range(3), key=lambda k: p[k])
            last = mapped


def test_the_map_refuses_what_it_cannot_take() -> None:
    with pytest.raises(ValueError, match="positive"):
        temperature_draw((0.0, 0.5, 0.5), 1.1, 0.0)
    with pytest.raises(ValueError, match="temperature"):
        temperature_draw((0.3, 0.3, 0.4), 0.0, 0.0)


# --- the strength ---


def test_half_strength_halves_the_fitted_pair_in_parameter_space() -> None:
    assert at_strength(1.2, -0.3, HALF) == pytest.approx((1.1, -0.15))
    assert at_strength(0.9, 0.2, HALF) == pytest.approx((0.95, 0.1))
    assert at_strength(1.2, -0.3, 1.0) == pytest.approx((1.2, -0.3))
    with pytest.raises(ValueError, match="strength"):
        at_strength(1.2, -0.3, 0.0)


def test_a_file_whose_applied_pair_is_not_the_fitted_one_at_its_strength_is_refused() -> None:
    block = calibration().as_dict()
    assert read_calibration(block) == calibration()
    wrong = {**block, "temperature": 1.4}  # the full fitted pair, not its half
    with pytest.raises(ValueError, match="at its strength"):
        read_calibration(wrong)
    with pytest.raises(ValueError, match="kind"):
        read_calibration({**block, "kind": "isotonic"})
    # D-450 fixed the strength at a half: the full pair at strength 1 is refused too.
    full = {**block, "strength": 1.0, "temperature": 1.4, "beta_draw": -0.4}
    with pytest.raises(ValueError, match="fixed at 0.5 by D-450"):
        read_calibration(full)
    with pytest.raises(ValueError, match="decision"):
        read_calibration({**block, "decision": "D-999"})
    with pytest.raises(ValueError, match="lacks 'beta_draw'"):
        read_calibration({k: v for k, v in block.items() if k != "beta_draw"})


# --- the score table ---


def test_the_rescaled_table_totals_one_and_gives_the_mapped_probabilities() -> None:
    matrix = score_matrix(1.6, 0.9, -0.05)
    base = outcome_from_matrix(matrix)
    cal = calibration()
    rescaled = cal.rescale(matrix)
    mapped = outcome_from_matrix(rescaled)
    assert float(rescaled.sum()) == pytest.approx(1.0, abs=1e-12)
    assert (mapped.home_win, mapped.draw, mapped.away_win) == pytest.approx(
        cal.apply((base.home_win, base.draw, base.away_win)), abs=1e-12
    )
    # Within an outcome every score keeps its share.
    assert rescaled[2, 1] / rescaled[1, 0] == pytest.approx(matrix[2, 1] / matrix[1, 0])
    identity = replace(cal, temperature=1.0, beta_draw=0.0)
    assert identity.rescale(matrix) == pytest.approx(matrix, abs=1e-15)


# --- the fitter ---


def _rows(p: list[tuple[float, float, float]], outcomes: list[int]) -> list[Row]:
    start = datetime(2026, 10, 10, 12, tzinfo=UTC)
    return [
        Row(
            fixture_id=f"f{i:05d}",
            kickoff_at=start + timedelta(minutes=50 * i),
            competition_id="c",
            model_id="dixon-coles-elo@0.7.0",
            role="shadow",
            forecast_id=f"x{i:05d}",
            p=pi,
            outcome=o,
        )
        for i, (pi, o) in enumerate(zip(p, outcomes, strict=True))
    ]


def _simulate(n: int, t: float, b: float, seed: int) -> list[Row]:
    rng = np.random.default_rng(seed)
    p: list[tuple[float, float, float]] = []
    outcomes: list[int] = []
    for _ in range(n):
        lam, mu = float(rng.uniform(0.6, 2.4)), float(rng.uniform(0.5, 1.8))
        o = outcome_from_matrix(score_matrix(lam, mu))
        base = (o.home_win, o.draw, o.away_win)
        p.append(base)
        outcomes.append(int(rng.choice(3, p=np.array(temperature_draw(base, t, b)))))
    return _rows(p, outcomes)


def test_the_fit_recovers_a_known_map_and_is_deterministic() -> None:
    rows = _simulate(20_000, 1.3, -0.25, seed=450)
    fit = fit_temperature_draw(rows)
    assert fit.temperature == pytest.approx(1.3, abs=0.06)
    assert fit.beta_draw == pytest.approx(-0.25, abs=0.06)
    assert fit_temperature_draw(rows) == fit
    # It is the maximum: either parameter moved lowers the likelihood.
    best = mean_log_loss(rows, fit.temperature, fit.beta_draw)
    assert best == pytest.approx(fit.mean_log_loss, abs=1e-9)
    for dt, db in ((0.02, 0), (-0.02, 0), (0, 0.02), (0, -0.02)):
        assert mean_log_loss(rows, fit.temperature + dt, fit.beta_draw + db) > best


def test_on_calibrated_forecasts_the_fit_is_near_the_identity_and_the_screen_fails() -> None:
    rows = _simulate(6_000, 1.0, 0.0, seed=7)
    fit = fit_temperature_draw(rows)
    assert fit.temperature == pytest.approx(1.0, abs=0.06)
    assert fit.beta_draw == pytest.approx(0.0, abs=0.06)
    # A map whose directions are the other way round never passes.
    sharp = _simulate(3_000, 0.8, 0.3, seed=8)
    assert not screen(sharp).directions
    assert not screen(sharp).passed


def test_the_screen_passes_a_persisting_deficit() -> None:
    result = screen(_simulate(3_000, 1.3, -0.25, seed=9))
    assert result.fit_matches == 2_000 and result.scored_matches == 1_000
    assert result.applied == pytest.approx(
        at_strength(result.fitted.temperature, result.fitted.beta_draw, HALF)
    )
    assert result.lower_log_loss and result.directions and result.passed


def test_the_window_refuses_a_kick_off_outside_it_and_a_match_twice(tmp_path: Path) -> None:
    header = "fixture_id,kickoff_at,competition_id,model_id,role,forecast_id,computed_at,"
    header += "p_home,p_draw,p_away,outcome\n"
    good = "a,2026-11-17T23:30:00Z,c,dixon-coles-elo@0.7.0,published,f,x,0.5,0.25,0.25,home\n"
    path = tmp_path / "w.csv"
    path.write_text(header + good)
    assert len(read_window(path)) == 1
    late = "b,2026-11-18T00:00:00Z,c,dixon-coles-elo@0.7.0,published,f,x,0.5,0.25,0.25,home\n"
    path.write_text(header + good + late)
    with pytest.raises(ValueError, match="outside"):
        read_window(path)
    path.write_text(header + good + good)
    with pytest.raises(ValueError, match="twice"):
        read_window(path)
    other = "c,2026-11-01T12:00:00Z,c,dixon-coles-elo@0.1.0,published,f,x,0.5,0.25,0.25,home\n"
    path.write_text(header + other)
    with pytest.raises(ValueError, match="0.7.0"):
        read_window(path)


# --- dixon-coles-elo@0.9.0 ---


def test_0_9_0_is_0_7_0_with_the_calibration_block_and_nothing_else() -> None:
    candidate = load_candidate(CANDIDATE_FILE)
    assert candidate is not None and candidate.id == "dixon-coles-elo@0.9.0"
    assert load_candidates() == {"dixon-coles-elo-0.9.0": candidate}
    assert PUBLISHED.id == "dixon-coles-elo@0.7.0" and PUBLISHED.calibration is None
    assert candidate.calibration is not None
    same = replace(candidate, version=PUBLISHED.version, calibration=None)
    assert same == PUBLISHED
    assert same.as_dict() == PUBLISHED.as_dict()
    assert dict(same.per_division) == dict(PUBLISHED.per_division)
    assert same.divisions == PUBLISHED.divisions
    base = json.loads(BASE_FILE.read_text(encoding="utf-8"))
    body = json.loads(CANDIDATE_FILE.read_text(encoding="utf-8"))
    assert {k: v for k, v in body.items() if k not in ("version", "source", "calibration")} == {
        k: v for k, v in base.items() if k not in ("version", "source")
    }


def test_0_9_0_froze_the_committed_window_s_fit_at_half_strength() -> None:
    """The constants are recomputable from the committed export alone (D-450)."""
    candidate = load_candidate(CANDIDATE_FILE)
    assert candidate is not None and candidate.calibration is not None
    cal = candidate.calibration
    assert cal.strength == HALF and cal.decision == "D-450"
    assert (cal.window_from, cal.window_to) == (date(2026, 10, 10), date(2026, 11, 17))
    rows = read_window(EXPORT)
    result = screen(rows)
    assert result.passed
    pair = frozen_pair(result.whole)
    assert cal.fitted_temperature == pair["fitted_temperature"] > 1
    assert cal.fitted_beta_draw == pair["fitted_beta_draw"] < 0
    assert (cal.temperature, cal.beta_draw) == (pair["temperature"], pair["beta_draw"])
    assert cal.matches == len(rows)
    body = json.loads(CANDIDATE_FILE.read_text(encoding="utf-8"))
    base = json.loads(BASE_FILE.read_text(encoding="utf-8"))
    assert body == version_body(base, calibration_block(rows, result))


def test_the_published_0_7_0_forecasts_exactly_as_its_table_says() -> None:
    """No block, no change: the probabilities are the score table's own (rule 5)."""
    source = FakeSource()
    forecaster = Forecaster(source, version=PUBLISHED, clock=lambda: FROZEN_NOW)
    answer = forecaster.forecast(ForecastRequest.model_validate(request()))
    assert answer.status == "available"
    cached = next(iter(forecaster._fits.values()))
    table = cached.model.predict("Liverpool", "Man United")
    p = answer.probabilities
    assert (p.home, p.draw, p.away) == table.rounded(4)
    assert answer.expected_goals.home == round(table.expected_home_goals, 3)
    assert [(s.home, s.away) for s in answer.most_likely_scorelines] == [
        (s.home, s.away) for s in table.most_likely
    ]


def test_0_9_0_answers_0_7_0_s_forecast_mapped_with_the_same_expected_goals() -> None:
    candidate = load_candidate(CANDIDATE_FILE)
    assert candidate is not None and candidate.calibration is not None
    source = FakeSource()
    published = Forecaster(source, version=PUBLISHED, clock=lambda: FROZEN_NOW)
    shadow = Forecaster(source, version=candidate, clock=lambda: FROZEN_NOW)
    body = ForecastRequest.model_validate(request())
    base, mapped = published.forecast(body), shadow.forecast(body)
    assert base.status == mapped.status == "available"
    assert mapped.inputs.model_version == "dixon-coles-elo@0.9.0"
    assert mapped.expected_goals == base.expected_goals
    table = next(iter(published._fits.values())).model.predict("Liverpool", "Man United")
    expected = candidate.calibration.apply((table.home_win, table.draw, table.away_win))
    p = mapped.probabilities
    assert (p.home, p.draw, p.away) == pytest.approx(expected, abs=1e-4)
    assert p.home + p.draw + p.away == pytest.approx(1.0, abs=1e-9)
    assert p.draw < base.probabilities.draw


# --- the backtest harnesses do not apply a calibration (T-1876) ---

CALIBRATED = "dixon-coles-elo-0.9.0"


def test_a_backtest_defaults_to_a_version_it_can_score() -> None:
    """0.9.0 is the newest candidate, but a backtest's default passes over it."""
    assert load_candidate() is None
    assert backtest_version() == PUBLISHED
    assert backtest_version("published") == PUBLISHED
    assert backtest_version(f"{PUBLISHED.name}-{PUBLISHED.version}") == PUBLISHED


def test_a_backtest_refuses_a_calibrated_version_by_name() -> None:
    with pytest.raises(ValueError, match="D-450"):
        backtest_version(CALIBRATED)
    with pytest.raises(LookupError, match="published"):
        backtest_version("dixon-coles-elo-9.9.9")
    candidate = load_candidate(CANDIDATE_FILE)
    assert candidate is not None
    with pytest.raises(ValueError, match="cannot score it"):
        refuse_calibrated(candidate)
    with pytest.raises(ValueError, match="D-450"):
        choose_reference(PUBLISHED, CALIBRATED)
    assert choose_reference(candidate, None) == PUBLISHED  # never the calibrated default


HARNESSES: list[tuple[Callable[[list[str]], int], list[str]]] = [
    (
        inputs_main,
        ["--input", "null", "--divisions", "E0", "--from", "2025-08-01", "--to", "2025-09-01"],
    ),
    (
        elo_prior_main,
        ["--from", "2025-08-01", "--to", "2025-09-01", "--history-from", "2023-08-01"],
    ),
    (lineups_main, ["--divisions", "E0", "--split", "2025-08-01", "--until", "2025-09-01"]),
    (new_divisions_main, []),
]


@pytest.mark.parametrize(("main", "argv"), HARNESSES)
def test_every_harness_refuses_the_calibrated_candidate_before_it_reads_anything(
    main: Callable[[list[str]], int],
    argv: list[str],
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    # A database that does not exist: the refusal must come before any connection.
    monkeypatch.setenv("DATABASE_URL", "postgresql://nobody@127.0.0.1:1/none")
    assert main([*argv, "--candidate", CALIBRATED]) == 2
    assert "D-450" in capsys.readouterr().err


def test_the_cross_league_variants_and_compare_refuse_it_too(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://nobody@127.0.0.1:1/none")
    assert (
        variants_main(["--from", "2024-08-01", "--to", "2024-09-01", "--version", CALIBRATED]) == 2
    )
    assert "D-450" in capsys.readouterr().err
    assert compare_main(["--candidate-file", str(CANDIDATE_FILE)]) == 2
    assert "D-450" in capsys.readouterr().err
