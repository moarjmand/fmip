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

Two options (T-1654, D-309), each off unless a version's ``cross_league``
names it, so the published version fits exactly as before:

- **an Elo prior**: each rated club's net strength, centred on the rated
  clubs' mean, is pulled toward its own Elo (D-111), centred the same way, at
  ``ELO_SCALE`` per 400 points. Our own Elo is one pool across every stored
  match, cups included, so it compares clubs of different leagues;
- **a home advantage per competition group** (``HOME_GROUPS``): a match across
  leagues adds its group's deviation to the shared home advantage, which the
  domestic league matches set, with a ridge toward zero.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import date

import numpy as np
from numpy.typing import NDArray
from scipy.optimize import minimize

from .dixon_coles import ELO_SCALE, FittedModel, MatchObservation, time_weights
from .poisson import Outcome
from .version import CrossLeague

#: The division a request names for a match between clubs of different leagues,
#: and the training division of our own records of such matches (D-083).
CROSS_LEAGUE = "XL"
#: The group of a club whose domestic league the model does not hold.
OTHER_GROUP = "other"

#: The competition groups a match across leagues may have its own home
#: advantage in (D-309): UEFA's club competitions, every other continental
#: one, the domestic cups, and the rest (super cups, friendlies, national
#: teams' competitions, domestic play-offs).
HOME_GROUPS: tuple[str, ...] = ("uefa", "continental", "domestic_cup", "other")

#: UEFA's member associations by FIFA trigram: the copy of ``MEMBERS.uefa`` in
#: ``packages/contracts/src/confederation.ts`` (D-301), which a test compares.
UEFA_MEMBERS: frozenset[str] = frozenset(
    "ALB AND ARM AUT AZE BLR BEL BIH BUL CRO CYP CZE DEN ENG EST FRO FIN FRA GEO GER "
    "GIB GRE HUN ISL ISR ITA KAZ KVX LVA LIE LTU LUX MLT MDA MNE NED MKD NIR NOR POL "
    "POR IRL ROU RUS SMR SCO SRB SVK SVN ESP SWE SUI TUR UKR WAL".split()
)


def is_uefa(clubs_by_country: Mapping[str, int]) -> bool:
    """Whether a continental competition is UEFA's, from its clubs (D-309).

    ``clubs_by_country`` counts, per FIFA trigram, the competition's clubs that
    play a domestic league of that country, as the catalogue places them for
    the site's menu (D-301). UEFA's when more than half the placed clubs are
    in a UEFA member's league; never from the competition's name (rule 1).
    """
    placed = sum(n for n in clubs_by_country.values() if n > 0)
    uefa = sum(n for code, n in clubs_by_country.items() if n > 0 and code in UEFA_MEMBERS)
    return placed > 0 and 2 * uefa > placed


def home_group(scope: str, kind: str, *, uefa: bool) -> str:
    """A competition's group in ``HOME_GROUPS``, from the catalogue's scope and kind."""
    if scope == "continental" and kind not in ("super_cup", "friendly"):
        return "uefa" if uefa else "continental"
    if scope == "domestic" and kind == "cup":
        return "domestic_cup"
    return "other"


#: A match across leagues as the catalogue names it: its UTC day and both clubs' ids.
FixtureKey = tuple[date, str, str]


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
class JointFit:
    """A fit across leagues: the model, and what its options added (D-309)."""

    #: Its ``home_advantage`` is the shared one, the domestic league matches'.
    model: FittedModel
    #: Each competition group's deviation from it; empty when the option is off.
    home_by_group: Mapping[str, float] = field(default_factory=dict)
    #: Clubs of the fit the Elo prior reached; 0 when the option is off.
    rated_clubs: int = 0

    def for_group(self, group: str | None) -> FittedModel:
        """The model as a match of ``group`` reads it; the shared one when unknown."""
        if group is None or group not in self.home_by_group:
            return self.model
        return replace(
            self.model, home_advantage=self.model.home_advantage + self.home_by_group[group]
        )

    def predict(self, home: str, away: str, group: str | None = None) -> Outcome:
        return self.for_group(group).predict(home, away)


@dataclass(frozen=True)
class JointProblem:
    """The penalised negative log-likelihood and what reads a solution back."""

    objective: Objective
    theta0: NDArray[np.float64]
    bounds: list[tuple[float, float]]
    solve: Callable[[NDArray[np.float64], float], JointFit]


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
    return fit_joint_full(
        matches, groups, fit_date, xi=xi, team_ridge=team_ridge, group_ridge=group_ridge
    ).model


