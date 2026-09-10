"""Parsing Club Elo CSV into rows for ``training.elo``.

The API answers a date with every club's current rating, or a club name with
its full history. Both use the same columns: ``Rank,Club,Country,Level,Elo,
From,To``. ``Rank`` is ``None`` for clubs outside the top divisions.
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation


@dataclass(frozen=True)
class EloRow:
    club: str
    country: str
    level: int
    elo: Decimal
    rank: int | None
    from_date: date
    to_date: date


class ParseError(ValueError):
    """A row the file should not contain. Carries the line number."""


REQUIRED = {"Rank", "Club", "Country", "Level", "Elo", "From", "To"}


def parse_elo(text: str) -> list[EloRow]:
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    if reader.fieldnames is None:
        return []

    missing = REQUIRED - set(reader.fieldnames)
    if missing:
        raise ParseError(f"file lacks required columns: {sorted(missing)}")

    rows: list[EloRow] = []
    for number, row in enumerate(reader, start=2):
        if not row.get("Club"):
            continue
        try:
            rank_raw = (row.get("Rank") or "").strip()
            rows.append(
                EloRow(
                    club=row["Club"].strip(),
                    country=row["Country"].strip(),
                    level=int(row["Level"]),
                    elo=Decimal(row["Elo"].strip()),
                    rank=None if rank_raw in ("", "None") else int(rank_raw),
                    from_date=date.fromisoformat(row["From"].strip()),
                    to_date=date.fromisoformat(row["To"].strip()),
                )
            )
        except (KeyError, ValueError, InvalidOperation) as error:
            raise ParseError(f"line {number}: {error}") from error

    return rows
