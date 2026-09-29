"""Coach changes from stored line-ups (T-1130, D-147).

The pure half needs nothing. The database half needs DATABASE_URL and the
catalogue; it writes one competition set to the test division ``Z8``, two
clubs, three people and five fixtures, and removes all of it afterwards.
"""

import os
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import psycopg
import pytest

from fmip_model.training.coaches import (
    LineUp,
    coach_changes,
    coach_contexts,
    read_lineups,
    summarise,
)
from fmip_model.training.records import recorded_matches

DATABASE_URL = os.environ.get("DATABASE_URL")
START = datetime(2025, 8, 1, 15, tzinfo=UTC)


def lineups(team: str, coaches: list[str | None], season: str = "2025/26") -> list[LineUp]:
    return [
        LineUp(team, f"{team}-f{i}", START + timedelta(days=7 * i), season, coach)
        for i, coach in enumerate(coaches)
    ]


def test_a_change_is_two_named_line_ups_naming_different_people() -> None:
    changes = coach_changes(lineups("club", ["a", "a", "b", "b"]))
    assert [(c.fixture_id, c.previous_coach_id, c.coach_id, c.gaps_between) for c in changes] == [
        ("club-f2", "a", "b", 0)
    ]
    contexts = coach_contexts(lineups("club", ["a", "a", "b", "b"]))
    assert [(c.coach_id, c.match_under_coach, c.after_change) for c in contexts] == [
        ("a", 1, False),  # the first stored coach: counted from the first stored line-up
        ("a", 2, False),
        ("b", 1, True),
        ("b", 2, True),
    ]


def test_a_gap_is_never_a_change_and_never_carried_forward() -> None:
    same = lineups("club", ["a", None, "a"])
    assert coach_changes(same) == []
    contexts = coach_contexts(same)
    assert [(c.coach_id, c.match_under_coach) for c in contexts] == [
        ("a", 1),
        (None, None),
        ("a", 2),
    ]

    across = coach_changes(lineups("club", ["a", None, None, "b"]))
    assert [(c.fixture_id, c.gaps_between) for c in across] == [("club-f3", 2)]
    # A club whose line-ups start with gaps has no change until two named ones differ.
    assert coach_changes(lineups("club", [None, "a", None])) == []


def test_a_return_is_two_changes_and_the_count_restarts() -> None:
    seq = lineups("club", ["a", "b", "a", "a"])
    changes = coach_changes(seq)
    assert [(c.previous_coach_id, c.coach_id) for c in changes] == [("a", "b"), ("b", "a")]
    assert [c.match_under_coach for c in coach_contexts(seq)] == [1, 1, 1, 2]


def test_clubs_are_separate_and_order_is_kick_off_not_input() -> None:
    mixed = list(reversed(lineups("x", ["a", "b"]))) + lineups("y", ["b", "a"], "2024/25")
    changes = coach_changes(mixed)
    assert sorted((c.team_id, c.coach_id) for c in changes) == [("x", "b"), ("y", "a")]
    s = summarise(mixed)
    assert (s.clubs, s.lineups, s.named, s.gaps, s.changes, s.clubs_with_a_change) == (
        2,
        4,
        4,
        0,
        2,
        2,
    )
    assert s.changes_by_season == {"2024/25": 1, "2025/26": 1}


needs_db = pytest.mark.skipif(not DATABASE_URL, reason="DATABASE_URL not set")


