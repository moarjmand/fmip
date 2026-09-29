"""The committed league-zone list (T-1167, D-171), as the model reads it.

The list is ``packages/contracts/zones/league-zones.json`` -- the file the API
reads for the competition page -- keyed by training division and season
label. The model's image carries a copy at ``/app/league-zones.json`` (its
working directory; see ``apps/model/Dockerfile``); a checkout reads the
repository's file. Nothing here reads the feed.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

FILE = "league-zones.json"
#: A checkout: apps/model/fmip_model/inputs/_zones.py -> the repository root.
REPOSITORY = Path(__file__).resolve().parents[4] / "packages" / "contracts" / "zones" / FILE


@dataclass(frozen=True)
class SeasonZones:
    division: str
    season: str
    teams: int
    #: (kind, first place, last place), both ends included.
    zones: tuple[tuple[str, int, int], ...]
    complete: bool

    def bands(self) -> tuple[int, ...]:
        """A band number per place (index 0 is place 1).

        The champion's place is a band of its own; each listed zone is one;
        each run of places between zones is one. A side whose best and worst
        possible finish are in the same band has nothing left to play for
        in the table.
        """

        def key(place: int) -> object:
            if place == 1:
                return "champion"
            for i, (_, first, last) in enumerate(self.zones):
                if first <= place <= last:
                    return i
            return None

        out: list[int] = []
        previous: object = object()
        band = -1
        for place in range(1, self.teams + 1):
            k = key(place)
            if k != previous:
                band += 1
                previous = k
            out.append(band)
        return tuple(out)


def parse(raw: object) -> dict[tuple[str, str], SeasonZones]:
    if not isinstance(raw, list):
        raise ValueError("the league-zone list is an array of entries")
    out: dict[tuple[str, str], SeasonZones] = {}
    for e in raw:
        teams = int(e["teams"])
        zones = tuple((str(z["kind"]), int(z["from"]), int(z["to"])) for z in e["zones"])
        for kind, first, last in zones:
            if not 1 <= first <= last <= teams:
                raise ValueError(f"{e['division']} {e['season']}: {kind} is not inside the table")
        key = (str(e["division"]), str(e["season"]))
        if key in out:
            raise ValueError(f"{key} is listed twice")
        out[key] = SeasonZones(key[0], key[1], teams, zones, bool(e["complete"]))
    return out


def read(path: Path | None = None) -> Mapping[tuple[str, str], SeasonZones]:
    """The list from ``path``, else the image's copy, else the repository's file."""
    candidates = [path] if path is not None else [Path.cwd() / FILE, REPOSITORY]
    for candidate in candidates:
        if candidate is not None and candidate.is_file():
            return parse(json.loads(candidate.read_text(encoding="utf-8")))
    raise FileNotFoundError(f"no {FILE} at {', '.join(str(c) for c in candidates)}")
