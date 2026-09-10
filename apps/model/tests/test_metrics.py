import math
from decimal import Decimal

import pytest

from fmip_model.backtest.market import implied_forecast, overround
from fmip_model.backtest.metrics import (
    UNIFORM,
    Forecast,
    brier,
    expected_calibration_error,
    log_loss,
    reliability,
)


def test_uniform_scores_are_the_textbook_values() -> None:
    forecasts = [UNIFORM] * 3
    results = ["H", "D", "A"]
    assert math.isclose(log_loss(forecasts, results), math.log(3))
    assert math.isclose(brier(forecasts, results), 2 / 3)


def test_a_perfect_forecaster_scores_zero_and_a_confident_wrong_one_is_punished() -> None:
    sure_home = Forecast(0.999998, 0.000001, 0.000001)
    assert log_loss([sure_home], ["H"]) < 1e-5
    assert brier([sure_home], ["H"]) < 1e-9
    assert log_loss([sure_home], ["A"]) > 10
    assert brier([sure_home], ["A"]) > 1.9


def test_forecast_must_be_a_distribution() -> None:
    with pytest.raises(ValueError):
        Forecast(0.5, 0.5, 0.5)
    with pytest.raises(ValueError):
        Forecast(1.2, -0.1, -0.1)


def test_reliability_bins_forecasts_and_reports_observed_rates() -> None:
    forecasts = [Forecast(0.75, 0.15, 0.10)] * 4 + [Forecast(0.25, 0.35, 0.40)] * 4
    results = ["H", "H", "H", "A", "A", "A", "A", "H"]

    bins = reliability(forecasts, results, "H", bins=4)

    assert [(b.lower, b.upper, b.count) for b in bins] == [(0.25, 0.5, 4), (0.75, 1.0, 4)]
    assert bins[0].observed_frequency == 0.25 and math.isclose(bins[0].mean_forecast, 0.25)
    assert bins[1].observed_frequency == 0.75 and math.isclose(bins[1].mean_forecast, 0.75)
    assert expected_calibration_error(bins) < 1e-9


def test_calibration_error_grows_with_the_gap() -> None:
    forecasts = [Forecast(0.9, 0.05, 0.05)] * 10
    results = ["H"] * 5 + ["A"] * 5  # said 90%, happened 50%
    bins = reliability(forecasts, results, "H", bins=10)
    assert math.isclose(expected_calibration_error(bins), 0.4)


def test_market_odds_are_de_margined() -> None:
    f = implied_forecast(Decimal("1.6"), Decimal("4.2"), Decimal("5.25"))
    assert math.isclose(f.home + f.draw + f.away, 1.0)
    # 1/1.6 = 0.625 before the margin; de-margined it sits just under 0.6.
    assert 0.58 < f.home < 0.625
    assert f.home > f.draw > f.away
    assert 0.04 < overround(Decimal("1.6"), Decimal("4.2"), Decimal("5.25")) < 0.06
    with pytest.raises(ValueError):
        implied_forecast(Decimal("1.6"), Decimal("4.2"), Decimal("-1"))
