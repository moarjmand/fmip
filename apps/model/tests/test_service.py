"""The service against a fake training source: the contract, the honest cases,
and the golden example the apps/api contract test reads."""

import json
from collections.abc import Mapping, Sequence
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient

from fmip_model.model.dixon_coles import MatchObservation
from fmip_model.model.version import BASELINE, load_candidate
from fmip_model.service.app import create_app
from fmip_model.service.contract import ForecastRequest
from fmip_model.service.forecaster import Forecaster, TrainingSource

CONTRACT_DIR = Path(__file__).parent.parent / "contract"

FIXTURE = "00000000-0000-4000-8000-000000000901"
LIVERPOOL = "00000000-0000-4000-8000-000000000602"
MAN_UNITED = "00000000-0000-4000-8000-000000000601"
REAL_MADRID = "00000000-0000-4000-8000-000000000603"  # no alias
TEAMS = ["Liverpool", "Man United", "Arsenal", "Everton", "Burnley", "Luton"]
ATTACK = {t: 0.5 - i * 0.2 for i, t in enumerate(TEAMS)}
DEFENCE = {t: -0.4 + i * 0.16 for i, t in enumerate(TEAMS)}
FROZEN_NOW = datetime(2025, 3, 1, 12, 0, tzinfo=UTC)


class FakeSource(TrainingSource):
    def __init__(self, seasons: int = 4, with_elo: bool = False) -> None:
        rng = np.random.default_rng(3)
        self._matches: list[MatchObservation] = []
        day = date(2023, 8, 1)
        for _ in range(seasons):
            for home in TEAMS:
                for away in TEAMS:
                    if home == away:
                        continue
                    lam = float(np.exp(ATTACK[home] + DEFENCE[away] + 0.25))
                    mu = float(np.exp(ATTACK[away] + DEFENCE[home]))
                    self._matches.append(
                        MatchObservation(
                            day, home, away, int(rng.poisson(lam)), int(rng.poisson(mu))
                        )
                    )
                    day += timedelta(days=4)
        self.with_elo = with_elo
        self.alias_calls = 0
        self.match_calls = 0

    def aliases(self, division: str) -> Mapping[str, str]:
        self.alias_calls += 1
        return {LIVERPOOL: "Liverpool", MAN_UNITED: "Man United"} if division == "E0" else {}

    def matches(self, division: str, since: date, until: date) -> Sequence[MatchObservation]:
        self.match_calls += 1
        if division != "E0":
            return []
        return [m for m in self._matches if since <= m.date <= until]

    def elo(self, day: date) -> Mapping[str, float]:
        return {t: 1700.0 + 200 * (ATTACK[t] - DEFENCE[t]) for t in TEAMS} if self.with_elo else {}


def client(source: TrainingSource) -> TestClient:
    return TestClient(create_app(source, read_candidate=False))


def request(**overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "fixture_id": FIXTURE,
        "home_team_id": LIVERPOOL,
        "away_team_id": MAN_UNITED,
        "division": "E0",
        "kickoff_at": "2025-03-02T16:30:00Z",
    }
    body.update(overrides)
    return body


def test_health_names_the_model_version() -> None:
    response = client(FakeSource()).get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok" and body["service"] == "model"
    assert body["model_version"] == BASELINE.id


def test_forecast_is_a_complete_probability_statement() -> None:
    response = client(FakeSource()).post("/forecast", json=request())

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "available"
    assert body["fixture_id"] == FIXTURE
    p = body["probabilities"]
    assert round(p["home"] + p["draw"] + p["away"], 4) == 1.0
    assert p["home"] > p["away"]  # Liverpool is the stronger simulated side, at home
    assert body["expected_goals"]["home"] > body["expected_goals"]["away"]
    assert len(body["most_likely_scorelines"]) == 5
    assert [f["factor"] for f in body["leading_factors"]] and body["leading_factors"][0][
        "favours"
    ] in {
        "home",
        "away",
        "neither",
    }
    inputs = body["inputs"]
    assert inputs["model_version"] == BASELINE.id
    assert inputs["fit_date"] == "2025-03-01"  # the day before kick-off
    assert inputs["elo_used"] is False
    assert inputs["data_completeness"] == "limited"  # no Elo prior in this fake


def test_completeness_is_available_only_with_elo_and_enough_history() -> None:
    response = client(FakeSource(seasons=12, with_elo=True)).post("/forecast", json=request())
    inputs = response.json()["inputs"]
    assert inputs["elo_used"] is True
    assert inputs["matches_used"] >= 60
    assert inputs["data_completeness"] == "available"

    # Elo but a side with too few matches in the window: limited, and said so.
    class ThinHistory(FakeSource):
        def matches(self, division: str, since: date, until: date) -> Sequence[MatchObservation]:
            rows = list(super().matches(division, since, until))
            return [m for m in rows if "Man United" not in (m.home, m.away)][:70] + [
                m for m in rows if "Man United" in (m.home, m.away)
            ][:3]

    thin = client(ThinHistory(seasons=12, with_elo=True)).post("/forecast", json=request())
    assert thin.json()["inputs"]["data_completeness"] == "limited"


