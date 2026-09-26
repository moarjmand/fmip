"""The training store's sources and the terms each is used under.

The two free historical sources (D-016), and our own records of the licensed
feed (D-083), read from our tables rather than from the provider.

Every load records the source, the exact URL, the licence page and this note,
so "where did this row come from and were we allowed to have it" is answerable
from the training store alone. The notes below describe the terms as read on
2026-09-10; they are pointers, not legal advice, and docs/05-data-providers.md
says the terms must be re-verified before any redistribution.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

SourceId = Literal["football_data_co_uk", "clubelo", "our_records"]


@dataclass(frozen=True)
class Source:
    id: SourceId
    name: str
    licence_url: str
    licence_note: str


FOOTBALL_DATA = Source(
    id="football_data_co_uk",
    name="football-data.co.uk",
    licence_url="https://www.football-data.co.uk/notes.txt",
    licence_note=(
        "Free CSV downloads of results and bookmaker odds. Used for offline training "
        "and calibration only; not redistributed. Verify terms before any redistribution "
        "(docs/05-data-providers.md)."
    ),
)

CLUB_ELO = Source(
    id="clubelo",
    name="Club Elo",
    licence_url="http://clubelo.com/",
    licence_note=(
        "Free, keyless CSV API of daily club Elo ratings. Attribution required. Used as "
        "a long-term strength prior for offline training only."
    ),
)

OUR_RECORDS = Source(
    id="our_records",
    name="Our own records of API-Football",
    licence_url="https://api-sports.io/terms",
    licence_note=(
        "Finished matches as the product recorded them from the licensed feed (D-076), "
        "copied from our own tables. The feed's terms forbid reselling its data and say "
        "nothing about models; the maintainer allowed training on it (D-083). Used to "
        "fit the model only; not redistributed."
    ),
)

SOURCES: dict[SourceId, Source] = {
    FOOTBALL_DATA.id: FOOTBALL_DATA,
    CLUB_ELO.id: CLUB_ELO,
    OUR_RECORDS.id: OUR_RECORDS,
}


def football_data_url(season: str, division: str) -> str:
    """The CSV for one division-season, e.g. ``("2425", "E0")``.

    ``season`` is the site's four-digit code (start and end year, two digits
    each); ``division`` its code (E0 Premier League, E1 Championship, SP1 La
    Liga, D1 Bundesliga, I1 Serie A, F1 Ligue 1, ...).
    """
    if len(season) != 4 or not season.isdigit():
        raise ValueError(f"season must be a four-digit code such as 2425, received {season!r}")
    if not division.isalnum() or not 2 <= len(division) <= 3:
        raise ValueError(f"division must be a code such as E0 or SP1, received {division!r}")
    return f"https://www.football-data.co.uk/mmz4281/{season}/{division}.csv"


def season_label(season: str) -> str:
    """``"2425"`` → ``"2024/25"``. Matches the label convention in the catalog."""
    start, end = int(season[:2]), int(season[2:])
    century = 2000 if start < 90 else 1900
    return f"{century + start}/{end:02d}"


def records_url(division: str) -> str:
    """Where a load of our own records reads from: a description, not a download."""
    if not division.isalnum() or not 2 <= len(division) <= 3:
        raise ValueError(f"division must be a code such as IR1, received {division!r}")
    return f"records:public.fixture?division={division}"


def clubelo_snapshot_url(day: str) -> str:
    """Every club's rating as of ``day`` (ISO date), one CSV row per club."""
    if len(day) != 10 or day[4] != "-" or day[7] != "-":
        raise ValueError(f"day must be an ISO date such as 2025-08-01, received {day!r}")
    return f"http://api.clubelo.com/{day}"
