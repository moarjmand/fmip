"""Coach quality as an input (T-1658, D-310): his sides against expectation, his time in post.

**The coach** of a side is the person named on its club's latest stored line-up
strictly before the match's day (``fixture_participant.coach_id``, D-147): a
person id, never a name (rule 1). No line-up before the day, a latest line-up
that names no coach (a gap), or two line-ups of the club on that day: the side
is not read, never a default. A coach appointed since that line-up is read from
his second match.

**The expectation** is a simple strength baseline (``baseline``), because the
harness gives no pre-match expectation of a coach's past matches (its fitted
model has absorbed them and holds one division's clubs). One goal rating runs
over every stored result in date order: a log attack and a log leakiness per
club, both 0 at its first stored match; expected goals ``HOME_GOALS * exp(a_home
+ d_away)`` and ``AWAY_GOALS * exp(a_away + d_home)`` from the ratings as they
stood before the day; after the day each moves by ``RATE * (goals - expected)``.
A result is **scored** only when both clubs have ``WARM`` earlier stored matches.

**The record** of a coach before a day is his scored matches strictly before it
(a stored match is his when his club's line-up names him that UTC day), in every
club and competition the store holds: the sums of (goals scored - expected) and
(goals conceded - expected), each divided by ``n + PSEUDO_COUNT``. One or two
results move it little; a coach with no scored match reads 0 and 0, a
tenure-only reading.

**Tenure** is his matches in post at the club up to that latest line-up (as
``training.coaches.coach_contexts`` counts them), read as ``log(1 + min(t,
TENURE_CAP)) / log(1 + TENURE_CAP)``. It is unknown, and the side not read, when
his spell began before the club's stored line-ups and ``t < TENURE_CAP``.

**The term.** The home side's vector is ``[scoring(home), conceding(away),
tenure(home), tenure(away)]``, the away side's the same with the sides swapped:
four coefficients fitted by ``FeatureInput``, read only when fitted on enough
matches (``_lab.MinimumFit``). Every constant here is D-310's, fixed before any
run.

Results are the store's ``training.match`` rows, every division, clubs keyed
through ``training.team_alias`` as our own Elo keys them, so a football-data
club reaches its line-ups by its team id. Line-ups are read from our records'
``public`` (``_lab.records_url``).
"""

from __future__ import annotations

import math
from bisect import bisect_left
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date
from itertools import accumulate, groupby

import psycopg

from ..model.dixon_coles import MatchObservation
from ..model.own_elo import EloMatch
from ..training.coaches import LineUp, coach_contexts, read_lineups
from ..training.own_elo import read_matches
from . import FeatureInput, Features, InputContext, Scheduled
from ._lab import MinimumFit, records_url

#: A coach's record is shrunk toward zero as if it held this many matches of 0 more.
PSEUDO_COUNT = 40.0
#: Tenure stops growing here; a club's first stored coach is known only past it.
TENURE_CAP = 38
#: The baseline: goals of an average home and away side, and how far a result moves a rating.
HOME_GOALS = 1.5
AWAY_GOALS = 1.2
RATE = 0.02
#: Earlier stored matches each club needs before a result is scored.
WARM = 30
COEFFICIENTS = 4


@dataclass(frozen=True)
class Scored:
    """A stored result with the baseline's expected goals before its day."""

    date: date
    home: str
    away: str
    home_goals: int
    away_goals: int
    expected_home: float
    expected_away: float


def baseline(results: Iterable[EloMatch]) -> list[Scored]:
    """Every stored result whose clubs were both warm, with the expectation before its day."""
    attack: dict[str, float] = {}
    leak: dict[str, float] = {}
    seen: Counter[str] = Counter()
    out: list[Scored] = []
    for _, on_day in groupby(sorted(results, key=lambda m: m.date), key=lambda m: m.date):
        day = [
            (
                m,
                HOME_GOALS * math.exp(attack.get(m.home, 0.0) + leak.get(m.away, 0.0)),
                AWAY_GOALS * math.exp(attack.get(m.away, 0.0) + leak.get(m.home, 0.0)),
            )
            for m in on_day
        ]
        for m, eh, ea in day:
            if seen[m.home] >= WARM and seen[m.away] >= WARM:
                out.append(Scored(m.date, m.home, m.away, m.home_goals, m.away_goals, eh, ea))
        for m, eh, ea in day:
            home_move, away_move = RATE * (m.home_goals - eh), RATE * (m.away_goals - ea)
            attack[m.home] = attack.get(m.home, 0.0) + home_move
            leak[m.away] = leak.get(m.away, 0.0) + home_move
            attack[m.away] = attack.get(m.away, 0.0) + away_move
            leak[m.home] = leak.get(m.home, 0.0) + away_move
            seen[m.home] += 1
            seen[m.away] += 1
    return out


