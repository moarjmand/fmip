"""More leagues for the model (T-1442, D-233).

The extra leagues' files, the version's division list, the alias proposal from
results and the new divisions' verdict need nothing. The load and the
service's daily reload need DATABASE_URL and the training schema; they use the
test division ``Z8``, added to ``EXTRA_DIVISIONS`` for the test, and remove
what they wrote.
"""

import json
import os
import re
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import numpy as np
import pytest

from fmip_model.backtest.compare import DivisionResult, Row
from fmip_model.backtest.metrics import Forecast
from fmip_model.backtest.new_divisions import judge_division, new_divisions
from fmip_model.backtest.walk_forward import BacktestMatch
from fmip_model.model.dixon_coles import MatchObservation
from fmip_model.model.version import (
    BASELINE,
    CANDIDATES_DIR,
    LEGACY_DIVISIONS,
    PUBLISHED,
    CrossLeague,
    load_candidate,
)
from fmip_model.service.contract import ForecastRequest
from fmip_model.service.forecaster import Forecaster, TrainingSource
from fmip_model.training import sources
from fmip_model.training.aliases import NamedResult, OurFixture, alias_lines, propose
from fmip_model.training.football_data import ParseError, parse_extra_matches
from fmip_model.training.sources import (
    EXTRA_DIVISIONS,
    extra_season_label,
    football_data_extra_url,
)

DATABASE_URL = os.environ.get("DATABASE_URL")
needs_db = pytest.mark.skipif(not DATABASE_URL, reason="DATABASE_URL not set")

HEADER = (
    "Country,League,Season,Date,Time,Home,Away,HG,AG,Res,PSCH,PSCD,PSCA,MaxCH,MaxCD,MaxCA,"
    "AvgCH,AvgCD,AvgCA,BFECH,BFECD,BFECA,B365CH,B365CD,B365CA"
)
EXTRA_FILE = "\n".join(
    [
        "﻿" + HEADER,
        "Austria,Bundesliga,2019/2020,21/07/2019,15:00,Sturm Graz,Salzburg,0,2,A,"
        "3.26,3.34,2.4,3.26,3.4,2.5,2.96,3.2,2.33,,,,,,",
        "Austria,Bundesliga,2025/2026,01/08/2025,18:30,LASK,SK Rapid,1,1,D,"
        ",,,2.1,3.6,3.5,2.0,3.4,3.3,2.2,3.7,3.6,1.95,3.4,3.4",
        # A stray "x" where the market average should be: the next set is read.
        "Austria,Bundesliga,2025/2026,02/08/2025,17:00,Hartberg,Tirol,2,0,H,"
        "1.9,3.5,4.1,2.0,3.6,4.3,x,3.4,3.9,,,,,,",
        # Not played when the file was cut.
        "Austria,Bundesliga,2026/2027,30/10/2026,18:30,Salzburg,LASK,,,,,,,,,,,,,,,,,,",
        "",
    ]
)


def test_extra_seasons_take_the_catalogue_labels() -> None:
    assert extra_season_label("2024/2025") == "2024/25"
    assert extra_season_label("1999/2000") == "1999/00"
    # A calendar-year league's 2026 is the catalogue's 2026/27 (MLS, Brazil, Argentina).
    assert extra_season_label("2026") == "2026/27"
    for bad in ("2024/2026", "24/25", "", "2026/27"):
        with pytest.raises(ValueError):
            extra_season_label(bad)


