"""Club Elo is retired (T-947, D-162).

No new model version may read Club Elo: a committed candidate file that
declares ``elo_prior: clubelo`` or ``clubelo_then_own`` -- or leaves the prior
out, which inherits 0.1.0's ``clubelo`` -- is refused here, and so is a
published or retired file that would. ``dixon-coles-elo@0.1.0`` keeps the
prior it was published with (rule 5); since it was replaced by 0.6.0 (D-191)
no version the service serves reads Club Elo, so the service stops asking.
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
    PUBLISHED,
    PUBLISHED_DIR,
    RETIRED_DIR,
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


def test_no_committed_version_file_reads_club_elo() -> None:
    files = [p for d in (CANDIDATES_DIR, PUBLISHED_DIR, RETIRED_DIR) for p in d.glob("*.json")]
    assert files, "the committed version files are read"
    for directory in (CANDIDATES_DIR, PUBLISHED_DIR, RETIRED_DIR):
        assert reading_club_elo(directory) == []


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


def test_0_1_0_keeps_the_prior_it_was_published_with() -> None:
    """Rule 5: 0.1.0's constants, Club Elo among them, are untouched by its replacement."""
    assert BASELINE.id == "dixon-coles-elo@0.1.0"
    assert BASELINE.elo_prior == "clubelo"
    assert reads_club_elo(BASELINE)
    assert not reads_club_elo(PUBLISHED)


def test_asking_follows_the_versions_served(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MODEL_CLUBELO_REFRESH", raising=False)
    assert clubelo_refresh([BASELINE]) is True  # 0.1.0 reads it
    assert clubelo_refresh() is False  # since 0.1.0 was replaced (D-191): off by default
    monkeypatch.setenv("MODEL_CLUBELO_REFRESH", "on")
    assert clubelo_refresh([BASELINE]) is True
    assert clubelo_refresh() is False  # `on` does not bring a retired source back
    monkeypatch.setenv("MODEL_CLUBELO_REFRESH", "off")
    assert clubelo_refresh([BASELINE]) is False


class RecordsOnly(TrainingSource):
    def elo_source(self) -> EloSourceState:
        return EloSourceState(refresh=False, state="recorded", last_succeeded_day=date(2026, 9, 24))

    def elo(self, day: date) -> Mapping[str, float]:
        return {}


def test_health_says_retired_only_once_no_served_version_reads_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Before the promotion (D-191): 0.1.0 published, reading Club Elo.
    monkeypatch.setattr(service_app, "PUBLISHED", BASELINE)
    before = TestClient(create_app(RecordsOnly(), {})).get("/health").json()
    assert before["model_version"] == "dixon-coles-elo@0.1.0"
    assert before["elo_source"]["retired"] is False

    # The promotion that replaced 0.1.0 with a version reading our own Elo.
    monkeypatch.setattr(service_app, "PUBLISHED", OWN)
    promoted = TestClient(create_app(RecordsOnly(), {})).get("/health").json()
    assert promoted["model_version"] == "dixon-coles-elo@0.6.0"
    assert promoted["elo_source"]["retired"] is True
    # Club Elo's past snapshots stay on record as what 0.1.0 read.
    assert promoted["elo_source"]["last_succeeded_day"] == "2026-09-24"
