"""Club Elo is retired (T-947, D-162).

No new model version may read Club Elo: a committed candidate file that
declares ``elo_prior: clubelo`` or ``clubelo_then_own`` -- or leaves the prior
out, which inherits the published version's ``clubelo`` -- is refused here. The
published ``dixon-coles-elo@0.1.0`` keeps the prior it was published with
(rule 5), so the service keeps asking Club Elo only while a version it serves
reads it.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import replace
from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fmip_model.model.version import (
    BASELINE,
    CANDIDATES_DIR,
    CLUB_ELO_PRIORS,
    load_candidate,
    reads_club_elo,
)
from fmip_model.service import app as service_app
from fmip_model.service.app import clubelo_refresh, create_app
from fmip_model.service.contract import EloSourceState
from fmip_model.service.forecaster import TrainingSource

OWN = replace(BASELINE, version="0.6.0", elo_prior="own")


def reading_club_elo(directory: Path) -> list[str]:
    """The candidate files in ``directory`` that would read Club Elo."""
    refused: list[str] = []
    for path in sorted(directory.glob("*.json")):
        body = json.loads(path.read_text(encoding="utf-8"))
        declared = body.get("elo_prior", BASELINE.elo_prior)
        version = load_candidate(path)
        if declared in CLUB_ELO_PRIORS or (version is not None and reads_club_elo(version)):
            refused.append(path.name)
    return refused


def test_no_committed_candidate_reads_club_elo() -> None:
    assert list(CANDIDATES_DIR.glob("*.json")), "the committed candidates are read"
    assert reading_club_elo(CANDIDATES_DIR) == []


def test_a_candidate_declaring_club_elo_or_inheriting_it_is_refused(tmp_path: Path) -> None:
    for name, body in {
        "dixon-coles-elo-0.6.0.json": {"version": "0.6.0", "elo_prior": "clubelo"},
        "dixon-coles-elo-0.6.1.json": {"version": "0.6.1", "elo_prior": "clubelo_then_own"},
        # No prior named: the published version's, which is Club Elo.
        "dixon-coles-elo-0.6.2.json": {"version": "0.6.2", "history_days": 900},
        "dixon-coles-elo-0.6.3.json": {"version": "0.6.3", "elo_prior": "own"},
    }.items():
        (tmp_path / name).write_text(json.dumps(body), encoding="utf-8")
    assert reading_club_elo(tmp_path) == [
        "dixon-coles-elo-0.6.0.json",
        "dixon-coles-elo-0.6.1.json",
        "dixon-coles-elo-0.6.2.json",
    ]


def test_the_published_version_keeps_the_prior_it_was_published_with() -> None:
    """Rule 5: 0.1.0's constants, Club Elo among them, are untouched until a promotion."""
    assert BASELINE.id == "dixon-coles-elo@0.1.0"
    assert BASELINE.elo_prior == "clubelo"
    assert reads_club_elo(BASELINE)


def test_asking_follows_the_versions_served(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MODEL_CLUBELO_REFRESH", raising=False)
    assert clubelo_refresh() is True  # 0.1.0 reads it
    assert clubelo_refresh([OWN]) is False  # from the promotion on: off by default
    monkeypatch.setenv("MODEL_CLUBELO_REFRESH", "on")
    assert clubelo_refresh() is True
    assert clubelo_refresh([OWN]) is False  # `on` does not bring a retired source back
    monkeypatch.setenv("MODEL_CLUBELO_REFRESH", "off")
    assert clubelo_refresh() is False


class RecordsOnly(TrainingSource):
    def elo_source(self) -> EloSourceState:
        return EloSourceState(refresh=False, state="recorded", last_succeeded_day=date(2026, 9, 24))

    def elo(self, day: date) -> Mapping[str, float]:
        return {}


def test_health_says_retired_only_once_no_served_version_reads_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    today = TestClient(create_app(RecordsOnly(), {})).get("/health").json()
    assert today["model_version"] == "dixon-coles-elo@0.1.0"
    assert today["elo_source"]["retired"] is False

    # The promotion that replaces 0.1.0 with a version reading our own Elo.
    monkeypatch.setattr(service_app, "BASELINE", OWN)
    promoted = TestClient(create_app(RecordsOnly(), {})).get("/health").json()
    assert promoted["model_version"] == "dixon-coles-elo@0.6.0"
    assert promoted["elo_source"]["retired"] is True
    # Club Elo's past snapshots stay on record as what 0.1.0 read.
    assert promoted["elo_source"]["last_succeeded_day"] == "2026-09-24"