def test_unmapped_team_is_unavailable_with_a_reason_not_a_guess() -> None:
    response = client(FakeSource()).post("/forecast", json=request(away_team_id=REAL_MADRID))

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "unavailable"
    assert body["reason"] == "team_not_mapped"
    assert REAL_MADRID in body["detail"]
    assert "probabilities" not in body


def test_unloaded_division_is_unavailable() -> None:
    response = client(FakeSource()).post("/forecast", json=request(division="SP1"))
    assert response.json()["reason"] == "team_not_mapped"  # nothing aliased there either

    class AliasedButEmpty(FakeSource):
        def aliases(self, division: str) -> Mapping[str, str]:
            return {LIVERPOOL: "Liverpool", MAN_UNITED: "Man United"}

    response = client(AliasedButEmpty()).post("/forecast", json=request(division="SP1"))
    assert response.json()["reason"] == "division_not_loaded"


def test_bad_request_is_a_422_naming_the_field() -> None:
    response = client(FakeSource()).post("/forecast", json=request(home_team_id="not-a-uuid"))
    assert response.status_code == 422
    assert "home_team_id" in json.dumps(response.json())


def test_fit_is_cached_per_division_and_day() -> None:
    source = FakeSource()
    forecaster = Forecaster(source, clock=lambda: FROZEN_NOW)
    req = ForecastRequest.model_validate(request())

    forecaster.forecast(req)
    forecaster.forecast(req)
    forecaster.forecast(ForecastRequest.model_validate(request(kickoff_at="2025-03-02T20:00:00Z")))

    assert source.match_calls == 1


def test_never_fits_past_today() -> None:
    forecaster = Forecaster(FakeSource(), clock=lambda: FROZEN_NOW)
    far_future = ForecastRequest.model_validate(request(kickoff_at="2025-04-30T16:30:00Z"))
    result = forecaster.forecast(far_future)
    assert result.status == "available"
    assert result.inputs.fit_date == date(2025, 2, 28)  # yesterday, not the eve of the fixture


def test_writes_the_contract_examples_apps_api_reads() -> None:
    """Golden request and response, deterministic, so the TypeScript side can
    validate its types against what this service really emits."""
    forecaster = Forecaster(FakeSource(seasons=12, with_elo=True), clock=lambda: FROZEN_NOW)
    req = ForecastRequest.model_validate(request())
    available = forecaster.forecast(req)
    unavailable = forecaster.forecast(
        ForecastRequest.model_validate(request(away_team_id=REAL_MADRID))
    )

    CONTRACT_DIR.mkdir(exist_ok=True)
    (CONTRACT_DIR / "forecast-request.example.json").write_text(
        req.model_dump_json(indent=2) + "\n", encoding="utf-8"
    )
    (CONTRACT_DIR / "forecast-response.example.json").write_text(
        available.model_dump_json(indent=2) + "\n", encoding="utf-8"
    )
    (CONTRACT_DIR / "forecast-unavailable.example.json").write_text(
        unavailable.model_dump_json(indent=2) + "\n", encoding="utf-8"
    )

    written = json.loads(
        (CONTRACT_DIR / "forecast-response.example.json").read_text(encoding="utf-8")
    )
    assert written["status"] == "available"
    assert written["inputs"]["data_completeness"] == "available"


def test_without_a_candidate_the_candidate_route_says_so() -> None:
    app = client(FakeSource())
    assert app.get("/health").json()["candidate_version"] is None
    response = app.post("/forecast/candidate", json=request())
    assert response.status_code == 404


def test_a_candidate_answers_under_its_own_version_with_its_own_constants() -> None:
    candidate = replace(BASELINE, version="0.2.0", per_division={"E0": (0.002, 0.003)})
    app = TestClient(create_app(FakeSource(), candidate=candidate))
    assert app.get("/health").json()["candidate_version"] == "dixon-coles-elo@0.2.0"

    published = app.post("/forecast", json=request()).json()
    shadow = app.post("/forecast/candidate", json=request()).json()
    assert published["inputs"]["model_version"] == BASELINE.id
    assert shadow["inputs"]["model_version"] == "dixon-coles-elo@0.2.0"
    # Different constants for this division: a different answer to the same question.
    assert shadow["probabilities"] != published["probabilities"]


def test_the_candidate_file_names_only_what_changes(tmp_path: Path) -> None:
    assert load_candidate(tmp_path / "missing.json") is None
    empty = tmp_path / "empty.json"
    empty.write_text(json.dumps({"version": "0.2.0", "per_division": {}}))
    assert load_candidate(empty) is None
    tuned = tmp_path / "tuned.json"
    tuned.write_text(
        json.dumps(
            {
                "version": "0.2.0",
                "history_days": 1100,
                "per_division": {"E0": {"xi": 0.002, "ridge": 0.003}},
            }
        )
    )
    version = load_candidate(tuned)
    assert version is not None and version.id == "dixon-coles-elo@0.2.0"
    assert version.constants_for("E0") == (0.002, 0.003)
    assert version.constants_for("SP1") == (BASELINE.xi, BASELINE.ridge)
    assert version.history_days == 1100
