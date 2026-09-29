"""Travel by its proxy (T-1166, D-170): read only where the clubs' countries differ.

The pure half needs nothing. The read needs DATABASE_URL and the catalogue; it
writes two countries, a domestic league of each, three clubs and their
fixtures, and removes all of it afterwards.
"""

import os
import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta

import numpy as np
import psycopg
import pytest

from fmip_model.backtest.inputs import run_division
from fmip_model.backtest.walk_forward import BacktestMatch
from fmip_model.inputs import available
from fmip_model.inputs.cross_border import (
    Countries,
    club_countries,
    cross_border_input,
    read_countries,
)
from fmip_model.model.dixon_coles import MatchObservation
from fmip_model.model.version import BASELINE

DATABASE_URL = os.environ.get("DATABASE_URL")
D = date(2025, 9, 1)


def m(home: str, away: str) -> MatchObservation:
    return MatchObservation(D, home, away, 0, 0)


def test_a_declared_country_wins_and_a_league_gives_the_rest() -> None:
    played = [("a", "ENG", 30), ("a", "ESP", 1), ("b", "ESP", 20), ("c", "WAL", 5)]
    # c plays in Wales's cup but its row says England: the row wins.
    assert club_countries({"c": "ENG"}, played) == {"a": "ENG", "b": "ESP", "c": "ENG"}


def test_a_tie_between_countries_gives_none() -> None:
    assert club_countries({}, [("a", "ENG", 3), ("a", "WAL", 3)]) == {}


def test_only_a_match_between_two_known_different_countries_is_read() -> None:
    countries = Countries({"a": "ENG", "b": "ESP", "a2": "ENG"}, {})
    assert countries.cross_border("XL", m("a", "b")) is True
    assert countries.cross_border("XL", m("a", "a2")) is False
    assert countries.cross_border("XL", m("a", "z")) is None  # z's league is not carried
    term = cross_border_input(countries)
    assert term.features_of("XL", m("a", "b"), []) is not None
    assert term.features_of("XL", m("a", "a2"), []) is None
    assert term.features_of("XL", m("z", "b"), []) is None


def test_a_training_name_reaches_its_club_only_through_the_alias() -> None:
    countries = Countries({"id-a": "ENG", "id-b": "WAL"}, {("E1", "Cardiff"): "id-b"})
    assert countries.country("E1", "Cardiff") == "WAL"
    # A name is never a key: an unmapped name, even equal to another's, is unknown.
    assert countries.country("E0", "Cardiff") is None
    assert countries.cross_border("E1", MatchObservation(D, "id-a", "Cardiff", 0, 0)) is True


def test_the_harness_reads_cross_border_matches_only_and_fits_the_visitors_loss() -> None:
    assert "cross_border" in available()
    rng = np.random.default_rng(5)
    teams = [f"T{i}" for i in range(8)]
    country = {t: ("ENG" if i < 4 else "ESP") for i, t in enumerate(teams)}
    matches: list[BacktestMatch] = []
    start = date(2023, 8, 1)
    for r in range(160):
        day = start + timedelta(days=3 * r)
        order = rng.permutation(teams)
        for k in range(4):
            h, a = str(order[2 * k]), str(order[2 * k + 1])
            abroad = country[h] != country[a]
            mu = np.exp(0.1 - (0.5 if abroad else 0.0))  # a visitor abroad scores less
            matches.append(BacktestMatch(day, h, a, int(rng.poisson(1.4)), int(rng.poisson(mu))))
    run = run_division(
        "XL",
        "our_records",
        matches,
        (start + timedelta(days=3 * 60), start + timedelta(days=3 * 160)),
        candidate=BASELINE,
        model_input=cross_border_input(Countries(country, {})),
        min_history=60,
    )
    applied = [s for s in run.scores if s.applied]
    assert applied
    assert all(country[s.match.home] != country[s.match.away] for s in applied)
    assert len(applied) < len(run.scores)
    # The fitted term lowers the visitor's chance abroad.
    assert np.mean([s.with_input.away - s.candidate.away for s in applied]) < 0


