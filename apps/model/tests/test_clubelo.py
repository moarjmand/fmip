from datetime import date
from decimal import Decimal

import pytest

from fmip_model.training.clubelo import ParseError, parse_elo

# Synthetic rows in the API's documented column layout. The values are not
# real ratings (the API was answering 502 when this was written) and are only
# here to exercise the parser; the format is what matters.
SYNTHETIC = (
    "Rank,Club,Country,Level,Elo,From,To\n"
    "1,Example FC,ENG,1,2001.5,2025-08-01,2025-08-02\n"
    "None,Example Town,ENG,2,1500.25,2025-08-01,2025-08-02\n"
)


def test_parses_rank_and_unranked_rows() -> None:
    rows = parse_elo(SYNTHETIC)

    assert len(rows) == 2
    assert rows[0].club == "Example FC"
    assert rows[0].rank == 1
    assert rows[0].elo == Decimal("2001.5")
    assert (rows[0].from_date, rows[0].to_date) == (date(2025, 8, 1), date(2025, 8, 2))
    assert rows[1].rank is None
    assert rows[1].level == 2


def test_rejects_a_malformed_row_by_line() -> None:
    with pytest.raises(ParseError, match="line 3"):
        parse_elo(
            "Rank,Club,Country,Level,Elo,From,To\n1,A,ENG,1,2000,2025-08-01,2025-08-02\n1,B,ENG,x,2000,2025-08-01,2025-08-02\n"
        )


def test_rejects_missing_columns() -> None:
    with pytest.raises(ParseError, match="required columns"):
        parse_elo("Club,Elo\nA,2000\n")
