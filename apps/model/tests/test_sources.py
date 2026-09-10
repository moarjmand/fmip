import pytest

from fmip_model.training.sources import (
    CLUB_ELO,
    FOOTBALL_DATA,
    SOURCES,
    clubelo_snapshot_url,
    football_data_url,
    season_label,
)


def test_every_source_documents_its_terms() -> None:
    for source in SOURCES.values():
        assert source.licence_url.startswith("http")
        assert len(source.licence_note) > 40


def test_football_data_url_and_season_label() -> None:
    assert football_data_url("2425", "E0") == "https://www.football-data.co.uk/mmz4281/2425/E0.csv"
    assert season_label("2425") == "2024/25"
    assert season_label("9900") == "1999/00"
    assert FOOTBALL_DATA.id == "football_data_co_uk"


def test_football_data_url_rejects_junk() -> None:
    with pytest.raises(ValueError):
        football_data_url("2024-25", "E0")
    with pytest.raises(ValueError):
        football_data_url("2425", "../etc")


def test_clubelo_url() -> None:
    assert clubelo_snapshot_url("2025-08-01") == "http://api.clubelo.com/2025-08-01"
    assert CLUB_ELO.id == "clubelo"
    with pytest.raises(ValueError):
        clubelo_snapshot_url("01/08/2025")