@dataclass(frozen=True)
class Spell:
    """A club's coach as one of its line-ups names him."""

    coach_id: str
    #: His matches in post at the club up to and including this line-up.
    matches: int
    #: Whether his spell began with a change the stored line-ups show.
    after_change: bool


class Coaching:
    """Who each club's line-ups name, by team id and UTC day."""

    def __init__(self, lineups: Iterable[LineUp]) -> None:
        lineups = list(lineups)
        day_of = {
            (lu.team_id, lu.fixture_id): lu.kickoff_at.astimezone(UTC).date() for lu in lineups
        }
        self._on: dict[tuple[str, date], str | None] = {}
        self._days: dict[str, list[date]] = {}
        self._spells: dict[str, list[Spell | None]] = {}
        # coach_contexts gives each club's line-ups in kick-off order.
        for c in coach_contexts(lineups):
            key = (c.team_id, day_of[(c.team_id, c.fixture_id)])
            if key in self._on:
                # Two line-ups of one club on one day: neither is told apart.
                self._on[key] = None
                self._spells[c.team_id][-1] = None
                continue
            spell = None
            if c.coach_id is not None and c.match_under_coach is not None:
                spell = Spell(c.coach_id, c.match_under_coach, c.after_change)
            self._on[key] = c.coach_id
            self._days.setdefault(c.team_id, []).append(key[1])
            self._spells.setdefault(c.team_id, []).append(spell)

    def coach_on(self, team: str, day: date) -> str | None:
        """The coach the club's line-up names on that day, if one line-up does."""
        return self._on.get((team, day))

    def latest_before(self, team: str, day: date) -> Spell | None:
        """The club's coach as its latest line-up strictly before ``day`` names him."""
        days = self._days.get(team)
        if not days:
            return None
        i = bisect_left(days, day) - 1
        return None if i < 0 else self._spells[team][i]


class Records:
    """Each coach's scored matches, oldest first, with running sums of what they left."""

    def __init__(self, scored: Iterable[Scored], coaching: Coaching) -> None:
        rows: dict[str, list[tuple[date, float, float]]] = {}
        for s in scored:
            sides = (
                (s.home, s.home_goals - s.expected_home, s.away_goals - s.expected_away),
                (s.away, s.away_goals - s.expected_away, s.home_goals - s.expected_home),
            )
            for club, scoring, conceding in sides:
                coach = coaching.coach_on(club, s.date)
                if coach is not None:
                    rows.setdefault(coach, []).append((s.date, scoring, conceding))
        self._dates: dict[str, list[date]] = {}
        self._scoring: dict[str, list[float]] = {}
        self._conceding: dict[str, list[float]] = {}
        for coach, matches in rows.items():
            matches.sort(key=lambda r: r[0])
            self._dates[coach] = [r[0] for r in matches]
            self._scoring[coach] = [0.0, *accumulate(r[1] for r in matches)]
            self._conceding[coach] = [0.0, *accumulate(r[2] for r in matches)]

    @property
    def coaches(self) -> int:
        return len(self._dates)

    def before(self, coach: str, day: date) -> tuple[int, float, float]:
        """(matches, sum scored - expected, sum conceded - expected) strictly before ``day``."""
        dates = self._dates.get(coach)
        if dates is None:
            return 0, 0.0, 0.0
        n = bisect_left(dates, day)
        return n, self._scoring[coach][n], self._conceding[coach][n]