def test_extra_divisions_fit_the_catalogue_and_never_a_main_file_code() -> None:
    catalogue = re.compile(r"^[A-Z]{1,2}[0-9C]$")  # competition_football_data_division_format
    main = {"E0", "E1", "E2", "E3", "EC", "SC0", "SC1", "SC2", "SC3", "D1", "D2", "I1", "I2",
            "SP1", "SP2", "F1", "F2", "N1", "B1", "P1", "T1", "G1"}  # fmt: skip
    assert all(catalogue.match(d) for d in EXTRA_DIVISIONS)
    assert not set(EXTRA_DIVISIONS) & (main | {"IR1", "XL"})
    assert len(set(EXTRA_DIVISIONS.values())) == len(EXTRA_DIVISIONS) == 16
    assert football_data_extra_url("US1") == "https://www.football-data.co.uk/new/USA.csv"
    with pytest.raises(ValueError, match="not an extra-leagues division"):
        football_data_extra_url("E0")


def test_an_extra_file_gives_every_played_match_with_its_season_and_closing_odds() -> None:
    rows = parse_extra_matches(EXTRA_FILE, "AT1")
    assert [(s, r.home_team, r.away_team) for s, r in rows] == [
        ("2019/20", "Sturm Graz", "Salzburg"),
        ("2025/26", "LASK", "SK Rapid"),
        ("2025/26", "Hartberg", "Tirol"),
    ]
    first, draw, home_win = (r for _, r in rows)
    assert first.division == "AT1" and first.result == "A" and first.match_date == date(2019, 7, 21)
    # The market average first, whatever Bet365 says...
    assert (draw.odds_home, draw.odds_source) == (Decimal("2.0"), "AvgC")
    # ...and an unreadable price drops its set, not the match.
    assert (home_win.odds_home, home_win.odds_source) == (Decimal("1.9"), "PSC")
    # Nothing the file lacks is invented.
    assert first.ht_home_goals is None and first.home_shots is None


def test_a_club_spelled_two_ways_is_one_name_and_a_wrong_result_is_an_error() -> None:
    text = EXTRA_FILE.replace("Sturm Graz", "Colon Santa FE")
    assert parse_extra_matches(text, "AR1")[0][1].home_team == "Colon Santa Fe"
    assert parse_extra_matches(text, "AT1")[0][1].home_team == "Colon Santa FE"
    with pytest.raises(ParseError, match="line 2"):
        parse_extra_matches(EXTRA_FILE.replace("0,2,A", "0,2,H"), "AT1")
    with pytest.raises(ParseError, match="required columns"):
        parse_extra_matches("Country,League\nAustria,Bundesliga\n", "AT1")


# --- the aliases, from results ----------------------------------------------------


def league(
    clubs: Sequence[str], seasons: Sequence[str], seed: int = 7
) -> list[tuple[str, date, str, str, int, int]]:
    rng = np.random.default_rng(seed)
    out = []
    for n, season in enumerate(seasons):
        day = date(2023 + n, 8, 1)
        for home in clubs:
            for away in clubs:
                if home != away:
                    out.append((season, day, home, away, int(rng.poisson(1.5)),
                                int(rng.poisson(1.1))))  # fmt: skip
                    day += timedelta(days=3)
    return out


def test_names_are_matched_to_clubs_by_results_never_by_likeness() -> None:
    names = ["Rapid", "Sturm", "Salzburg", "LASK", "Austria", "Altach"]
    played = league(names, ["2023/24", "2024/25"])
    ids = {"Rapid": "t-rapid", "Sturm": "t-sturm", "Salzburg": "t-rb", "LASK": "t-lask",
           "Austria": "t-fak"}  # fmt: skip
    results = [NamedResult(s, d, h, a, hg, ag) for s, d, h, a, hg, ag in played]
    # Our fixtures: one day later (a UK date against ours), only 2024/25 for one club
    # (a season not backfilled), and no Altach at all.
    fixtures = [
        OurFixture(s, d + timedelta(days=1), ids[h], ids[a], hg, ag)
        for s, d, h, a, hg, ag in played
        if h in ids and a in ids and not (s == "2023/24" and "Rapid" in (h, a))
    ]
    proposals, unresolved = propose(results, fixtures)
    assert {p.training_name: p.team_id for p in proposals} == {
        "Austria": "t-fak", "LASK": "t-lask", "Rapid": "t-rapid", "Salzburg": "t-rb",
        "Sturm": "t-sturm",
    }  # fmt: skip
    rapid = next(p for p in proposals if p.training_name == "Rapid")
    assert rapid.checkable == 2 * 5  # 2024/25 only: its 2023/24 is not ours to check
    assert rapid.agreeing == 2 * 4  # every one but against Altach, a club we do not hold
    assert [(u.training_name, u.why) for u in unresolved] == [
        ("Altach", "no fixture of ours agrees with any of its results")
    ]
    external = {"t-lask": "1", "t-rapid": "2", "t-rb": "3"}  # Sturm has no provider id
    assert alias_lines("AT1", "api_football", proposals, external) == [
        "api_football,1,AT1,LASK",
        "api_football,2,AT1,Rapid",
        "api_football,3,AT1,Salzburg",
    ]


