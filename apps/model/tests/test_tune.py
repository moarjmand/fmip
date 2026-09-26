"""Tuning the constants out of sample (T-532): chosen on one window, judged on the next."""

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
