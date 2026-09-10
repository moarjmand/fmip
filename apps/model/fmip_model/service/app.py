"""The FastAPI application.

    GET  /health    liveness plus the model version
    POST /forecast  ForecastRequest -> Forecast | Unavailable

Internal only (D-009, D-011): reached by apps/api over the compose network,
never by a browser. There is no authentication because there is no public
surface; the deployment (T-074) keeps the port unpublished.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime

from fastapi import FastAPI

from ..model.version import BASELINE
from .contract import ForecastRequest, ForecastResponse, Health
from .forecaster import Forecaster, TrainingSource
from .store_source import PostgresTrainingSource


def create_app(source: TrainingSource | None = None) -> FastAPI:
    """Build the app around a source. Tests pass a fake; the process reads DATABASE_URL."""
    if source is None:
        database_url = os.environ.get("DATABASE_URL")
        if not database_url:
            raise RuntimeError(
                "DATABASE_URL is not set; the model service reads the training store"
            )
        source = PostgresTrainingSource(database_url)

    forecaster = Forecaster(source)
    app = FastAPI(
        title="FMIP model service", version=BASELINE.version, docs_url=None, redoc_url=None
    )

    @app.get("/health", response_model=Health)
    def health() -> Health:
        return Health(model_version=BASELINE.id, checked_at=datetime.now(UTC))

    @app.post("/forecast", response_model=ForecastResponse)
    def forecast(request: ForecastRequest) -> ForecastResponse:
        return forecaster.forecast(request)

    return app
