"""The null input (T-1101): a coinflip feature with no effect, the harness's own control.

Each side gets +1 or -1 from a hash of the match's day and sides, so it is
the same every run and carries nothing about the result. Run it to see the
harness refuse an input that adds nothing: its verdict must be ``failed``.
"""

from __future__ import annotations

import hashlib
from collections.abc import Sequence

from ..model.dixon_coles import MatchObservation
from . import FeatureInput, InputContext, Scheduled


def coin(*parts: str) -> float:
    return 1.0 if hashlib.sha256("|".join(parts).encode()).digest()[0] % 2 else -1.0


def features(
    division: str, match: Scheduled, known: Sequence[MatchObservation]
) -> tuple[Sequence[float], Sequence[float]]:
    day = match.date.isoformat()
    return [coin(division, day, match.home, "home")], [coin(division, day, match.away, "away")]


def build(context: InputContext) -> FeatureInput:
    return FeatureInput(
        "null", "A coinflip per side with no effect: the harness's control.", features
    )