def fit_joint_full(
    matches: Sequence[MatchObservation],
    groups: Mapping[str, str],
    fit_date: date,
    *,
    xi: float,
    team_ridge: float,
    group_ridge: float,
    elo: Mapping[str, float] | None = None,
    elo_weight: float = 0.0,
    home_groups: Sequence[str | None] | None = None,
    home_ridge: float | None = None,
) -> JointFit:
    """``fit_joint`` with the options of D-309, and what they added."""
    problem = joint_problem(
        matches,
        groups,
        fit_date,
        xi=xi,
        team_ridge=team_ridge,
        group_ridge=group_ridge,
        elo=elo,
        elo_weight=elo_weight,
        home_groups=home_groups,
        home_ridge=home_ridge,
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


def fit_across(
    tagged: Sequence[tuple[str, MatchObservation]],
    fit_date: date,
    constants: CrossLeague,
    *,
    elo: Mapping[str, float] | None = None,
    labels: Mapping[FixtureKey, str] | None = None,
) -> JointFit:
    """The fit a version's ``cross_league`` constants define, for the service and the backtest.

    ``elo`` is our own Elo of the fit date by club key, read only with the
    Elo option on; ``labels`` gives a match across leagues its competition
    group, read only with the home option on. A match across leagues with no
    label takes the shared home advantage.
    """
    home_groups: list[str | None] | None = None
    if constants.home_by_competition is not None:
        known = labels or {}
        home_groups = [
            known.get((m.date, m.home, m.away)) if division == CROSS_LEAGUE else None
            for division, m in tagged
        ]
    return fit_joint_full(
        [m for _, m in tagged],
        groups_for(tagged),
        fit_date,
        xi=constants.xi,
        team_ridge=constants.team_ridge,
        group_ridge=constants.group_ridge,
        elo=elo if constants.elo_weight > 0 else None,
        elo_weight=constants.elo_weight,
        home_groups=home_groups,
        home_ridge=constants.home_by_competition,
    )


def joint_problem(
    matches: Sequence[MatchObservation],
    groups: Mapping[str, str],
    fit_date: date,
    *,
    xi: float,
    team_ridge: float,
    group_ridge: float,
    elo: Mapping[str, float] | None = None,
    elo_weight: float = 0.0,
    home_groups: Sequence[str | None] | None = None,
    home_ridge: float | None = None,
) -> JointProblem:
    """The fit as a problem, so a test can check the gradient against the value.

    With neither option the parameters, the starting point and every term are
    the ones the fit had before T-1654: the options only append parameters and
    add terms, and only when they are on.
    """
    if not matches:
        raise ValueError("nothing to fit: no matches")
    if home_groups is not None and len(home_groups) != len(matches):
        raise ValueError("home_groups must name one group (or None) per match")

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

    # The Elo prior (D-309): the rated clubs of this fit, their Elo centred on
    # their own mean and put on the strength scale.
    rated = np.zeros(n, dtype=bool)
    prior = np.zeros(n)
    if elo and elo_weight > 0:
        rated = np.array([t in elo for t in teams], dtype=bool)
        if rated.any():
            ratings = np.array([elo[t] if t in elo else 0.0 for t in teams])
            prior[rated] = ELO_SCALE * (ratings[rated] - float(np.mean(ratings[rated]))) / 400.0
    use_elo = bool(rated.any())
    n_rated = int(rated.sum())

    # The home advantage per competition group (D-309): each labelled match's
    # group, -1 for the shared home advantage.
    home_names = sorted({g for g in home_groups or () if g is not None})
    use_home = home_ridge is not None and bool(home_names)
    q = len(home_names) if use_home else 0
    labelled = np.zeros(len(matches), dtype=bool)
    hgi_safe = np.zeros(len(matches), dtype=np.int64)
    if use_home:
        home_index = {g: i for i, g in enumerate(home_names)}
        hgi = np.array(
            [-1 if g is None else home_index[g] for g in home_groups or ()], dtype=np.int64
        )
        labelled = hgi >= 0
        hgi_safe = np.where(labelled, hgi, 0)
    base = 2 * n + 2 * k + 2

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
        delta = theta[base : base + q]
        eta_h = attack[h] + defence[a] + home
        if use_home:
            eta_h = eta_h + np.where(labelled, delta[hgi_safe], 0.0)
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
        if use_elo:
            # Centred on the rated clubs' mean, the residuals sum to zero, so
            # the mean's own derivative drops out of the gradient.
            net = attack - defence
            residual = net[rated] - float(np.mean(net[rated])) - prior[rated]
            value += elo_weight * float(np.sum(residual**2))
            d_net = np.zeros(n)
            d_net[rated] = 2.0 * elo_weight * residual
            d_attack = d_attack + d_net
            d_defence = d_defence - d_net
        grad = np.empty_like(theta)
        grad[:n] = d_attack + 2.0 * team_ridge * ta
        grad[n : 2 * n] = d_defence + 2.0 * team_ridge * td
        grad[2 * n : 2 * n + k] = np.bincount(tg, d_attack, k) + 2.0 * group_ridge * ga
        grad[2 * n + k : 2 * n + 2 * k] = np.bincount(tg, d_defence, k) + 2.0 * group_ridge * gd
        grad[2 * n + 2 * k] = -float(np.sum(g_h))
        grad[2 * n + 2 * k + 1] = -float(np.sum(w * dtau_rho / tau))
        if use_home:
            assert home_ridge is not None
            value += home_ridge * float(np.sum(delta**2))
            grad[base : base + q] = (
                -np.bincount(hgi_safe[labelled], g_h[labelled], q) + 2.0 * home_ridge * delta
            )
        return value, grad

    theta0 = np.zeros(base + q)
    theta0[2 * n + 2 * k] = 0.25
    bounds = [(-3.0, 3.0)] * (2 * n + 2 * k) + [(-1.0, 1.0), (-0.9, 0.9)] + [(-1.0, 1.0)] * q

    def solve(theta: NDArray[np.float64], value: float) -> JointFit:
        ta, td, ga, gd, home, rho = unpack(theta)
        attack = ga[tg] + ta
        defence = gd[tg] + td
        model = FittedModel(
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
        home_by_group = (
            {g: float(theta[base + i]) for i, g in enumerate(home_names)} if use_home else {}
        )
        return JointFit(model, home_by_group, n_rated)

    return JointProblem(objective, theta0, bounds, solve)
