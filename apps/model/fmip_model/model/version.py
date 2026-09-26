"""The model version: a name, a number, and the frozen constants behind it.

A forecast is immutable and records which model version produced it (rule 5
in CLAUDE.md, T-064). Changing any constant here is a new version string, so
two forecasts that disagree can always be traced to what changed.

``BASELINE`` is the published version. ``load_candidate`` reads the candidate
the service offers for shadow forecasts (T-531, D-082) from ``candidate.json``
beside this file; with no file, or a file that changes nothing, there is no
candidate and the service says so.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import asdict, dataclass, field
from pathlib import Path

from .dixon_coles import DEFAULT_ELO_WEIGHT, DEFAULT_RIDGE, DEFAULT_XI, ELO_SCALE


@dataclass(frozen=True)
class CrossLeague:
    """The constants of the fit that puts clubs of different leagues on one scale (T-533)."""

    xi: float
    team_ridge: float
    group_ridge: float


#: How far back the service fits from, unless a version says otherwise.
DEFAULT_HISTORY_DAYS = 400
CANDIDATE_FILE = Path(__file__).with_name("candidate.json")


@dataclass(frozen=True)
class ModelVersion:
    name: str
    version: str
    xi: float
    ridge: float
    elo_weight: float
    elo_scale: float
    max_goals: int
    #: Days of history a fit reads. Long enough that the time decay, not the
    #: window, is what forgets an old match.
    history_days: int = DEFAULT_HISTORY_DAYS
    #: ``(xi, ridge)`` for the divisions where tuning beat ``xi`` and ``ridge``
    #: out of sample (T-532); every other division fits with those.
    per_division: Mapping[str, tuple[float, float]] = field(
        default_factory=dict, hash=False, compare=False
    )
    #: How far a difference in XI strength moves the expected goals (T-534);
    #: ``None``: the version does not read line-ups.
    lineup_beta: float | None = None
    #: Whether, and with which constants, this version answers a match between
    #: clubs of different leagues (T-533). ``None``: it rates within one league.
    cross_league: CrossLeague | None = None

    @property
    def id(self) -> str:
        return f"{self.name}@{self.version}"

    def constants_for(self, division: str) -> tuple[float, float]:
        return self.per_division.get(division, (self.xi, self.ridge))

    def as_dict(self) -> dict[str, object]:
        body = asdict(self)
        body["per_division"] = {d: list(c) for d, c in self.per_division.items()}
        body["cross_league"] = None if self.cross_league is None else asdict(self.cross_league)
        return {"id": self.id, **body}


BASELINE = ModelVersion(
    name="dixon-coles-elo",
    version="0.1.0",
    xi=DEFAULT_XI,
    ridge=DEFAULT_RIDGE,
    elo_weight=DEFAULT_ELO_WEIGHT,
    elo_scale=ELO_SCALE,
    max_goals=10,
)


def load_candidate(path: Path = CANDIDATE_FILE) -> ModelVersion | None:
    """The candidate version the file describes, or ``None`` when there is none.

    The file names a version and, per division, the constants tuning adopted;
    everything it does not name is the published version's.
    """
    if not path.exists():
        return None
    body = json.loads(path.read_text(encoding="utf-8"))
    per_division = {
        division: (float(c["xi"]), float(c["ridge"]))
        for division, c in body.get("per_division", {}).items()
    }
    history_days = int(body.get("history_days", BASELINE.history_days))
    raw_beta = body.get("lineup_beta")
    lineup_beta = None if raw_beta is None else float(raw_beta)
    cross = body.get("cross_league")
    cross_league = (
        None
        if cross is None
        else CrossLeague(
            xi=float(cross["xi"]),
            team_ridge=float(cross["team_ridge"]),
            group_ridge=float(cross["group_ridge"]),
        )
    )
    if (
        not per_division
        and history_days == BASELINE.history_days
        and cross_league is None
        and lineup_beta is None
    ):
        return None
    return ModelVersion(
        name=str(body.get("name", BASELINE.name)),
        version=str(body["version"]),
        xi=BASELINE.xi,
        ridge=BASELINE.ridge,
        elo_weight=BASELINE.elo_weight,
        elo_scale=BASELINE.elo_scale,
        max_goals=BASELINE.max_goals,
        history_days=history_days,
        per_division=per_division,
        lineup_beta=lineup_beta,
        cross_league=cross_league,
    )
