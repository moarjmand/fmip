"""Fitting the time-weighted Dixon-Coles model with an Elo prior.

Parameters, for teams 1..n:

    attack_i, defence_i   log-scale strengths, defence positive = concedes more
    home                  log home advantage
    rho                   low-score correction

Expected goals for home team i against away team j:

    lambda = exp(attack_i + defence_j + home)
    mu     = exp(attack_j + defence_i)

The fit maximises the time-weighted log-likelihood, with two penalties:

- a ridge on all strengths (the model is over-parameterised by one constant
  per set; the ridge and the mean-zero constraint pin it down), and
- the Elo prior: (attack_i - defence_i) is pulled toward
  ``elo_scale * (elo_i - mean elo) / 400``. Elo is a net-strength signal, so
  it constrains the difference, not attack or defence separately.

Time weight for a match ``t`` days before the fit date: ``exp(-xi * t)``. The
half-life in days is ``ln 2 / xi``; ``xi = 0.0065`` is about 107 days, in the
range the Dixon-Coles literature settles on for club football.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date

import numpy as np
from numpy.typing import NDArray
from scipy.optimize import minimize

from .poisson import Outcome, dixon_coles_tau, outcome_from_matrix, score_matrix

DEFAULT_XI = 0.0065
DEFAULT_RIDGE = 0.01
DEFAULT_ELO_WEIGHT = 0.5
ELO_SCALE = 1.0  # strength units per 400 Elo points (one Elo "class")


@dataclass(frozen=True)
class MatchObservation:
    date: date
    home: str
    away: str
    home_goals: int
    away_goals: int


@dataclass(frozen=True)
class FittedModel:
    fit_date: date
    teams: tuple[str, ...]
    attack: Mapping[str, float]
    defence: Mapping[str, float]
    home_advantage: float
    rho: float
    xi: float
    matches_used: int
    log_likelihood: float

    def expected_goals(self, home: str, away: str) -> tuple[float, float]:
        if home not in self.attack or away not in self.attack:
            missing = home if home not in self.attack else away
            raise KeyError(f"unknown team {missing!r}; fit the model with it or use a prior")
        lam = float(np.exp(self.attack[home] + self.defence[away] + self.home_advantage))
        mu = float(np.exp(self.attack[away] + self.defence[home]))
        return lam, mu

    def predict(self, home: str, away: str) -> Outcome:
        lam, mu = self.expected_goals(home, away)
        return outcome_from_matrix(score_matrix(lam, mu, self.rho))

    def strength(self, team: str) -> float:
        """Net strength: attack minus defence. Higher is better."""
        return self.attack[team] - self.defence[team]


def time_weights(dates: Sequence[date], fit_date: date, xi: float) -> NDArray[np.float64]:
    days = np.array([(fit_date - d).days for d in dates], dtype=np.float64)
    if (days < 0).any():
        raise ValueError("a match after the fit date would be a leak from the future")
    return np.exp(-xi * days)


def fit(
    matches: Sequence[MatchObservation],
    fit_date: date,
    *,
    elo: Mapping[str, float] | None = None,
    xi: float = DEFAULT_XI,
    ridge: float = DEFAULT_RIDGE,
    elo_weight: float = DEFAULT_ELO_WEIGHT,
) -> FittedModel:
    """Maximum penalised likelihood over ``matches`` played on or before ``fit_date``.

    ``elo`` maps team → Club Elo at the fit date; teams absent from it get no
    prior beyond the ridge. A team that appears only in ``elo`` (no matches)
    still receives strengths, from the prior alone.
    """
    if not matches and not elo:
        raise ValueError("nothing to fit: no matches and no prior")

    teams = sorted({m.home for m in matches} | {m.away for m in matches} | set(elo or {}))
    index = {team: i for i, team in enumerate(teams)}
    n = len(teams)

    home_idx = np.array([index[m.home] for m in matches], dtype=np.int64)
    away_idx = np.array([index[m.away] for m in matches], dtype=np.int64)
    hg = np.array([m.home_goals for m in matches], dtype=np.float64)
    ag = np.array([m.away_goals for m in matches], dtype=np.float64)
    w = time_weights([m.date for m in matches], fit_date, xi)

    if elo:
        mean_elo = float(np.mean(list(elo.values())))
        prior = np.array(
            [ELO_SCALE * (elo[t] - mean_elo) / 400.0 if t in elo else 0.0 for t in teams]
        )
        has_prior = np.array([1.0 if t in elo else 0.0 for t in teams])
    else:
        prior = np.zeros(n)
        has_prior = np.zeros(n)

    def unpack(
        theta: NDArray[np.float64],
    ) -> tuple[NDArray[np.float64], NDArray[np.float64], float, float]:
        attack = theta[:n]
        defence = theta[n : 2 * n]
        return attack, defence, float(theta[2 * n]), float(theta[2 * n + 1])

    def negative_penalised_loglik(theta: NDArray[np.float64]) -> float:
        attack, defence, home, rho = unpack(theta)
        lam = np.exp(attack[home_idx] + defence[away_idx] + home)
        mu = np.exp(attack[away_idx] + defence[home_idx])

        # Poisson log-likelihood without the constant log(x!) terms.
        ll = hg * np.log(lam) - lam + ag * np.log(mu) - mu
        tau = np.array(
            [
                dixon_coles_tau(int(x), int(y), float(lm), float(m), rho)
                for x, y, lm, m in zip(hg, ag, lam, mu, strict=True)
            ]
        )
        if (tau <= 0).any():
            return 1e12
        ll = ll + np.log(tau)

        penalty = ridge * (np.sum(attack**2) + np.sum(defence**2))
        penalty += elo_weight * np.sum(has_prior * ((attack - defence) - prior) ** 2)
        # Identifiability: the mean attack is zero.
        penalty += 10.0 * np.mean(attack) ** 2
        return float(-(w * ll).sum() + penalty)

    theta0 = np.zeros(2 * n + 2)
    theta0[:n] = prior / 2
    theta0[n : 2 * n] = -prior / 2
    theta0[2 * n] = 0.25  # a typical home advantage to start from
    bounds = [(-3.0, 3.0)] * (2 * n) + [(-1.0, 1.0), (-0.9, 0.9)]

    result = minimize(negative_penalised_loglik, theta0, method="L-BFGS-B", bounds=bounds)
    attack, defence, home, rho = unpack(result.x)

    return FittedModel(
        fit_date=fit_date,
        teams=tuple(teams),
        attack={t: float(attack[i]) for t, i in index.items()},
        defence={t: float(defence[i]) for t, i in index.items()},
        home_advantage=home,
        rho=rho,
        xi=xi,
        matches_used=len(matches),
        log_likelihood=float(-result.fun),
    )
