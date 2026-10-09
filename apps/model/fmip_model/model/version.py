"""The model version: a name, a number, and the frozen constants behind it.

A forecast is immutable and records which model version produced it (rule 5
in CLAUDE.md, T-064). Changing any constant here is a new version string, so
two forecasts that disagree can always be traced to what changed.

Three directories beside this file hold the versions as files, each named
``<name>-<version>.json`` (T-1102, D-140, D-191):

- ``published/``: exactly one file, the version the site shows. ``PUBLISHED``
  is read from it; the service answers ``/forecast`` with it.
- ``candidates/``: the versions in shadow (T-531, D-082). ``load_candidates``
  reads them all, ``load_candidate`` reads one file, or the newest version
  when given none. With no file there is no candidate and the service says so.
- ``retired/``: versions that once forecast and no longer do, kept so their
  stored forecasts can still be traced to their constants (rule 5).

Promotion (D-191) is moving a file: the candidate's from ``candidates/`` to
``published/``, the old published one's to ``retired/``. Stored forecasts keep
the version that made them.

``BASELINE`` is ``dixon-coles-elo@0.1.0``, the first published version, kept
in code: a version file names only what differs from its constants.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Literal

from .dixon_coles import DEFAULT_ELO_WEIGHT, DEFAULT_RIDGE, DEFAULT_XI, ELO_SCALE


@dataclass(frozen=True)
class CrossLeague:
    """The constants of the fit that puts clubs of different leagues on one scale (T-533)."""

    xi: float
    team_ridge: float
    group_ridge: float


#: Where a version's Elo prior comes from (T-922, D-111): Club Elo's snapshot
#: of the fit date (D-029), or our own Elo computed from the training store
#: (T-921). ``clubelo_then_own`` reads Club Elo and falls back to ours on a day
#: Club Elo has no ratings for.
EloPrior = Literal["clubelo", "own", "clubelo_then_own"]
ELO_PRIORS: tuple[EloPrior, ...] = ("clubelo", "own", "clubelo_then_own")
#: The priors that read Club Elo. Club Elo is retired (D-162, T-947): only the
#: published ``dixon-coles-elo@0.1.0`` keeps reading it, because a stored
#: version never changes (rule 5); no new version may declare one of these, and
#: ``tests/test_club_elo_retired.py`` refuses a candidate file that does.
CLUB_ELO_PRIORS: frozenset[EloPrior] = frozenset({"clubelo", "clubelo_then_own"})

#: How far back the service fits from, unless a version says otherwise.
DEFAULT_HISTORY_DAYS = 400
CANDIDATES_DIR = Path(__file__).with_name("candidates")
PUBLISHED_DIR = Path(__file__).with_name("published")
RETIRED_DIR = Path(__file__).with_name("retired")


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
    #: Where the Elo prior comes from (T-922). 0.1.0 reads Club Elo.
    elo_prior: EloPrior = "clubelo"

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


def reads_club_elo(version: ModelVersion) -> bool:
    """Whether fitting ``version`` reads Club Elo's snapshots (D-162)."""
    return version.elo_prior in CLUB_ELO_PRIORS


def _version_key(version: ModelVersion) -> tuple[int, ...]:
    return tuple(int(part) for part in version.version.split("."))


def load_published(directory: Path = PUBLISHED_DIR) -> ModelVersion:
    """The published version: the one file of ``directory`` (D-191).

    No file, several files, a file that changes nothing from ``BASELINE`` or
    one not named after its version is an error, so the service never starts
    unsure which version it publishes.
    """
    files = sorted(directory.glob("*.json")) if directory.is_dir() else []
    if len(files) != 1:
        raise ValueError(f"{directory} must hold exactly one version file, not {len(files)}")
    published = load_candidates(directory)
    if not published:
        raise ValueError(f"{files[0].name} changes nothing from {BASELINE.id}")
    return next(iter(published.values()))


def load_candidates(directory: Path = CANDIDATES_DIR) -> dict[str, ModelVersion]:
    """Every candidate in ``directory``, by name: the file's stem, which must be
    ``<name>-<version>`` so that a name always means one version (D-140)."""
    out: dict[str, ModelVersion] = {}
    if not directory.is_dir():
        return out
    for path in sorted(directory.glob("*.json")):
        version = load_candidate(path)
        if version is None:
            continue
        expected = f"{version.name}-{version.version}"
        if path.stem != expected:
            raise ValueError(f"{path.name} describes {version.id}; name it {expected}.json")
        out[path.stem] = version
    return out


def load_candidate(path: Path | None = None) -> ModelVersion | None:
    """The candidate version the file describes, or ``None`` when there is none.

    With no path: the newest version in ``candidates/``, the one a backtest
    means by "the current candidate" unless told another.

    The file names a version and, per division, the constants tuning adopted;
    everything it does not name is ``BASELINE``'s (0.1.0's). ``xi``, ``ridge``
    and ``elo_weight`` at the top level (T-1368, D-186) replace 0.1.0's
    defaults: ``xi`` and ``ridge`` for every division the file does not list
    under ``per_division``, ``elo_weight`` everywhere.
    """
    if path is None:
        candidates = load_candidates()
        return max(candidates.values(), key=_version_key) if candidates else None
    if not path.exists():
        return None
    body = json.loads(path.read_text(encoding="utf-8"))
    per_division = {
        division: (float(c["xi"]), float(c["ridge"]))
        for division, c in body.get("per_division", {}).items()
    }
    history_days = int(body.get("history_days", BASELINE.history_days))
    xi = float(body.get("xi", BASELINE.xi))
    ridge = float(body.get("ridge", BASELINE.ridge))
    elo_weight = float(body.get("elo_weight", BASELINE.elo_weight))
    if xi < 0 or ridge < 0 or elo_weight < 0:
        raise ValueError("xi, ridge and elo_weight must not be negative")
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
    raw_prior = str(body.get("elo_prior", BASELINE.elo_prior))
    if raw_prior not in ELO_PRIORS:
        raise ValueError(f"elo_prior must be one of {ELO_PRIORS}, not {raw_prior!r}")
    elo_prior: EloPrior = raw_prior
    if (
        not per_division
        and (xi, ridge, elo_weight) == (BASELINE.xi, BASELINE.ridge, BASELINE.elo_weight)
        and history_days == BASELINE.history_days
        and cross_league is None
        and lineup_beta is None
        and elo_prior == BASELINE.elo_prior
    ):
        return None
    return ModelVersion(
        name=str(body.get("name", BASELINE.name)),
        version=str(body["version"]),
        xi=xi,
        ridge=ridge,
        elo_weight=elo_weight,
        elo_scale=BASELINE.elo_scale,
        max_goals=BASELINE.max_goals,
        history_days=history_days,
        per_division=per_division,
        lineup_beta=lineup_beta,
        cross_league=cross_league,
        elo_prior=elo_prior,
    )


#: The version the site shows (D-191): ``published/``'s one file.
PUBLISHED = load_published()