@pytest.fixture
def world() -> Iterator[tuple[psycopg.Connection[tuple[object, ...]], dict[str, str]]]:
    assert DATABASE_URL
    conn = psycopg.connect(DATABASE_URL)
    keys = ("comp", "season", "club", "other", "coach_a", "coach_b", "player")
    ids = {k: str(uuid.uuid4()) for k in keys}
    fixtures = [str(uuid.uuid4()) for _ in range(5)]
    ids.update({f"f{i}": f for i, f in enumerate(fixtures)})
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO competition (id, name, kind, scope, gender, football_data_division)"
            " VALUES (%s, 'Z8 coaches test', 'league', 'continental', 'men', 'Z8')",
            (ids["comp"],),
        )
        cur.execute(
            "INSERT INTO season (id, competition_id, label, start_date, end_date)"
            " VALUES (%s, %s, '2025/26', '2025-08-01', '2026-05-31')",
            (ids["season"], ids["comp"]),
        )
        cur.execute(
            "INSERT INTO team (id, name, kind, gender) VALUES"
            " (%s, 'Z8 Club', 'club', 'men'), (%s, 'Z8 Other', 'club', 'men')",
            (ids["club"], ids["other"]),
        )
        # Two coaches with the same name: only the person id tells them apart (rule 1).
        cur.execute(
            "INSERT INTO person (id, full_name) VALUES"
            " (%s, 'Z8 Same Name'), (%s, 'Z8 Same Name'), (%s, 'Z8 Player')",
            (ids["coach_a"], ids["coach_b"], ids["player"]),
        )
        # f0: coach A; f1: a line-up naming no coach (a gap); f2: coach B;
        # f3: no line-up and no coach (not a line-up); f4: scheduled, coach A.
        plan = [
            ("finished", ids["coach_a"], False),
            ("finished", None, True),
            ("finished", ids["coach_b"], False),
            ("finished", None, False),
            ("scheduled", ids["coach_a"], False),
        ]
        for i, (status, coach, lineup_row) in enumerate(plan):
            f = ids[f"f{i}"]
            cur.execute(
                "INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES (%s, %s, %s, %s)",
                (f, ids["season"], START + timedelta(days=7 * i), status),
            )
            cur.execute(
                "INSERT INTO fixture_participant (fixture_id, team_id, side, coach_id) VALUES"
                " (%s, %s, 'home', %s), (%s, %s, 'away', NULL)",
                (f, ids["club"], coach, f, ids["other"]),
            )
            if lineup_row:
                cur.execute(
                    "INSERT INTO lineup (participant_id, person_id, role)"
                    " SELECT id, %s, 'starter' FROM fixture_participant"
                    " WHERE fixture_id = %s AND side = 'home'",
                    (ids["player"], f),
                )
            if status == "finished":
                cur.execute(
                    "INSERT INTO fixture_score (fixture_id, kind, home, away)"
                    " VALUES (%s, 'full_time', 1, 0)",
                    (f,),
                )
    conn.commit()
    yield conn, ids
    with conn.cursor() as cur:
        cur.execute("DELETE FROM fixture_score WHERE fixture_id = ANY(%s::uuid[])", (fixtures,))
        cur.execute("DELETE FROM fixture WHERE id = ANY(%s::uuid[])", (fixtures,))
        cur.execute(
            "DELETE FROM person WHERE id = ANY(%s::uuid[])",
            ([ids["coach_a"], ids["coach_b"], ids["player"]],),
        )
        cur.execute("DELETE FROM season WHERE id = %s", (ids["season"],))
        cur.execute("DELETE FROM competition WHERE id = %s", (ids["comp"],))
        cur.execute("DELETE FROM team WHERE id = ANY(%s::uuid[])", ([ids["club"], ids["other"]],))
    conn.commit()
    conn.close()


@needs_db
def test_stored_line_ups_give_one_change_across_one_gap(
    world: tuple[psycopg.Connection[tuple[object, ...]], dict[str, str]],
) -> None:
    conn, ids = world
    mine = [lu for lu in read_lineups(conn) if lu.team_id in (ids["club"], ids["other"])]
    # The club's three finished line-ups; the other side has neither a line-up nor a coach.
    assert [(lu.fixture_id, lu.coach_id) for lu in mine] == [
        (ids["f0"], ids["coach_a"]),
        (ids["f1"], None),
        (ids["f2"], ids["coach_b"]),
    ]
    changes = coach_changes(mine)
    assert [(c.fixture_id, c.previous_coach_id, c.coach_id, c.gaps_between) for c in changes] == [
        (ids["f2"], ids["coach_a"], ids["coach_b"], 1)
    ]


@needs_db
def test_the_records_loader_carries_each_sides_coach(
    world: tuple[psycopg.Connection[tuple[object, ...]], dict[str, str]],
) -> None:
    conn, ids = world
    matches = recorded_matches(conn, "Z8")
    assert [(m.home_coach_id, m.away_coach_id) for m in matches] == [
        (ids["coach_a"], None),
        (None, None),
        (ids["coach_b"], None),
        (None, None),
    ]
