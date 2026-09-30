"""Travel by its proxy (T-1166, D-170): a match whose two clubs' countries differ.

We hold no ground's place (N-1: ``venue.latitude``/``longitude`` are empty,
and placing grounds from an open dataset is the maintainer's to decide), so
distance cannot be measured. What can be read without a new source is whether
the away side crossed a border: the two clubs' countries differ.

A club's **country** is read from the catalogue, by id, never by name (rule 1):

- the club's own ``team.country_id`` where the catalogue states one;
- otherwise the country of the domestic competitions it plays in
  (``competition.country_id`` of a ``scope = 'domestic'`` competition, over the
  club's stored fixtures), when they name exactly one country most often. A
  tie between countries gives none.

A club with no country (one whose domestic league we do not carry, and whose
row states none) is never guessed: the match is not read (rule 3).

**Read only on cross-border matches.** A match whose clubs share a country,
or where either country is unknown, gives no value: the candidate's forecast
stands and the match is outside the input's sample (D-139). On a cross-border
match the term is two fitted coefficients, one on the home side's log
expected goals and one on the away side's, so the fit can say both "home
advantage is larger when the visitor travelled" and "a visitor abroad scores
less" without assuming they are the same number.

A club's country is where it plays, not how it played: the fixtures read in
``build`` are its schedule (which competitions it is entered in), never a
score, so nothing after a match's day leaks into its forecast.
football-data.co.uk divisions are domestic, and their clubs are reached only
through ``training.team_alias``; their matches are read only where the
catalogue itself states a club's country apart from its league's (a club
playing in a neighbouring country's league).
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass

import psycopg

from ..model.dixon_coles import MatchObservation
from . import FeatureInput, Features, InputContext, Scheduled

#: Home side's feature, away side's feature: one coefficient each.
HOME = (1.0, 0.0)
AWAY = (0.0, 1.0)


def club_countries(
    declared: Mapping[str, str],
    played: Iterable[tuple[str, str, int]],
) -> dict[str, str]:
    """Each club's country: its own where declared, else its domestic leagues' commonest.

    ``declared`` is team id -> ``team.country_id``; ``played`` is (team id,
    domestic competition's country id, number of stored fixtures).
    """
    counts: dict[str, Counter[str]] = {}
    for team, country, n in played:
        counts.setdefault(team, Counter())[country] += n
    out: dict[str, str] = {}
    for team, counter in counts.items():
        ranked = counter.most_common(2)
        if len(ranked) == 1 or ranked[0][1] > ranked[1][1]:
            out[team] = ranked[0][0]
    out.update(declared)
    return out


@dataclass(frozen=True)
class Countries:
    """Each club's country by team id, and the bridge from a division's training names."""

    of: Mapping[str, str]
    #: (division, training name) -> team id. In our records the name is the id itself.
    alias: Mapping[tuple[str, str], str]

    def country(self, division: str, club: str) -> str | None:
        return self.of.get(self.alias.get((division, club), club))

    def cross_border(self, division: str, match: Scheduled) -> bool | None:
        """Whether the clubs' countries differ; None when either is unknown."""
        home, away = self.country(division, match.home), self.country(division, match.away)
        if home is None or away is None:
            return None
        return home != away


def features_for(countries: Countries) -> Features:
    def features(
        division: str, match: Scheduled, known: Sequence[MatchObservation]
    ) -> tuple[Sequence[float], Sequence[float]] | None:
        if not countries.cross_border(division, match):
            return None  # same country, or not known: the candidate's forecast stands
        return HOME, AWAY

    return features


def cross_border_input(countries: Countries) -> FeatureInput:
    return FeatureInput(
        "cross_border",
        "Travel by its proxy (T-1166, D-170): on a match whose two clubs' countries differ "
        "(from the catalogue by id), one fitted coefficient on each side's log expected goals.",
        features_for(countries),
    )


DECLARED_SQL = "SELECT id::text, country_id::text FROM team WHERE country_id IS NOT NULL"

PLAYED_SQL = """
SELECT fp.team_id::text, c.country_id::text, count(*)
  FROM fixture_participant fp
  JOIN fixture f ON f.id = fp.fixture_id
  JOIN season s ON s.id = f.season_id
  JOIN competition c ON c.id = s.competition_id
 WHERE c.scope = 'domestic' AND c.country_id IS NOT NULL AND f.status <> 'cancelled'
 GROUP BY 1, 2
"""

ALIAS_SQL = "SELECT division, training_name, team_id::text FROM training.team_alias"


def read_countries(conn: psycopg.Connection[tuple[object, ...]]) -> Countries:
    with conn.cursor() as cur:
        cur.execute(DECLARED_SQL)
        declared = {str(t): str(c) for t, c in cur.fetchall()}
        cur.execute(PLAYED_SQL)
        played = [(str(t), str(c), int(str(n))) for t, c, n in cur.fetchall()]
        cur.execute(ALIAS_SQL)
        alias = {(str(d), str(n)): str(t) for d, n, t in cur.fetchall()}
    return Countries(club_countries(declared, played), alias)


def build(context: InputContext) -> FeatureInput:
    if context.database_url is None:
        raise ValueError("cross_border reads the clubs' countries from the catalogue")
    with psycopg.connect(context.database_url) as conn:
        return cross_border_input(read_countries(conn))