def test_a_name_whose_results_rarely_agree_is_not_proposed() -> None:
    played = league(["A", "B", "C", "D"], ["2024/25"])
    results = [NamedResult(s, d, h, a, hg, ag) for s, d, h, a, hg, ag in played]
    # Our "A" plays other scores than the file's A, save twice: chance, not a club.
    fixtures = [
        OurFixture(s, d, f"t-{h}", f"t-{a}", hg + (7 if "A" in (h, a) else 0), ag)
        for s, d, h, a, hg, ag in played
    ]
    fixtures += [OurFixture(s, d, "t-A", f"t-{a}", hg, ag)
                 for s, d, h, a, hg, ag in played[:2]]  # fmt: skip
    proposals, unresolved = propose(results, fixtures)
    assert "A" not in {p.training_name for p in proposals}
    assert any(u.training_name == "A" for u in unresolved)


# --- the version's divisions ------------------------------------------------------


def test_a_version_without_a_list_forecasts_what_versions_did_before_t1442() -> None:
    assert BASELINE.divisions is None and PUBLISHED.divisions is None
    assert all(PUBLISHED.forecasts(d) for d in LEGACY_DIVISIONS)
    assert not PUBLISHED.forecasts("AT1") and not PUBLISHED.forecasts("G1")


def test_0_7_0_is_0_6_0_plus_fourteen_divisions_and_nothing_else() -> None:
    candidate = load_candidate(CANDIDATES_DIR / "dixon-coles-elo-0.7.0.json")
    assert candidate is not None and candidate.id == "dixon-coles-elo@0.7.0"
    assert new_divisions(candidate) == sorted(
        ["G1", "AT1", "CH1", "DK1", "PL1", "US1", "BR1", "AR1",
         "CZ1", "HR1", "RS1", "SA1", "QA1", "AE1"]
    )  # fmt: skip
    assert candidate.divisions is not None and LEGACY_DIVISIONS <= candidate.divisions
    same = replace(candidate, version=PUBLISHED.version, divisions=None)
    assert same.as_dict() == PUBLISHED.as_dict()
    assert dict(same.per_division) == dict(PUBLISHED.per_division)


def test_a_version_file_names_division_codes_only(tmp_path: Path) -> None:
    path = tmp_path / "dixon-coles-elo-0.9.0.json"
    path.write_text(json.dumps({"version": "0.9.0", "divisions": ["E0", "AT1"]}))
    version = load_candidate(path)
    assert version is not None and version.divisions == frozenset({"E0", "AT1"})
    assert version.forecasts("AT1") and not version.forecasts("SP1")
    assert version.as_dict()["divisions"] == ["AT1", "E0"]
    for bad in (["E0", "austria"], []):
        path.write_text(json.dumps({"version": "0.9.0", "divisions": bad}))
        with pytest.raises(ValueError, match="division codes"):
            load_candidate(path)


