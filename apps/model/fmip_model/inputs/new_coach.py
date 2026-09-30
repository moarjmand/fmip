"""A new coach as a model input (T-1131, D-147): a decaying term over his first matches.

The coach of each side is the person the match's own line-up names
(``fixture_participant.coach_id``, T-1130): a person id, never a name
(rule 1). The line-up is announced before kick-off, as the XI the line-up
term reads is (D-086), so serving knows it when it knows the line-up. His
match number is counted as ``training.coaches.coach_contexts`` counts it:
the spell's first named line-up is match 1, over every competition we carry,
and a line-up naming no coach counts for no one.

A side's feature is

- ``0.5 ** ((n - 1) / HALF_LIFE)`` for the ``n``-th match of a coach who
  arrived by a change we saw (``after_change``), while ``n <= WINDOW``;
- ``0`` once his spell is past ``WINDOW`` matches, whoever he is (a club's
  first stored coach included: past ``WINDOW`` matches he is not new, however
  he arrived).

A side is **not read** when its line-up names no coach (a gap, D-119), when
the match has no stored line-up for it, or when its coach is the club's first
stored one and has fewer than ``WINDOW + 1`` stored matches (his spell may be
new or years old; it is never guessed). A match is read only when both sides
are read and at least one of them is under a new coach: elsewhere the term is
zero, and the candidate's forecast stands (D-139).

The vectors are ``[own, opponent's]``, fitted by ``FeatureInput``: one
coefficient for a side's own new coach, one for its opponent's, so the fit can
say both "a new coach's side scores more" and "concedes less" without tying
them. ``HALF_LIFE`` and ``WINDOW`` are fixed here before any run, not tuned.

A caretaker is a change like any other (D-147): his arrival and the next
appointment each start a new spell. A change seen across unnamed line-ups is
counted from the first line-up that names the new coach, so his true match
number may be higher by the gaps; with nearly every stored match named, that
is rare. Only our records' divisions name clubs by team id and carry
line-ups; a football-data division's match is never read (its names reach no
line-up).
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date

import psycopg

from ..model.dixon_coles import MatchObservation
from ..training.coaches import LineUp, coach_changes, coach_contexts, read_lineups
from . import FeatureInput, Features, InputContext, Scheduled

#: The feature halves every HALF_LIFE matches under the new coach ...
HALF_LIFE = 3.0
#: ... and is zero after his WINDOW-th match (0.125 at match 10).
WINDOW = 10


def decay(match_under_coach: int) -> float:
    if match_under_coach > WINDOW:
        return 0.0
    return float(0.5 ** ((match_under_coach - 1) / HALF_LIFE))


@dataclass(frozen=True)
class SideState:
    """A side's coach at a match: his match number, and whether his spell began with a change."""

    match_under_coach: int
    after_change: bool

    def feature(self) -> float | None:
        """The side's feature, or None when whether the coach is new cannot be told."""
        if self.after_change:
            return decay(self.match_under_coach)
        if self.match_under_coach > WINDOW:
            return 0.0
        return None


class Coaches:
    """Each club's coach state at each of its stored line-ups, by (team id, day)."""

    def __init__(self, lineups: Iterable[LineUp]) -> None:
        lineups = list(lineups)
        day_of = {
            (lu.team_id, lu.fixture_id): lu.kickoff_at.astimezone(UTC).date() for lu in lineups
        }
        self.states: dict[tuple[str, date], SideState | None] = {}
        for c in coach_contexts(lineups):
            key = (c.team_id, day_of[(c.team_id, c.fixture_id)])
            if key in self.states:
                # Two finished matches of one club on one day: neither is told apart.
                self.states[key] = None
                continue
            self.states[key] = (
                None
                if c.match_under_coach is None
                else SideState(c.match_under_coach, c.after_change)
            )
        self.changes_by_season: Mapping[str, int] = dict(
            sorted(Counter(ch.season for ch in coach_changes(lineups)).items())
        )

    def feature(self, club: str, day: date) -> float | None:
        state = self.states.get((club, day))
        return None if state is None else state.feature()


def features_for(coaches: Coaches) -> Features:
    def features(
        division: str, match: Scheduled, known: Sequence[MatchObservation]
    ) -> tuple[Sequence[float], Sequence[float]] | None:
        home = coaches.feature(match.home, match.date)
        away = coaches.feature(match.away, match.date)
        if home is None or away is None:
            return None  # a side's coach is unknown, or may be new: never guessed
        if home == 0.0 and away == 0.0:
            return None  # neither coach is new: the term is zero and the forecast stands
        return (home, away), (away, home)

    return features


def new_coach_input(coaches: Coaches) -> FeatureInput:
    seasons = ", ".join(f"{s} {n}" for s, n in coaches.changes_by_season.items()) or "none"
    return FeatureInput(
        "new_coach",
        f"A new coach (T-1131, D-147): each side's line-up coach by person id; over the first "
        f"{WINDOW} matches of a coach who arrived by a change seen in stored line-ups, "
        f"0.5^((n-1)/{HALF_LIFE:g}), own and opponent's, fitted by FeatureInput. Read only where "
        f"both sides' coaches are known and one is new. Changes in the stored line-ups by "
        f"season: {seasons}.",
        features_for(coaches),
    )


def build(context: InputContext) -> FeatureInput:
    if context.database_url is None:
        raise LookupError("the new_coach input reads the stored line-ups: DATABASE_URL is needed")
    with psycopg.connect(context.database_url) as conn:
        lineups = [
            lu for lu in read_lineups(conn) if lu.kickoff_at.astimezone(UTC).date() <= context.until
        ]
    return new_coach_input(Coaches(lineups))
