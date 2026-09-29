"""Model inputs: a term a candidate may add to the fit, judged by one harness (T-1101, D-139).

An input is a module in this package, ``fmip_model/inputs/<name>.py``, that
defines ``build(context: InputContext) -> ModelInput``. The harness finds it by
name (``--input <name>``), so adding an input never edits a shared file.

The contract is small on purpose:

- ``ModelInput.fit(division, history, fit_date, model)`` is called once per
  refit, with the matches the model was fitted on (every one on or before
  ``fit_date``, oldest first) and the fitted model itself. It returns a
  ``Term``.
- ``Term.shift(match, known)`` is called for each match that fit forecasts.
  ``known`` is every match of the division strictly before the match's day
  (what the service knows the day before kick-off). It returns the change to
  the log of the expected goals, ``(home, away)``, or ``None`` when the input
  cannot be read for this match -- then the forecast is the candidate's own,
  and the match does not count toward the input's sample (never a default).

The harness hands an input nothing later than that. An input that reads more
rows than the harness gives it (other divisions, our records' cups) reads them
in ``build`` through ``InputContext`` and must itself keep to ``known``'s
boundary: nothing on or after the match's day.

Most inputs are a feature pair and a fitted coefficient. ``FeatureInput`` is
that path: give it ``features(division, match, known) -> (home, away)`` vectors
(or ``None``), and it fits the coefficients by time-weighted Poisson maximum
likelihood with the fitted model's expected goals as offsets, as the line-up
term does (T-534, D-086). The home side's goals move by ``exp(beta . home)``,
the away side's by ``exp(beta . away)``.
"""

from __future__ import annotations

import importlib
import math
import pkgutil
from bisect import bisect_left
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import date
from typing import Protocol

import numpy as np
from numpy.typing import NDArray
from scipy.optimize import minimize

from ..model.dixon_coles import FittedModel, MatchObservation

#: The change to ``log`` expected goals, (home, away).
LogShift = tuple[float, float]


class Scheduled(Protocol):
    """What an input may know of the match it shifts: its day and its sides, not its score."""

    @property
    def date(self) -> date: ...
    @property
    def home(self) -> str: ...
    @property
    def away(self) -> str: ...


class Term(Protocol):
    def shift(self, match: Scheduled, known: Sequence[MatchObservation]) -> LogShift | None: ...


class ModelInput(Protocol):
    name: str
    description: str

    def fit(
        self,
        division: str,
        history: Sequence[MatchObservation],
        fit_date: date,
        model: FittedModel,
    ) -> Term: ...


@dataclass(frozen=True)
class InputContext:
    """What ``build`` may use to read rows the harness does not hand it."""

    database_url: str | None
    divisions: tuple[str, ...]
    until: date


def available() -> list[str]:
    """Every input module in this package, by name."""
    return sorted(m.name for m in pkgutil.iter_modules(__path__) if not m.name.startswith("_"))


def load(name: str, context: InputContext) -> ModelInput:
    if name not in available():
        raise LookupError(f"no input {name!r}; there are {', '.join(available())}")
    module = importlib.import_module(f"{__name__}.{name}")
    built: ModelInput = module.build(context)
    return built


def before(ordered: Sequence[MatchObservation], day: date) -> Sequence[MatchObservation]:
    """The matches of ``ordered`` (oldest first) strictly before ``day``."""
    return ordered[: bisect_left([m.date for m in ordered], day)]


Features = Callable[
    [str, Scheduled, Sequence[MatchObservation]],
    tuple[Sequence[float], Sequence[float]] | None,
]


@dataclass(frozen=True)
class LinearTerm:
    division: str
    beta: tuple[float, ...]
    samples: int
    features: FeatureInput

    def shift(self, match: Scheduled, known: Sequence[MatchObservation]) -> LogShift | None:
        if self.samples == 0:
            return None
        x = self.features.features_of(self.division, match, known)
        if x is None:
            return None
        return float(np.dot(self.beta, x[0])), float(np.dot(self.beta, x[1]))


class FeatureInput:
    """An input that is a feature pair per match and a coefficient vector fitted per refit.

    ``features`` must depend only on the match's day and sides and on
    ``known``; its answer is cached per (division, day, home, away), which is
    only right because ``known`` for a match is always the same.
    """

    def __init__(
        self, name: str, description: str, features: Features, *, bound: float = 2.0
    ) -> None:
        self.name = name
        self.description = description
        self._features = features
        self.bound = bound
        self._cache: dict[
            tuple[str, date, str, str], tuple[NDArray[np.float64], NDArray[np.float64]] | None
        ] = {}

    def features_of(
        self, division: str, match: Scheduled, known: Sequence[MatchObservation]
    ) -> tuple[NDArray[np.float64], NDArray[np.float64]] | None:
        key = (division, match.date, match.home, match.away)
        if key not in self._cache:
            raw = self._features(division, match, known)
            self._cache[key] = (
                None
                if raw is None
                else (np.asarray(raw[0], dtype=np.float64), np.asarray(raw[1], dtype=np.float64))
            )
        return self._cache[key]

    def fit(
        self,
        division: str,
        history: Sequence[MatchObservation],
        fit_date: date,
        model: FittedModel,
    ) -> LinearTerm:
        rows: list[tuple[float, float, float, float, float]] = []
        xh: list[NDArray[np.float64]] = []
        xa: list[NDArray[np.float64]] = []
        dates = [m.date for m in history]
        for match in history:
            key = (division, match.date, match.home, match.away)
            x = (
                self._cache[key]
                if key in self._cache
                else self.features_of(division, match, history[: bisect_left(dates, match.date)])
            )
            if x is None:
                continue
            lam, mu = model.expected_goals(match.home, match.away)
            weight = math.exp(-model.xi * (fit_date - match.date).days)
            rows.append((lam, mu, float(match.home_goals), float(match.away_goals), weight))
            xh.append(x[0])
            xa.append(x[1])
        if not rows:
            return LinearTerm(division, (), 0, self)
        beta = fit_coefficients(np.array(rows), np.array(xh), np.array(xa), self.bound)
        return LinearTerm(division, tuple(float(b) for b in beta), len(rows), self)


def fit_coefficients(
    rows: NDArray[np.float64],
    xh: NDArray[np.float64],
    xa: NDArray[np.float64],
    bound: float,
) -> NDArray[np.float64]:
    """Weighted Poisson maximum likelihood for ``beta``, the expected goals as offsets.

    ``rows`` holds (lam, mu, home goals, away goals, weight) per match. The
    low-score correction is left out of this likelihood: it moves four
    scorelines slightly and does not depend on ``beta``'s sign.
    """
    lam, mu, hg, ag, w = rows.T
    k = xh.shape[1]

    def objective(beta: NDArray[np.float64]) -> tuple[float, NDArray[np.float64]]:
        eh = lam * np.exp(xh @ beta)
        ea = mu * np.exp(xa @ beta)
        loglik = np.sum(w * (hg * np.log(eh) - eh + ag * np.log(ea) - ea))
        grad = xh.T @ (w * (hg - eh)) + xa.T @ (w * (ag - ea))
        return float(-loglik), -grad

    result = minimize(
        objective, np.zeros(k), jac=True, method="L-BFGS-B", bounds=[(-bound, bound)] * k
    )
    return np.asarray(result.x, dtype=np.float64)