def shrunk(total: float, matches: int) -> float:
    """A mean of ``matches`` results shrunk toward zero by ``PSEUDO_COUNT``."""
    return total / (matches + PSEUDO_COUNT)


def tenure(matches: int) -> float:
    return math.log1p(min(matches, TENURE_CAP)) / math.log1p(TENURE_CAP)


@dataclass(frozen=True)
class Reading:
    """A side's coach as the input reads him before a match."""

    #: His sides' goals scored less expected, shrunk.
    scoring: float
    #: His sides' goals conceded less expected, shrunk (positive: they let in more).
    conceding: float
    tenure: float


class CoachQuality:
    def __init__(
        self,
        coaching: Coaching,
        records: Records,
        alias: Mapping[tuple[str, str], str],
        summary: str = "",
    ) -> None:
        self.coaching = coaching
        self.records = records
        self.alias = alias
        self.summary = summary

    @classmethod
    def of(
        cls,
        results: Iterable[EloMatch],
        lineups: Sequence[LineUp],
        alias: Mapping[tuple[str, str], str],
    ) -> CoachQuality:
        coaching = Coaching(lineups)
        scored = baseline(results)
        records = Records(scored, coaching)
        named = Counter(lu.season for lu in lineups if lu.coach_id is not None)
        by_season = ", ".join(f"{s} {n}" for s, n in sorted(named.items())) or "none"
        summary = (
            f"{len(lineups)} stored line-ups, naming a coach by season: {by_season}; "
            f"{len(scored)} stored results scored by the baseline; "
            f"{records.coaches} coaches with a scored match."
        )
        return cls(coaching, records, alias, summary)

    def reading(self, division: str, club: str, day: date) -> Reading | None:
        """The side's coach before ``day``, or None when he cannot be told."""
        # In our records the training name is the team id itself.
        spell = self.coaching.latest_before(self.alias.get((division, club), club), day)
        if spell is None:
            return None  # no line-up before the day, a gap, or two line-ups that day
        if not spell.after_change and spell.matches < TENURE_CAP:
            return None  # his spell may be new or years old: tenure is never guessed
        n, scoring, conceding = self.records.before(spell.coach_id, day)
        return Reading(shrunk(scoring, n), shrunk(conceding, n), tenure(spell.matches))


def features_for(quality: CoachQuality) -> Features:
    def features(
        division: str, match: Scheduled, known: Sequence[MatchObservation]
    ) -> tuple[Sequence[float], Sequence[float]] | None:
        home = quality.reading(division, match.home, match.date)
        away = quality.reading(division, match.away, match.date)
        if home is None or away is None:
            return None
        return (
            (home.scoring, away.conceding, home.tenure, away.tenure),
            (away.scoring, home.conceding, away.tenure, home.tenure),
        )

    return features


def coach_quality_input(quality: CoachQuality) -> MinimumFit:
    return MinimumFit(
        FeatureInput(
            "coach_quality",
            f"Coach quality (T-1658, D-310): each side's coach from its club's latest line-up "
            f"before the day; his sides' goals scored and conceded less a goal-rating baseline "
            f"over every spell, shrunk by {PSEUDO_COUNT:g} matches, and his tenure "
            f"(log, capped at {TENURE_CAP}); own scoring, opponent's conceding and both tenures "
            f"fitted by FeatureInput. {quality.summary}",
            features_for(quality),
        ),
        COEFFICIENTS,
    )


ALIAS_SQL = "SELECT division, training_name, team_id::text FROM training.team_alias"


def build(context: InputContext) -> MinimumFit:
    if context.database_url is None:
        raise LookupError("coach_quality reads stored results and line-ups: DATABASE_URL is needed")
    with psycopg.connect(context.database_url) as conn:
        results = read_matches(conn, context.until)
        with conn.cursor() as cur:
            cur.execute(ALIAS_SQL)
            alias = {(str(d), str(n)): str(t) for d, n, t in cur.fetchall()}
    with psycopg.connect(records_url(context.database_url)) as conn:
        lineups = [
            lu for lu in read_lineups(conn) if lu.kickoff_at.astimezone(UTC).date() <= context.until
        ]
    return coach_quality_input(CoachQuality.of(results, lineups, alias))
