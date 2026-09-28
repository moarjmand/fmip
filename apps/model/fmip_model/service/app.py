"""The FastAPI application.

    GET  /health              liveness plus the model version and the candidate's, if any,
                              and Club Elo's recorded state (T-920)
    POST /forecast            ForecastRequest -> Forecast | Unavailable
    POST /forecast/candidate  the same question to the candidate version (T-531), 404 without one

Internal only (D-009, D-011): reached by apps/api over the compose network,
never by a browser. There is no authentication because there is no public
surface; the deployment (T-074) keeps the port unpublished.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime

from fastapi import FastAPI, HTTPException

from ..model.version import BASELINE, ModelVersion, load_candidate
from .contract import ForecastRequest, ForecastResponse, Health
from .forecaster import Forecaster, TrainingSource
from .store_source import PostgresTrainingSource


def create_app(
    source: TrainingSource | None = None,
    candidate: ModelVersion | None = None,
    *,
    read_candidate: bool = True,
) -> FastAPI:
    """Build the app around a source. Tests pass a fake; the process reads DATABASE_URL.

    The candidate is ``candidate`` when given, else the committed file's
    (``load_candidate``) unless ``read_candidate`` is false.
    """
    if source is None:
        database_url = os.environ.get("DATABASE_URL")
        if not database_url:
            raise RuntimeError(
                "DATABASE_URL is not set; the model service reads the training store"
            )
        source = PostgresTrainingSource(database_url, clubelo_refresh=clubelo_refresh())

    forecaster = Forecaster(source)
    if candidate is None and read_candidate:
        candidate = load_candidate()
    shadow = Forecaster(source, version=candidate) if candidate is not None else None
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
            candidate_version=candidate.id if candidate is not None else None,
            checked_at=datetime.now(UTC),
            elo_source=source.elo_source(),
        )

    @app.post("/forecast", response_model=ForecastResponse)
    def forecast(request: ForecastRequest) -> ForecastResponse:
        return forecaster.forecast(request)

    @app.post("/forecast/candidate", response_model=ForecastResponse)
    def forecast_candidate(request: ForecastRequest) -> ForecastResponse:
        # No candidate is the usual state, and the API records nothing for it.
        if shadow is None:
            raise HTTPException(status_code=404, detail="no candidate model version")
        return shadow.forecast(request)

    return app


def clubelo_refresh() -> bool:
    """``MODEL_CLUBELO_REFRESH``: ``off`` stops the service asking Club Elo (D-111)."""
    return os.environ.get("MODEL_CLUBELO_REFRESH", "on").strip().lower() != "off"