needs_db = pytest.mark.skipif(not DATABASE_URL, reason="DATABASE_URL not set")


@pytest.fixture
def world() -> Iterator[tuple[psycopg.Connection[tuple[object, ...]], dict[str, str]]]:
    assert DATABASE_URL
    conn = psycopg.connect(DATABASE_URL)
    keys = ("c1", "c2", "l1", "l2", "s1", "s2", "home", "away", "declared")
    ids = {k: str(uuid.uuid4()) for k in keys}
    fixtures = [str(uuid.uuid4()) for _ in range(3)]
    kickoff = datetime(2025, 9, 1, 15, tzinfo=UTC)
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO country (id, code, name) VALUES (%s, 'QZA', 'Z Alpha'),"
            " (%s, 'QZB', 'Z Beta')",
            (ids["c1"], ids["c2"]),
        )
        for league, season, c in (("l1", "s1", "c1"), ("l2", "s2", "c2")):
            cur.execute(
                "INSERT INTO competition (id, name, kind, scope, country_id, gender)"
                " VALUES (%s, %s, 'league', 'domestic', %s, 'men')",
                (ids[league], f"Z cross-border {league}", ids[c]),
            )
            cur.execute(
                "INSERT INTO season (id, competition_id, label, start_date, end_date)"
                " VALUES (%s, %s, '2025/26', '2025-08-01', '2026-05-31')",
                (ids[season], ids[league]),
            )
        cur.execute(
            "INSERT INTO team (id, name, kind, gender) VALUES (%s, 'Z Home', 'club', 'men'),"
            " (%s, 'Z Away', 'club', 'men')",
            (ids["home"], ids["away"]),
        )
        # Plays in c1's league but its row states c2.
        cur.execute(
            "INSERT INTO team (id, name, kind, gender, country_id)"
            " VALUES (%s, 'Z Declared', 'club', 'men', %s)",
            (ids["declared"], ids["c2"]),
        )
        plan = [("s1", "home", "declared"), ("s2", "away", "declared"), ("s1", "declared", "home")]
        for i, (season, h, a) in enumerate(plan):
            cur.execute(
                "INSERT INTO fixture (id, season_id, kickoff_at, status)"
                " VALUES (%s, %s, %s, 'scheduled')",
                (fixtures[i], ids[season], kickoff + timedelta(days=7 * i)),
            )
            cur.execute(
                "INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES"
                " (%s, %s, 'home'), (%s, %s, 'away')",
                (fixtures[i], ids[h], fixtures[i], ids[a]),
            )
    conn.commit()
    yield conn, ids
    with conn.cursor() as cur:
        cur.execute("DELETE FROM fixture WHERE id = ANY(%s::uuid[])", (fixtures,))
        cur.execute("DELETE FROM season WHERE id = ANY(%s::uuid[])", ([ids["s1"], ids["s2"]],))
        cur.execute("DELETE FROM competition WHERE id = ANY(%s::uuid[])", ([ids["l1"], ids["l2"]],))
        cur.execute(
            "DELETE FROM team WHERE id = ANY(%s::uuid[])",
            ([ids["home"], ids["away"], ids["declared"]],),
        )
        cur.execute("DELETE FROM country WHERE id = ANY(%s::uuid[])", ([ids["c1"], ids["c2"]],))
    conn.commit()
    conn.close()


@needs_db
def test_countries_come_from_the_catalogue_by_id(
    world: tuple[psycopg.Connection[tuple[object, ...]], dict[str, str]],
) -> None:
    conn, ids = world
    countries = read_countries(conn)
    assert countries.of[ids["home"]] == ids["c1"]  # its league's country
    assert countries.of[ids["away"]] == ids["c2"]
    assert countries.of[ids["declared"]] == ids["c2"]  # its own row, over its league's
    assert countries.cross_border("XL", MatchObservation(D, ids["home"], ids["away"], 0, 0))
    assert (
        countries.cross_border("XL", MatchObservation(D, ids["away"], ids["declared"], 0, 0))
        is False
    )
