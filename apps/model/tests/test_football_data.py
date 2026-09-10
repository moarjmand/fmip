from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from fmip_model.training.football_data import ParseError, parse_date, parse_matches

# The first rows of the real 2024/25 Premier League file, as downloaded from
# football-data.co.uk on 2026-09-10. Real data, not typed from memory.
FIXTURE = Path(__file__).parent / "fixtures" / "football-data_E0_2425_head.csv"


def test_parses_the_real_file_head() -> None:
    rows = parse_matches(FIXTURE.read_text(encoding="utf-8"))

    assert len(rows) == 5
    first = rows[0]
    assert first.division == "E0"
    assert first.match_date == date(2024, 8, 16)
    assert (first.home_team, first.away_team) == ("Man United", "Fulham")
    assert (first.home_goals, first.away_goals, first.result) == (1, 0, "H")
    assert (first.ht_home_goals, first.ht_away_goals) == (0, 0)
    assert (first.odds_home, first.odds_draw, first.odds_away) == (
        Decimal("1.6"),
        Decimal("4.2"),
        Decimal("5.25"),
    )
    assert first.odds_source == "B365"
    assert first.home_shots is not None and first.home_shots > 0


def test_falls_back_to_average_odds_when_b365_is_missing() -> None:
    text = (
        "Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,FTR,AvgH,AvgD,AvgA\n"
        "E0,01/09/2024,A,B,2,2,D,2.1,3.4,3.3\n"
    )
    [row] = parse_matches(text)
    assert row.odds_source == "Avg"
    assert row.odds_home == Decimal("2.1")


def test_leaves_odds_null_rather_than_guessing() -> None:
    text = "Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,FTR\nE0,01/09/2024,A,B,2,2,D\n"
    [row] = parse_matches(text)
    assert (row.odds_home, row.odds_draw, row.odds_away, row.odds_source) == (
        None,
        None,
        None,
        None,
    )


def test_skips_blank_and_unplayed_rows() -> None:
    text = (
        "Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,FTR\n"
        "E0,01/09/2024,A,B,2,2,D\n"
        "E0,02/09/2024,C,D,,,\n"
        ",,,,,,\n\n"
    )
    assert len(parse_matches(text)) == 1


def test_rejects_a_result_that_disagrees_with_the_score() -> None:
    text = "Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,FTR\nE0,01/09/2024,A,B,2,0,A\n"
    with pytest.raises(ParseError, match="line 2"):
        parse_matches(text)


def test_rejects_a_file_without_the_required_columns() -> None:
    with pytest.raises(ParseError, match="required columns"):
        parse_matches("Div,Date,Home,Away\nE0,01/09/2024,A,B\n")


def test_parses_both_date_styles() -> None:
    assert parse_date("16/08/2024") == date(2024, 8, 16)
    assert parse_date("16/08/24") == date(2024, 8, 16)
    with pytest.raises(ValueError):
        parse_date("2024-08-16")
