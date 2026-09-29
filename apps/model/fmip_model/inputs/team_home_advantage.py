"""Home advantage by team (T-1141, D-149).

The model has one home advantage per division. This input gives each club a
deviation from it, ``delta``, penalised toward zero (the division's value) by
``penalty * sum(delta ** 2)``, and fits it *with* the strengths rather than
after them: a club that wins more at home than away would otherwise have part
of that already in its attack and defence.

At each refit two Poisson fits run on the same history with the model's time
weights (``xi``): one with the deviations and one without, otherwise the
same (attack, defence and one home advantage, a small ridge on the
strengths, the mean attack pinned at zero). The input's shift for a match is
the ratio of their expected goals,

    home: log(lam_with / lam_without),  away: log(mu_with / mu_without),

applied to the candidate's own forecast. Taking the ratio of two fits made
the same way keeps what the auxiliary fits leave out (the Elo prior, the
low-score correction) from leaking into the shift.

A club with fewer than ``MIN_HOME_MATCHES`` home matches in the last
``RECENT_DAYS`` of the history has no deviation of its own: it stays at its
division's value. A side the history has never seen gives no value (the
candidate's forecast stands, the match is outside the sample).

``PENALTY`` was chosen on one window and then scored once on the next, as
T-533 chose its constants (D-149 has both runs).
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date, timedelta

import numpy as np
from numpy.typing import NDArray
from scipy.optimize import minimize

from ..model.dixon_coles import FittedModel, MatchObservation
from . import InputContext, LogShift, Scheduled

#: The deviations' penalty, chosen on 2023-07-01..2024-06-30 from ``GRID`` (D-149).
PENALTY = 100.0
#: The penalties tried on the choosing window.
GRID = (1.0, 3.0, 10.0, 30.0, 100.0)
#: A club needs this many home matches in the last ``RECENT_DAYS`` for a deviation.
MIN_HOME_MATCHES = 19
RECENT_DAYS = 730
#: Ridge on attack and defence in both auxiliary fits.
STRENGTH_RIDGE = 0.1


@dataclass(frozen=True)
class PoissonFit:
    index: dict[str, int]
    attack: NDArray[np.float64]
    defence: NDArray[np.float64]
    home: float
    delta: NDArray[np.float64]

    def expected(self, home: str, away: str) -> tuple[float, float] | None:
        if home not in self.index or away not in self.index:
            return None
        h, a = self.index[home], self.index[away]
        lam = math.exp(self.attack[h] + self.defence[a] + self.home + self.delta[h])
        mu = math.exp(self.attack[a] + self.defence[h])
        return lam, mu


def poisson_fit(
    history: Sequence[MatchObservation],
    fit_date: date,
    xi: float,
    free: set[str],
    penalty: float,
) -> PoissonFit:
    """Time-weighted Poisson maximum likelihood with a home deviation for each club in ``free``."""
    teams = sorted({m.home for m in history} | {m.away for m in history})
    index = {t: i for i, t in enumerate(teams)}
    n = len(teams)
    hi = np.array([index[m.home] for m in history], dtype=np.int64)
    ai = np.array([index[m.away] for m in history], dtype=np.int64)
    hg = np.array([m.home_goals for m in history], dtype=np.float64)
    ag = np.array([m.away_goals for m in history], dtype=np.float64)
    w = np.exp(-xi * np.array([(fit_date - m.date).days for m in history], dtype=np.float64))
    mask = np.array([1.0 if t in free else 0.0 for t in teams])

    def objective(theta: NDArray[np.float64]) -> tuple[float, NDArray[np.float64]]:
        att, dfn, home, delta = theta[:n], theta[n : 2 * n], theta[2 * n], theta[2 * n + 1 :]
        delta = delta * mask
        lam = np.exp(att[hi] + dfn[ai] + home + delta[hi])
        mu = np.exp(att[ai] + dfn[hi])
        ll = np.sum(w * (hg * np.log(lam) - lam + ag * np.log(mu) - mu))
        rh = w * (hg - lam)
        ra = w * (ag - mu)
        g_att = np.bincount(hi, rh, n) + np.bincount(ai, ra, n)
        g_dfn = np.bincount(ai, rh, n) + np.bincount(hi, ra, n)
        g_home = rh.sum()
        g_delta = np.bincount(hi, rh, n) * mask
        mean_att = att.mean()
        value = -ll + STRENGTH_RIDGE * (att @ att + dfn @ dfn) + penalty * (delta @ delta)
        value += 10.0 * mean_att**2
        grad = np.concatenate(
            [
                -g_att + 2 * STRENGTH_RIDGE * att + 20.0 * mean_att / n,
                -g_dfn + 2 * STRENGTH_RIDGE * dfn,
                [-g_home],
                -g_delta + 2 * penalty * delta,
            ]
        )
        return float(value), grad

    theta0 = np.zeros(3 * n + 1)
    theta0[2 * n] = 0.25
    result = minimize(objective, theta0, jac=True, method="L-BFGS-B")
    theta = result.x
    return PoissonFit(
        index, theta[:n], theta[n : 2 * n], float(theta[2 * n]), theta[2 * n + 1 :] * mask
    )


def eligible(history: Sequence[MatchObservation], fit_date: date) -> set[str]:
    """Clubs with at least ``MIN_HOME_MATCHES`` home matches in the last ``RECENT_DAYS``."""
    since = fit_date - timedelta(days=RECENT_DAYS)
    counts: dict[str, int] = {}
    for m in history:
        if m.date > since:
            counts[m.home] = counts.get(m.home, 0) + 1
    return {t for t, c in counts.items() if c >= MIN_HOME_MATCHES}


@dataclass(frozen=True)
class TeamHomeTerm:
    with_deviation: PoissonFit | None
    without: PoissonFit | None
    free: frozenset[str] = field(default_factory=frozenset)

    def shift(self, match: Scheduled, known: Sequence[MatchObservation]) -> LogShift | None:
        if self.with_deviation is None or self.without is None:
            return None
        a = self.with_deviation.expected(match.home, match.away)
        b = self.without.expected(match.home, match.away)
        if a is None or b is None:
            return None
        return math.log(a[0] / b[0]), math.log(a[1] / b[1])


class TeamHomeAdvantage:
    name = "team_home_advantage"

    def __init__(self, penalty: float = PENALTY) -> None:
        self.penalty = penalty
        self.description = (
            "Home advantage by team: each club's deviation from its division's, "
            f"penalised by {penalty:g} x delta^2 and fitted with the strengths; a club with "
            f"fewer than {MIN_HOME_MATCHES} home matches in {RECENT_DAYS} days stays at the "
            "division's value (T-1141, D-149)."
        )

    def fit(
        self,
        division: str,
        history: Sequence[MatchObservation],
        fit_date: date,
        model: FittedModel,
    ) -> TeamHomeTerm:
        if not history:
            return TeamHomeTerm(None, None)
        free = eligible(history, fit_date)
        return TeamHomeTerm(
            poisson_fit(history, fit_date, model.xi, free, self.penalty),
            poisson_fit(history, fit_date, model.xi, set(), self.penalty),
            frozenset(free),
        )


def build(context: InputContext) -> TeamHomeAdvantage:
    return TeamHomeAdvantage()
