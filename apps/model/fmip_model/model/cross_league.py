"""Clubs of different leagues on one scale (T-533, D-085).

A division's fit rates its clubs against each other; nothing in it says how a
league compares with another, so a European cup match has no answer from it.
This fit takes every loaded division's matches and the matches of our own
records that cross leagues (the pseudo-division ``XL``, D-083) together, and
writes each club's attack and defence as its league's plus its own:

    attack_i  = A_g(i) + a_i        defence_i = D_g(i) + d_i

A league's level (``A_g``, ``D_g``) is learned from the matches that cross
leagues; a club's own term is pulled toward zero by a ridge, so a club with
few matches sits near its league rather than near the average of every club.
A club with no domestic division the model holds is in one shared group,
``other``, whose level its cup matches decide.

The objective and its gradient are vectorised: the joint fit has hundreds of
clubs and tens of thousands of matches, where the per-division fit's numerical
gradient would take hours. The published per-division fit is untouched.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date

import numpy as np
from numpy.typing import NDArray
from scipy.optimize import minimize

from .dixon_coles import FittedModel, MatchObservation, time_weights

#: The division a request names for a match between clubs of different leagues,
#: and the training division of our own records of such matches (D-083).
CROSS_LEAGUE = "XL"
#: The group of a club whose domestic league the model does not hold.
OTHER_GROUP = "other"


def groups_for(matches: Sequence[tuple[str, MatchObservation]]) -> dict[str, str]:
    """Each club's group: the division of its latest domestic match, else ``other``.

    Latest, because a promoted club belongs to the league it plays in now.
    """
    latest: dict[str, tuple[date, str]] = {}
    teams: set[str] = set()
    for division, m in matches:
        teams.update((m.home, m.away))
        if division == CROSS_LEAGUE:
            continue
        for team in (m.home, m.away):
            seen = latest.get(team)
            if seen is None or m.date >= seen[0]:
                latest[team] = (m.date, division)
    return {team: latest[team][1] if team in latest else OTHER_GROUP for team in teams}


Objective = Callable[[NDArray[np.float64]], tuple[float, NDArray[np.float64]]]


@dataclass(frozen=True)
class JointProblem:
    """The penalised negative log-likelihood and what reads a solution back."""

    objective: Objective
    theta0: NDArray[np.float64]
    bounds: list[tuple[float, float]]
    solve: Callable[[NDArray[np.float64], float], FittedModel]


def fit_joint(
    matches: Sequence[MatchObservation],
    groups: Mapping[str, str],
    fit_date: date,
    *,
    xi: float,
    team_ridge: float,
    group_ridge: float,
) -> FittedModel:
    """Maximum penalised likelihood over every match, clubs nested in their groups."""
    problem = joint_problem(
        matches, groups, fit_date, xi=xi, team_ridge=team_ridge, group_ridge=group_ridge
    )
    # Tight tolerances: with the gradient exact, converging costs little.
    result = minimize(
        problem.objective,
        problem.theta0,
        jac=True,
        method="L-BFGS-B",
        bounds=problem.bounds,
        options={"maxiter": 20000, "maxfun": 40000, "ftol": 1e-14, "gtol": 1e-7},
    )
    return problem.solve(result.x, float(result.fun))


def joint_problem(
    matches: Sequence[MatchObservation],
    groups: Mapping[str, str],
    fit_date: date,
    *,
    xi: float,
    team_ridge: float,
    group_ridge: float,
) -> JointProblem:
    """The fit as a problem, so a test can check the gradient against the value."""
    if not matches:
        raise ValueError("nothing to fit: no matches")

    teams = sorted({m.home for m in matches} | {m.away for m in matches})
    index = {team: i for i, team in enumerate(teams)}
    group_names = sorted({groups.get(t, OTHER_GROUP) for t in teams})
    group_index = {g: i for i, g in enumerate(group_names)}
    n, k = len(teams), len(group_names)
    tg = np.array([group_index[groups.get(t, OTHER_GROUP)] for t in teams], dtype=np.int64)

    h = np.array([index[m.home] for m in matches], dtype=np.int64)
    a = np.array([index[m.away] for m in matches], dtype=np.int64)
    hg = np.array([m.home_goals for m in matches], dtype=np.float64)
    ag = np.array([m.away_goals for m in matches], dtype=np.float64)
    w = time_weights([m.date for m in matches], fit_date, xi)
    s00 = (hg == 0) & (ag == 0)
    s01 = (hg == 0) & (ag == 1)
    s10 = (hg == 1) & (ag == 0)
    s11 = (hg == 1) & (ag == 1)

    def unpack(
        theta: NDArray[np.float64],
    ) -> tuple[
        NDArray[np.float64],
        NDArray[np.float64],
        NDArray[np.float64],
        NDArray[np.float64],
        float,
        float,
    ]:
        return (
            theta[:n],
            theta[n : 2 * n],
            theta[2 * n : 2 * n + k],
            theta[2 * n + k : 2 * n + 2 * k],
            float(theta[2 * n + 2 * k]),
            float(theta[2 * n + 2 * k + 1]),
        )

    def objective(theta: NDArray[np.float64]) -> tuple[float, NDArray[np.float64]]:
        ta, td, ga, gd, home, rho = unpack(theta)
        attack = ga[tg] + ta
        defence = gd[tg] + td
        eta_h = attack[h] + defence[a] + home
        eta_a = attack[a] + defence[h]
        lam = np.exp(eta_h)
        mu = np.exp(eta_a)

        # The Dixon-Coles correction and its derivatives, only where it is not 1.
        tau = np.ones_like(lam)
        tau[s00] = 1.0 - lam[s00] * mu[s00] * rho
        tau[s01] = 1.0 + lam[s01] * rho
        tau[s10] = 1.0 + mu[s10] * rho
        tau[s11] = 1.0 - rho
        tau = np.maximum(tau, 1e-10)
        dtau_h = np.zeros_like(lam)  # d tau / d eta_h
        dtau_a = np.zeros_like(lam)
        dtau_rho = np.zeros_like(lam)
        dtau_h[s00] = -lam[s00] * mu[s00] * rho
        dtau_a[s00] = -lam[s00] * mu[s00] * rho
        dtau_rho[s00] = -lam[s00] * mu[s00]
        dtau_h[s01] = lam[s01] * rho
        dtau_rho[s01] = lam[s01]
        dtau_a[s10] = mu[s10] * rho
        dtau_rho[s10] = mu[s10]
        dtau_rho[s11] = -1.0

        ll = hg * eta_h - lam + ag * eta_a - mu + np.log(tau)
        g_h = w * (hg - lam + dtau_h / tau)
        g_a = w * (ag - mu + dtau_a / tau)

        mean_attack = float(np.mean(attack))
        value = (
            -float(np.sum(w * ll))
            + team_ridge * float(np.sum(ta**2) + np.sum(td**2))
            + group_ridge * float(np.sum(ga**2) + np.sum(gd**2))
            + 10.0 * mean_attack**2
        )

        d_attack = -(np.bincount(h, g_h, n) + np.bincount(a, g_a, n)) + 20.0 * mean_attack / n
        d_defence = -(np.bincount(a, g_h, n) + np.bincount(h, g_a, n))
        grad = np.empty_like(theta)
        grad[:n] = d_attack + 2.0 * team_ridge * ta
        grad[n : 2 * n] = d_defence + 2.0 * team_ridge * td
        grad[2 * n : 2 * n + k] = np.bincount(tg, d_attack, k) + 2.0 * group_ridge * ga
        grad[2 * n + k : 2 * n + 2 * k] = np.bincount(tg, d_defence, k) + 2.0 * group_ridge * gd
        grad[2 * n + 2 * k] = -float(np.sum(g_h))
        grad[2 * n + 2 * k + 1] = -float(np.sum(w * dtau_rho / tau))
        return value, grad

    theta0 = np.zeros(2 * n + 2 * k + 2)
    theta0[2 * n + 2 * k] = 0.25
    bounds = [(-3.0, 3.0)] * (2 * n + 2 * k) + [(-1.0, 1.0), (-0.9, 0.9)]

    def solve(theta: NDArray[np.float64], value: float) -> FittedModel:
        ta, td, ga, gd, home, rho = unpack(theta)
        attack = ga[tg] + ta
        defence = gd[tg] + td
        return FittedModel(
            fit_date=fit_date,
            teams=tuple(teams),
            attack={t: float(attack[i]) for t, i in index.items()},
            defence={t: float(defence[i]) for t, i in index.items()},
            home_advantage=home,
            rho=rho,
            xi=xi,
            matches_used=len(matches),
            log_likelihood=-value,
        )

    return JointProblem(objective, theta0, bounds, solve)
