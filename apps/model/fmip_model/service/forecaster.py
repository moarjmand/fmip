"""Turning a request into a forecast: aliases, a cached fit, and the honest cases."""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

from ..model.dixon_coles import FittedModel, MatchObservation, fit
from ..model.version import BASELINE, ModelVersion
from .contract import (
    ExpectedGoals,
    Forecast,
    ForecastRequest,
    ForecastResponse,
    LeadingFactor,
    ModelInputs,
    Probabilities,
    ScorelineProbability,
    Unavailable,
)

MIN_HISTORY = 60
HISTORY_DAYS = 400  # a season and a bit: the decay makes older matches nearly weightless anyway
# A side with fewer matches than this in the window is forecast, but the
# forecast says "limited": the strengths rest on the prior more than on results.
MIN_MATCHES_PER_TEAM = 15


class TrainingSource:
    """What the forecaster reads. A port, so the service can be tested without a database."""

    def aliases(self, division: str) -> Mapping[str, str]:  # team_id -> training name
        raise NotImplementedError

    def matches(self, division: str, since: date, until: date) -> Sequence[MatchObservation]:
        raise NotImplementedError

    def elo(self, day: date) -> Mapping[str, float]:
        raise NotImplementedError


@dataclass
class CachedFit:
    division: str
    fit_date: date
    model: FittedModel
    elo_used: bool
    history_from: date
    matches_per_team: Mapping[str, int]


class Forecaster:
    """Fits once per (division, day) and answers from the cache."""

    def __init__(
        self,
        source: TrainingSource,
        version: ModelVersion = BASELINE,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self.source = source
        self.version = version
        self.clock = clock
        self._fits: dict[tuple[str, date], CachedFit] = {}

    def forecast(self, request: ForecastRequest) -> ForecastResponse:
        now = self.clock()
        # History strictly before kick-off day; never later than today.
        fit_date = min(request.kickoff_at.date(), now.date()) - timedelta(days=1)

        aliases = self.source.aliases(request.division)
        missing = [t for t in (request.home_team_id, request.away_team_id) if t not in aliases]
        if missing:
            return Unavailable(
                fixture_id=request.fixture_id,
                computed_at=now,
                reason="team_not_mapped",
                detail=(
                    f"no training-store alias in {request.division} for team {', '.join(missing)}"
                ),
            )

        cached = self._fit_for(request.division, fit_date)
        if cached is None:
            return Unavailable(
                fixture_id=request.fixture_id,
                computed_at=now,
                reason="division_not_loaded",
                detail=f"fewer than {MIN_HISTORY} matches for {request.division} before {fit_date}",
            )

        home, away = aliases[request.home_team_id], aliases[request.away_team_id]
        if home not in cached.model.attack or away not in cached.model.attack:
            unknown = home if home not in cached.model.attack else away
            return Unavailable(
                fixture_id=request.fixture_id,
                computed_at=now,
                reason="no_history",
                detail=f"{unknown!r} has no matches in {request.division} before {fit_date}",
            )

        outcome = cached.model.predict(home, away)
        h, d, a = outcome.rounded(4)

        return Forecast(
            fixture_id=request.fixture_id,
            computed_at=now,
            probabilities=Probabilities(home=h, draw=d, away=a),
            expected_goals=ExpectedGoals(
                home=round(outcome.expected_home_goals, 3),
                away=round(outcome.expected_away_goals, 3),
            ),
            most_likely_scorelines=[
                ScorelineProbability(home=s.home, away=s.away, probability=round(s.probability, 4))
                for s in outcome.most_likely
            ],
            leading_factors=leading_factors(cached.model, home, away),
            inputs=ModelInputs(
                model_version=self.version.id,
                fit_date=cached.fit_date,
                matches_used=cached.model.matches_used,
                elo_used=cached.elo_used,
                history_from=cached.history_from,
                data_completeness=(
                    "available"
                    if cached.elo_used
                    and min(
                        cached.matches_per_team.get(home, 0), cached.matches_per_team.get(away, 0)
                    )
                    >= MIN_MATCHES_PER_TEAM
                    else "limited"
                ),
            ),
        )

    def _fit_for(self, division: str, fit_date: date) -> CachedFit | None:
        key = (division, fit_date)
        if key in self._fits:
            return self._fits[key]

        history_from = fit_date - timedelta(days=HISTORY_DAYS)
        matches = self.source.matches(division, history_from, fit_date)
        if len(matches) < MIN_HISTORY:
            return None

        elo = dict(self.source.elo(fit_date))
        model = fit(
            matches,
            fit_date,
            elo=elo or None,
            xi=self.version.xi,
            ridge=self.version.ridge,
            elo_weight=self.version.elo_weight,
        )
        per_team: dict[str, int] = {}
        for m in matches:
            per_team[m.home] = per_team.get(m.home, 0) + 1
            per_team[m.away] = per_team.get(m.away, 0) + 1
        cached = CachedFit(
            division,
            fit_date,
            model,
            elo_used=bool(elo),
            history_from=history_from,
            matches_per_team=per_team,
        )
        # One fit per division is enough to keep; yesterday's is never asked for again.
        self._fits = {k: v for k, v in self._fits.items() if k[0] != division}
        self._fits[key] = cached
        return cached


def leading_factors(model: FittedModel, home: str, away: str) -> list[LeadingFactor]:
    """The three terms of the expected-goals difference, largest first."""
    strength = model.strength(home) - model.strength(away)
    attack_edge = model.attack[home] - model.attack[away]
    defence_edge = model.defence[away] - model.defence[home]  # positive: away concedes more

    def favours(x: float) -> str:
        return "home" if x > 0.02 else "away" if x < -0.02 else "neither"

    factors = [
        LeadingFactor(
            factor="team_strength",
            favours=favours(strength),  # type: ignore[arg-type]
            magnitude=round(strength, 3),
            note="net strength (attack minus defence) from recent results and the Elo prior",
        ),
        LeadingFactor(
            factor="home_advantage",
            favours="home" if model.home_advantage > 0 else "neither",
            magnitude=round(model.home_advantage, 3),
            note="league-wide home advantage learned from the training window",
        ),
        LeadingFactor(
            factor="attack_vs_defence",
            favours=favours(attack_edge + defence_edge),  # type: ignore[arg-type]
            magnitude=round(attack_edge + defence_edge, 3),
            note="how the sides' attacks match up against the opposing defences",
        ),
    ]
    return sorted(factors, key=lambda f: abs(f.magnitude), reverse=True)
