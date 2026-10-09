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
from collections.abc import Iterable, Mapping
from datetime import UTC, datetime

from fastapi import FastAPI, HTTPException

from ..model.version import PUBLISHED, ModelVersion, load_candidates, reads_club_elo
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
    published: ModelVersion | None = None,
) -> FastAPI:
    """Build the app around a source. Tests pass a fake; the process reads DATABASE_URL.

    The candidates are ``candidates`` when given, else the committed files'
    (``load_candidates``) unless ``read_candidates`` is false. The published
    version is ``PUBLISHED`` (``published/``'s file, D-191) unless a test
    passes another.
    """
    published = PUBLISHED if published is None else published
    if candidates is None:
        candidates = load_candidates() if read_candidates else {}
    # D-162: Club Elo is retired once no version this service serves reads it,
    # which is from the promotion that replaced dixon-coles-elo@0.1.0 on (D-191).
    club_elo_retired = not club_elo_read_by([published, *candidates.values()])
    if source is None:
        database_url = os.environ.get("DATABASE_URL")
        if not database_url:
            raise RuntimeError(
                "DATABASE_URL is not set; the model service reads the training store"
            )
        source = PostgresTrainingSource(
            database_url, clubelo_refresh=clubelo_refresh([published, *candidates.values()])
        )

    forecaster = Forecaster(source, version=published)
    named = sorted(candidates.items(), key=lambda item: _oldest_first(item[1]))
    shadows = {name: Forecaster(source, version=version) for name, version in named}
    listing = CandidateList(
        candidates=[Candidate(name=name, model_version=version.id) for name, version in named]
    )
    app = FastAPI(
        title="FMIP model service", version=published.version, docs_url=None, redoc_url=None
    )

    @app.get("/health", response_model=Health)
    def health() -> Health:
        # The watchdog asks every minute; the source asks Club Elo when it is
        # due, in the background, so a slow source never slows this answer.
        source.ask_elo()
        elo_source = source.elo_source()
        if elo_source is not None and club_elo_retired:
            elo_source = elo_source.model_copy(update={"retired": True})
        return Health(
            model_version=published.id,
            candidate_versions=[c.model_version for c in listing.candidates],
            checked_at=datetime.now(UTC),
            elo_source=elo_source,
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


def club_elo_read_by(versions: Iterable[ModelVersion]) -> bool:
    """Whether any of ``versions`` fits with Club Elo's snapshots (D-162)."""
    return any(reads_club_elo(version) for version in versions)


def clubelo_refresh(served: Iterable[ModelVersion] = (PUBLISHED,)) -> bool:
    """Whether the service asks Club Elo each day (T-920, D-111, D-162).

    ``MODEL_CLUBELO_REFRESH=off`` stops the asking. Otherwise (unset, or
    ``on``) the service asks while a version it serves reads Club Elo -- only
    ``dixon-coles-elo@0.1.0`` did -- and never once none does: since the
    promotion that replaced 0.1.0 (D-191) the default is off, and ``on`` does
    not bring back a retired source nothing would read.
    """
    if os.environ.get("MODEL_CLUBELO_REFRESH", "").strip().lower() == "off":
        return False
    return club_elo_read_by(served)
