"""Tuning the constants out of sample (T-532): chosen on one window, judged on the next."""

from dataclasses import replace

import pytest
from test_walk_forward import simulate

from fmip_model.backtest.tune import MIN_GAIN, adopt, best_pair, tune_division
from fmip_model.model.version import BASELINE


def test_the_lowest_log_loss_wins_and_a_tie_keeps_the_published_constants() -> None:
    published = (BASELINE.xi, BASELINE.ridge)
    assert best_pair({(0.002, 0.01): 0.99, published: 1.01, (0.012, 0.03): 1.0}) == (0.002, 0.01)
    assert best_pair({(0.002, 0.01): 1.0, published: 1.0}) == published
    with pytest.raises(ValueError):
        best_pair({})


def test_a_new_constant_must_beat_the_published_one_on_the_unseen_window() -> None:
    assert adopt(test_baseline=1.000, test_tuned=1.000 - MIN_GAIN)
    assert not adopt(test_baseline=1.000, test_tuned=1.000 - MIN_GAIN / 2)
    assert not adopt(test_baseline=1.000, test_tuned=1.010)


def test_tuning_walks_forward_on_one_window_and_judges_on_the_next() -> None:
    matches = simulate(seasons=6)
    middle = matches[len(matches) // 2].date
    late = matches[3 * len(matches) // 4].date
    tuned = tune_division(
        "sim",
        matches,
        tune=(middle, late),
        test=(late, matches[-1].date),
        xi_grid=(0.004, BASELINE.xi),
        ridge_grid=(BASELINE.ridge,),
        refit_every_days=28,
    )

    assert tuned.division == "sim"
    assert (tuned.xi, tuned.ridge) in {(0.004, BASELINE.ridge), (BASELINE.xi, BASELINE.ridge)}
    assert tuned.test_forecasts > 0
    # Adopted exactly when the unseen window says so, never for the published pair itself.
    assert tuned.adopted == adopt(tuned.test_baseline, tuned.test_log_loss)
    if (tuned.xi, tuned.ridge) == (BASELINE.xi, BASELINE.ridge):
        assert tuned.test_log_loss == tuned.test_baseline
        assert not tuned.adopted


def test_tuning_on_top_of_a_candidate_judges_against_its_own_constants() -> None:
    # T-1372: the base is the candidate, its division constants are what to beat.
    matches = simulate(seasons=6)
    middle = matches[len(matches) // 2].date
    late = matches[3 * len(matches) // 4].date
    base = replace(BASELINE, version="0.9.0", history_days=900, per_division={"sim": (0.004, 0.1)})
    tuned = tune_division(
        "sim",
        matches,
        tune=(middle, late),
        test=(late, matches[-1].date),
        xi_grid=(0.004, 0.002),
        ridge_grid=(0.1,),
        refit_every_days=28,
        base=base,
        test_grid=True,
    )
    assert tuned.base == base.id and (tuned.base_xi, tuned.base_ridge) == (0.004, 0.1)
    assert {(x, r) for x, r, _ in tuned.tune_grid} == {(0.004, 0.1), (0.002, 0.1)}
    tested = {(x, r): ll for x, r, ll in tuned.test_grid}
    assert set(tested) == {(0.004, 0.1), (0.002, 0.1)}
    assert tested[(0.004, 0.1)] == pytest.approx(tuned.test_baseline, abs=1e-5)
    assert tuned.adopted == adopt(tuned.test_baseline, tuned.test_log_loss)
