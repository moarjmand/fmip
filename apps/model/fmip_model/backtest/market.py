"""Bookmaker odds as a forecast, for the calibration benchmark."""

from __future__ import annotations

from decimal import Decimal

from .metrics import Forecast


def implied_forecast(odds_home: Decimal, odds_draw: Decimal, odds_away: Decimal) -> Forecast:
    """De-margined implied probabilities from decimal odds.

    Inverse odds sum to more than one (the overround); dividing each by the
    total is the simplest normalisation and the usual benchmark. Anything
    cleverer (Shin, power) would flatter or punish the market by a few
    thousandths and is not the point of the comparison.
    """
    inverses = [1.0 / float(o) for o in (odds_home, odds_draw, odds_away)]
    if min(inverses) <= 0:
        raise ValueError("odds must be greater than one")
    total = sum(inverses)
    return Forecast(inverses[0] / total, inverses[1] / total, inverses[2] / total)


def overround(odds_home: Decimal, odds_draw: Decimal, odds_away: Decimal) -> float:
    """The bookmaker's margin: sum of inverse odds minus one."""
    return sum(1.0 / float(o) for o in (odds_home, odds_draw, odds_away)) - 1.0