TEAMS = ["Home FC", "Away FC", "Third FC", "Fourth FC"]
HOME_ID = "00000000-0000-4000-8000-000000000a01"
AWAY_ID = "00000000-0000-4000-8000-000000000a02"
Z1_HOME_ID = "00000000-0000-4000-8000-000000000a03"
#: The catalogue ids the bridge names, per division; any other club is ``<division>:<name>``.
IDS = {"E0": {"Home FC": HOME_ID, "Away FC": AWAY_ID}, "Z1": {"Home FC": Z1_HOME_ID}}


class TwoLeagues(TrainingSource):
    """``E0`` and ``Z1``, four clubs each under the same names, different clubs."""

    def __init__(self) -> None:
        rng = np.random.default_rng(5)
        self.rows: list[tuple[str, MatchObservation]] = []
        for division in ("E0", "Z1"):
            day = date(2024, 8, 1)
            for _ in range(6):
                for home in TEAMS:
                    for away in TEAMS:
                        if home != away:
                            self.rows.append((division, MatchObservation(
                                day, home, away, int(rng.poisson(1.4)),
                                int(rng.poisson(1.1)))))  # fmt: skip
                            day += timedelta(days=4)

    def aliases(self, division: str) -> Mapping[str, str]:
        return {team: name for name, team in IDS.get(division, {}).items()}

    def matches(self, division: str, since: date, until: date) -> Sequence[MatchObservation]:
        return [m for d, m in self.rows if d == division and since <= m.date <= until]

    def elo(self, day: date) -> Mapping[str, float]:
        return {}

    def every_match(self, since: date, until: date) -> Sequence[tuple[str, MatchObservation]]:
        def club(division: str, name: str) -> str:
            return IDS[division].get(name, f"{division}:{name}")

        return [
            (d, replace(m, home=club(d, m.home), away=club(d, m.away)))
            for d, m in self.rows
            if since < m.date <= until
        ]


def ask(version_divisions: frozenset[str] | None, division: str, home: str, away: str) -> object:
    version = replace(
        BASELINE,
        version="0.9.0",
        elo_prior="own",
        history_days=1100,
        divisions=version_divisions,
        cross_league=CrossLeague(xi=0.0005, team_ridge=4, group_ridge=0.001),
    )
    now = datetime(2027, 3, 1, 12, tzinfo=UTC)
    forecaster = Forecaster(TwoLeagues(), version, clock=lambda: now)
    request = ForecastRequest(
        fixture_id="00000000-0000-4000-8000-000000000a09",
        home_team_id=home,
        away_team_id=away,
        division=division,
        kickoff_at=now + timedelta(days=1),
    )
    return forecaster.forecast(request)


def test_a_division_the_version_does_not_name_is_unavailable_and_says_why() -> None:
    answer = ask(None, "Z1", Z1_HOME_ID, Z1_HOME_ID)
    assert getattr(answer, "reason", None) == "division_not_loaded"
    assert "does not forecast Z1" in str(getattr(answer, "detail", ""))
    # Named, the division is read: what stops it now is only that Z1 maps one club.
    named = ask(frozenset({"Z1"}), "Z1", Z1_HOME_ID, AWAY_ID)
    assert getattr(named, "reason", None) == "team_not_mapped"
    assert getattr(ask(None, "E0", HOME_ID, AWAY_ID), "status", None) == "available"


def test_a_league_a_version_does_not_name_stays_out_of_its_fit_across_leagues() -> None:
    # A Z1 club is in the joint fit only for a version that forecasts Z1.
    legacy = ask(None, "XL", HOME_ID, Z1_HOME_ID)
    assert getattr(legacy, "reason", None) == "no_history"
    named = ask(LEGACY_DIVISIONS | {"Z1"}, "XL", HOME_ID, Z1_HOME_ID)
    assert getattr(named, "status", None) == "available"


# --- the new divisions' verdict ---------------------------------------------------


