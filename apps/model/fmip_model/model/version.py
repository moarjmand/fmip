"""The model version: a name, a number, and the frozen constants behind it.

A forecast is immutable and records which model version produced it (rule 5
in CLAUDE.md, T-064). Changing any constant here is a new version string, so
two forecasts that disagree can always be traced to what changed.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

from .dixon_coles import DEFAULT_ELO_WEIGHT, DEFAULT_RIDGE, DEFAULT_XI, ELO_SCALE


@dataclass(frozen=True)
class ModelVersion:
    name: str
    version: str
    xi: float
    ridge: float
    elo_weight: float
    elo_scale: float
    max_goals: int

    @property
    def id(self) -> str:
        return f"{self.name}@{self.version}"

    def as_dict(self) -> dict[str, object]:
        return {"id": self.id, **asdict(self)}


BASELINE = ModelVersion(
    name="dixon-coles-elo",
    version="0.1.0",
    xi=DEFAULT_XI,
    ridge=DEFAULT_RIDGE,
    elo_weight=DEFAULT_ELO_WEIGHT,
    elo_scale=ELO_SCALE,
    max_goals=10,
)
