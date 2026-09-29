"""The FastAPI application.

    GET  /health                   liveness plus the model version, the candidates' versions,
                                   and Club Elo's recorded state (T-920)
    POST /forecast                 ForecastRequest -> Forecast | Unavailable
    GET  /candidates               every candidate in shadow, by name (T-1102, D-140)
    POST /forecast/candidate/{name}  the same question to that candidate, 404 for no such name

Internal only (D-009, D-011): reached by apps/api over the compose network,
never by a browser. There is no authentication because there is no public
surface; the deployment (T-074) keeps the port unpublished.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from datetime import UTC, datetime

from fastapi import FastAPI, HTTPException

from ..model.version import BASELINE, ModelVersion, load_candidates
from .contract import Candidate, CandidateList, ForecastRequest, ForecastResponse, Health
from .forecaster import Forecaster, TrainingSource
from .store_source import PostgresTrainingSource


def _oldest_first(version: ModelVersion) -> tuple[int, ...]:
    return tuple(int(part) for part in version.version.split("."))


def create_app(
    source: TrainingSource | None = None,
    candidates: Mapping[str, ModelVersion] | None = None,
    *,
    read_candidates: bool = True,
) -> FastAPI:
    """Build the app around a source. Tests pass a fake; the process reads DATABASE_URL.

    The candidates are ``candidates`` when given, else the committed files'
    (``load_candidates``) unless ``read_candidates`` is false.
    """
    if source is None:
        database_url = os.environ.get("DATABASE_URL")
        if not database_url:
            raise RuntimeError(
                "DATABASE_URL is not set; the model service reads the training store"
            )
        source = PostgresTrainingSource(database_url, clubelo_refresh=clubelo_refresh())

    forecaster = Forecaster(source)
    if candidates is None:
        candidates = load_candidates() if read_candidates else {}
    named = sorted(candidates.items(), key=lambda item: _oldest_first(item[1]))
    shadows = {name: Forecaster(source, version=version) for name, version in named}
    listing = CandidateList(
        candidates=[Candidate(name=name, model_version=version.id) for name, version in named]
    )
    app = FastAPI(
        title="FMIP model service", version=BASELINE.version, docs_url=None, redoc_url=None
    )

    @app.get("/health", response_model=Health)
    def health() -> Health:
        # The watchdog asks every minute; the source asks Club Elo when it is
        # due, in the background, so a slow source never slows this answer.
        source.ask_elo()
        return Health(
            model_version=BASELINE.id,
            candidate_versions=[c.model_version for c in listing.candidates],
            checked_at=datetime.now(UTC),
            elo_source=source.elo_source(),
        )

    @app.post("/forecast", response_model=ForecastResponse)
    def forecast(request: ForecastRequest) -> ForecastResponse:
        return forecaster.forecast(request)

    @app.get("/candidates", response_model=CandidateList)
    def candidate_list() -> CandidateList:
        # None is the usual state between candidates, and the API records nothing for it.
        return listing

    @app.post("/forecast/candidate/{name}", response_model=ForecastResponse)
    def forecast_candidate(name: str, request: ForecastRequest) -> ForecastResponse:
        shadow = shadows.get(name)
        if shadow is None:
            raise HTTPException(status_code=404, detail=f"no candidate named {name!r}")
        return shadow.forecast(request)

    return app


def clubelo_refresh() -> bool:
    """``MODEL_CLUBELO_REFRESH``: ``off`` stops the service asking Club Elo (D-111)."""
    return os.environ.get("MODEL_CLUBELO_REFRESH", "on").strip().lower() != "off"
