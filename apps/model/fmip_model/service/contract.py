"""The internal forecast contract, as Pydantic models.

The TypeScript twin lives in ``packages/contracts/src/forecast.ts``; the two
must change together, and ``apps/api``'s contract test holds them to it.
Field names are snake_case on the wire, like every other FMIP payload.

Everything a forecast carries is what the blueprint (6.1, 6.2, 6.4) asks to
be shown: probabilities that total 100% after rounding, expected goals, the
most likely scorelines, the leading factors, what data was used, and when it
was computed. What is not known is said, never guessed (rule 3): a fixture
the model cannot forecast gets ``status: "unavailable"`` and a reason.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

FixtureStatus = Literal["available", "unavailable"]


class ForecastRequest(BaseModel):
    """What apps/api sends. Catalog ids, plus the division hint the alias table needs."""

    fixture_id: str = Field(description="Catalog fixture UUID; echoed back, never interpreted.")
    home_team_id: str = Field(description="Catalog team UUID.")
    away_team_id: str = Field(description="Catalog team UUID.")
    division: str = Field(
        description="football-data.co.uk division code the fixture belongs to, e.g. E0.",
        min_length=2,
        max_length=3,
    )
    kickoff_at: datetime = Field(
        description="ISO 8601 with zone. The model uses only history before this."
    )

    @field_validator("home_team_id", "away_team_id", "fixture_id")
    @classmethod
    def _uuid_shaped(cls, value: str) -> str:
        import re

        if not re.fullmatch(
            r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", value
        ):
            raise ValueError("must be a UUID")
        return value.lower()


class Probabilities(BaseModel):
    home: float
    draw: float
    away: float


class ExpectedGoals(BaseModel):
    home: float
    away: float


class ScorelineProbability(BaseModel):
    home: int
    away: int
    probability: float


class LeadingFactor(BaseModel):
    """One reason the forecast leans the way it does, for the match page (blueprint 6.1)."""

    factor: Literal["team_strength", "home_advantage", "attack_vs_defence"]
    favours: Literal["home", "away", "neither"]
    # Signed, on the log-expected-goals scale: how much this factor moves lambda / mu.
    magnitude: float
    note: str


class ModelInputs(BaseModel):
    """What the forecast was computed from. Honest, so the page can say 'limited'."""

    model_version: str
    fit_date: date
    matches_used: int
    elo_used: bool
    history_from: date | None
    # 'available' when the fit had the full season of history and the Elo prior;
    # 'limited' otherwise. Mirrors CoverageState in @fmip/contracts.
    data_completeness: Literal["available", "limited"]


class Forecast(BaseModel):
    fixture_id: str
    status: Literal["available"] = "available"
    computed_at: datetime
    probabilities: Probabilities
    expected_goals: ExpectedGoals
    most_likely_scorelines: list[ScorelineProbability]
    leading_factors: list[LeadingFactor]
    inputs: ModelInputs


class Unavailable(BaseModel):
    """The model cannot forecast this fixture. The reason is for the page and the log."""

    fixture_id: str
    status: Literal["unavailable"] = "unavailable"
    computed_at: datetime
    reason: Literal["team_not_mapped", "no_history", "division_not_loaded"]
    detail: str


ForecastResponse = Forecast | Unavailable


class Health(BaseModel):
    status: Literal["ok"] = "ok"
    service: Literal["model"] = "model"
    model_version: str
    checked_at: datetime
