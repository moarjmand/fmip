"""Walk-forward evaluation: fit on the past, forecast the day, score it."""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from ..model.dixon_coles import FittedModel, MatchObservation, fit
from ..model.version import BASELINE, ModelVersion
from .market import implied_forecast
from .metrics import (
    Forecast,
    ReliabilityBin,
    Result,
    brier,
    expected_calibration_error,
    log_loss,
    reliability,
)


@dataclass(frozen=True)
class BacktestMatch(MatchObservation):
    """A training-store match with its closing odds, if the source had them."""

    odds_home: Decimal | None = None
    odds_draw: Decimal | None = None
    odds_away: Decimal | None = None

    @property
    def result(self) -> Result:
        if self.home_goals > self.away_goals:
            return "H"
        if self.home_goals < self.away_goals:
            return "A"
        return "D"

    @property
    def market(self) -> Forecast | None:
        if self.odds_home is None or self.odds_draw is None or self.odds_away is None:
            return None
        return implied_forecast(self.odds_home, self.odds_draw, self.odds_away)


@dataclass(frozen=True)
class ScoredForecast:
    match: BacktestMatch
    fit_date: date
    model: Forecast
    market: Forecast | None


@dataclass(frozen=True)
class Scorecard:
    n: int
    log_loss: float
    brier: float
    reliability_home: list[ReliabilityBin]
    reliability_draw: list[ReliabilityBin]
    reliability_away: list[ReliabilityBin]

    @property
    def calibration_error(self) -> float:
        return (
            expected_calibration_error(self.reliability_home)
            + expected_calibration_error(self.reliability_draw)
            + expected_calibration_error(self.reliability_away)
        ) / 3


def scorecard(
    forecasts: Sequence[Forecast], results: Sequence[Result], bins: int = 10
) -> Scorecard:
    return Scorecard(
        n=len(forecasts),
        log_loss=log_loss(forecasts, results),
        brier=brier(forecasts, results),
        reliability_home=reliability(forecasts, results, "H", bins),
        reliability_draw=reliability(forecasts, results, "D", bins),
        reliability_away=reliability(forecasts, results, "A", bins),
    )


@dataclass(frozen=True)
class BacktestResult:
    model_version: ModelVersion
    scope: str
    window_start: date
    window_end: date
    refits: int
    forecasts: list[ScoredForecast]
    model: Scorecard
    market: Scorecard | None
    """Scored on the same matches the market priced; ``None`` if none had odds."""
    uniform: Scorecard

    @property
    def matches_with_odds(self) -> int:
        return sum(1 for f in self.forecasts if f.market is not None)


Fitter = Callable[[Sequence[MatchObservation], date, Mapping[str, float] | None], FittedModel]


def default_fitter(version: ModelVersion) -> Fitter:
    def _fit(
        history: Sequence[MatchObservation], fit_date: date, elo: Mapping[str, float] | None
    ) -> FittedModel:
        return fit(
            history,
            fit_date,
            elo=elo,
            xi=version.xi,
            ridge=version.ridge,
            elo_weight=version.elo_weight,
        )

    return _fit


def walk_forward(
    matches: Sequence[BacktestMatch],
    *,
    window_start: date,
    window_end: date,
    scope: str,
    min_history: int = 60,
    refit_every_days: int = 7,
    version: ModelVersion = BASELINE,
    elo_on: Callable[[date], Mapping[str, float] | None] | None = None,
    fitter: Fitter | None = None,
) -> BacktestResult:
    """Forecast every match in ``[window_start, window_end]`` with a model that
    has seen only earlier matches.

    The model is refitted at most every ``refit_every_days``; between refits
    the last fit is reused, which is how the service will run (T-063) and
    keeps a season's backtest to a few dozen fits. Matches before
    ``min_history`` prior observations are skipped rather than forecast from
    nothing. A match whose teams the fit does not know (first appearance,
    no Elo) is skipped and counted.
    """
    if window_end < window_start:
        raise ValueError("window_end before window_start")

    ordered = sorted(matches, key=lambda m: m.date)
    fitter = fitter or default_fitter(version)

    scored: list[ScoredForecast] = []
    model: FittedModel | None = None
    last_fit: date | None = None
    refits = 0

    for i, match in enumerate(ordered):
        if match.date < window_start or match.date > window_end:
            continue
        history = ordered[:i]
        history = [h for h in history if h.date < match.date]  # same-day matches are not known yet
        if len(history) < min_history:
            continue

        fit_date = match.date - timedelta(days=1)
        if model is None or last_fit is None or (fit_date - last_fit).days >= refit_every_days:
            model = fitter(history, fit_date, elo_on(fit_date) if elo_on else None)
            last_fit = fit_date
            refits += 1

        try:
            outcome = model.predict(match.home, match.away)
        except KeyError:
            continue

        scored.append(
            ScoredForecast(
                match=match,
                fit_date=last_fit,
                model=Forecast(outcome.home_win, outcome.draw, outcome.away_win),
                market=match.market,
            )
        )

    if not scored:
        raise ValueError("no match in the window could be forecast; is there enough history?")

    results = [s.match.result for s in scored]
    priced = [s for s in scored if s.market is not None]

    return BacktestResult(
        model_version=version,
        scope=scope,
        window_start=window_start,
        window_end=window_end,
        refits=refits,
        forecasts=scored,
        model=scorecard([s.model for s in scored], results),
        market=(
            scorecard(
                [s.market for s in priced if s.market is not None],
                [s.match.result for s in priced],
            )
            if priced
            else None
        ),
        uniform=scorecard([Forecast(1 / 3, 1 / 3, 1 / 3) for _ in scored], results),
    )
