"""Parsing football-data.co.uk CSV files into rows for ``training.match``.

The files change shape between seasons and divisions: the odds columns come
and go, older files have two-digit years, some rows are blank. Everything the
store needs is read defensively, and anything the file does not carry is
``None``, never a made-up number (CLAUDE.md rule 3 applies to training data
too: an invented odd would poison the calibration benchmark).
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

# Bookmaker column sets in order of preference. The first one fully present on
# a row is used and named in ``odds_source``; the fixture files carry B365 for
# every season of interest, Avg for most, and older files only a few books.
ODDS_COLUMNS: tuple[tuple[str, tuple[str, str, str]], ...] = (
    ("B365", ("B365H", "B365D", "B365A")),
    ("Avg", ("AvgH", "AvgD", "AvgA")),
    ("PS", ("PSH", "PSD", "PSA")),
    ("WH", ("WHH", "WHD", "WHA")),
)


@dataclass(frozen=True)
class MatchRow:
    division: str
    match_date: date
    home_team: str
    away_team: str
    home_goals: int
    away_goals: int
    result: str
    ht_home_goals: int | None
    ht_away_goals: int | None
    home_shots: int | None
    away_shots: int | None
    home_shots_on_target: int | None
    away_shots_on_target: int | None
    odds_home: Decimal | None
    odds_draw: Decimal | None
    odds_away: Decimal | None
    odds_source: str | None


class ParseError(ValueError):
    """A row the file should not contain. Carries the line number."""


def parse_date(value: str) -> date:
    """``dd/mm/yy`` (older files) or ``dd/mm/yyyy``."""
    for pattern in ("%d/%m/%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(value.strip(), pattern).date()
        except ValueError:
            continue
    raise ValueError(f"unrecognised date {value!r}")


def _int(value: str | None) -> int | None:
    if value is None or value.strip() == "":
        return None
    return int(value)


def _decimal(value: str | None) -> Decimal | None:
    if value is None or value.strip() == "":
        return None
    try:
        return Decimal(value.strip())
    except InvalidOperation as error:
        raise ValueError(f"not a number: {value!r}") from error


def _odds(row: dict[str, str]) -> tuple[Decimal | None, Decimal | None, Decimal | None, str | None]:
    for name, (home, draw, away) in ODDS_COLUMNS:
        values = (_decimal(row.get(home)), _decimal(row.get(draw)), _decimal(row.get(away)))
        if all(v is not None and v > 1 for v in values):
            return values[0], values[1], values[2], name
    return None, None, None, None


def parse_matches(text: str) -> list[MatchRow]:
    """Every completed match in one CSV file.

    Blank lines and rows without a full-time score are skipped: the site
    sometimes ships trailing empties, and a fixture without a result is not a
    training example. Anything else malformed raises ``ParseError`` naming the
    line, because a silently dropped row is a silently biased sample.
    """
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    if reader.fieldnames is None:
        return []

    required = {"Div", "Date", "HomeTeam", "AwayTeam", "FTHG", "FTAG"}
    missing = required - set(reader.fieldnames)
    if missing:
        raise ParseError(f"file lacks required columns: {sorted(missing)}")

    rows: list[MatchRow] = []
    for number, row in enumerate(reader, start=2):
        if not row.get("Div") and not row.get("HomeTeam"):
            continue  # a blank trailing line
        if (row.get("FTHG") or "").strip() == "" or (row.get("FTAG") or "").strip() == "":
            continue  # scheduled but not played when the file was cut

        try:
            home_goals = int(row["FTHG"])
            away_goals = int(row["FTAG"])
            result = "H" if home_goals > away_goals else "A" if home_goals < away_goals else "D"
            declared = (row.get("FTR") or "").strip()
            if declared and declared != result:
                raise ValueError(
                    f"FTR {declared!r} disagrees with the score {home_goals}-{away_goals}"
                )

            odds_home, odds_draw, odds_away, odds_source = _odds(row)
            rows.append(
                MatchRow(
                    division=row["Div"].strip(),
                    match_date=parse_date(row["Date"]),
                    home_team=row["HomeTeam"].strip(),
                    away_team=row["AwayTeam"].strip(),
                    home_goals=home_goals,
                    away_goals=away_goals,
                    result=result,
                    ht_home_goals=_int(row.get("HTHG")),
                    ht_away_goals=_int(row.get("HTAG")),
                    home_shots=_int(row.get("HS")),
                    away_shots=_int(row.get("AS")),
                    home_shots_on_target=_int(row.get("HST")),
                    away_shots_on_target=_int(row.get("AST")),
                    odds_home=odds_home,
                    odds_draw=odds_draw,
                    odds_away=odds_away,
                    odds_source=odds_source,
                )
            )
        except (KeyError, ValueError) as error:
            raise ParseError(f"line {number}: {error}") from error

    return rows