def rows_for(n: int, sharp: bool) -> list[Row]:
    """A model that names the stronger side; ``sharp``: it wins 70% of the time, else a third."""
    rng = np.random.default_rng(11)
    out = []
    for i in range(n):
        home_strong = bool(rng.random() < 0.5)
        draw_from, lose_from = (0.7, 1.0) if sharp else (0.34, 0.67)
        roll = rng.random()
        strong, weak = (2, 0) if roll < draw_from else (1, 1) if roll < lose_from else (0, 2)
        hg, ag = (strong, weak) if home_strong else (weak, strong)
        model = Forecast(0.6, 0.25, 0.15) if home_strong else Forecast(0.15, 0.25, 0.6)
        day = date(2025, 8, 1) + timedelta(days=i)
        match = (
            BacktestMatch(day, "a", "b", hg, ag, Decimal("2.0"), Decimal("3.4"), Decimal("4.0"))
            if i % 2
            else BacktestMatch(day, "a", "b", hg, ag)
        )
        out.append(Row(match, model, model, model, match.market))
    return out


def result(rows: list[Row]) -> DivisionResult:
    return DivisionResult("AT1", rows, without_odds=0, refits=10, fits_with_prior={"proposed": 10})


def test_a_new_division_passes_only_clearly_better_than_uniform() -> None:
    passed = judge_division(result(rows_for(400, sharp=True)), "football_data")
    assert passed.verdict == "passed" and passed.interval[1] < 0 < -passed.difference
    assert passed.with_odds is not None and passed.with_odds[0].n == 200
    failed = judge_division(result(rows_for(400, sharp=False)), "our_records")
    assert failed.verdict == "failed"
    few = judge_division(result(rows_for(60, sharp=True)), "football_data")
    assert few.verdict == "insufficient"


# --- the load and the daily reload ------------------------------------------------


@pytest.fixture
def z8(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    assert DATABASE_URL
    import psycopg

    monkeypatch.setitem(sources.EXTRA_DIVISIONS, "Z8", "ZZZ")
    yield
    with psycopg.connect(DATABASE_URL) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM training.match WHERE division = 'Z8'")
        cur.execute("DELETE FROM training.source_load WHERE scope = 'Z8'")


@needs_db
def test_an_extra_league_loads_from_a_season_on_and_reloads_its_newest_once_a_day(
    z8: None,
) -> None:
    assert DATABASE_URL
    import psycopg

    from fmip_model.service.store_source import PostgresTrainingSource
    from fmip_model.training.load import load_football_data_extra
    from fmip_model.training.store import TrainingStore

    store = TrainingStore.connect(DATABASE_URL)
    urls: list[str] = []

    def fetch(url: str) -> str:
        urls.append(url)
        return EXTRA_FILE

    try:
        [loaded] = load_football_data_extra(store, ["Z8"], since="2020/21", fetch=fetch)
    finally:
        store.close()
    assert (loaded.scope, loaded.row_count) == ("Z8", 2)  # 2019/20 is before the first season
    assert urls == ["https://www.football-data.co.uk/new/ZZZ.csv"]

    day = [date(2026, 10, 21)]
    source = PostgresTrainingSource(DATABASE_URL, today=lambda: day[0], extra_fetch=fetch)
    source.matches("Z8", date(2020, 1, 1), date(2026, 10, 20))
    source.aliases("Z8")
    assert len(urls) == 2  # once, however many reads
    day[0] = date(2026, 10, 22)
    assert len(source.matches("Z8", date(2020, 1, 1), date(2026, 10, 21))) == 2
    assert len(urls) == 3
    with psycopg.connect(DATABASE_URL) as conn, conn.cursor() as cur:
        cur.execute("SELECT count(*), min(season) FROM training.match WHERE division = 'Z8'")
        assert cur.fetchone() == (2, "2025/26")
        cur.execute(
            "SELECT count(*) FROM training.source_load WHERE scope = 'Z8' AND status = 'succeeded'"
        )
        assert cur.fetchone() == (3,)
