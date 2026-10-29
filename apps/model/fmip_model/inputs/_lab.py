"""What T-1658 and T-1659's inputs share (D-310, D-311): the records' database, a minimum fit.

**The records' database.** The lab store (``fmip_lab``, D-303) is a copy of
the ``training`` schema alone: our records' fixtures and line-ups (``public``)
are not in it. An input that reads them reads them from
``MODEL_RECORDS_DATABASE_URL`` when it is set -- the production database, its
``public`` only, read only -- and from ``DATABASE_URL`` otherwise.

**A minimum fit.** ``FeatureInput`` fits its coefficients on whatever history
has the feature; a handful of matches can push them to the bound (``±2``) and
the forecast with them. ``MinimumFit`` leaves a term fitted on fewer than
``MATCHES_PER_COEFFICIENT`` matches per coefficient unread: the candidate's
forecast stands and the match is outside the sample (D-139).
"""

from __future__ import annotations

import os
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date

from ..model.dixon_coles import FittedModel, MatchObservation
from . import FeatureInput, LogShift, Scheduled, Term

RECORDS_URL = "MODEL_RECORDS_DATABASE_URL"
MATCHES_PER_COEFFICIENT = 25


def records_url(database_url: str) -> str:
    """Where our records' ``public`` is read: ``MODEL_RECORDS_DATABASE_URL``, else the store's."""
    return os.environ.get(RECORDS_URL) or database_url


@dataclass(frozen=True)
class Unread:
    """A term fitted on too few matches: read on no match."""

    samples: int

    def shift(self, match: Scheduled, known: Sequence[MatchObservation]) -> LogShift | None:
        return None


class MinimumFit:
    """A ``FeatureInput`` whose term is read only when fitted on enough matches."""

    def __init__(self, features: FeatureInput, coefficients: int) -> None:
        self.features = features
        self.minimum = coefficients * MATCHES_PER_COEFFICIENT
        self.name = features.name
        self.description = (
            f"{features.description} A term fitted on fewer than {self.minimum} matches "
            f"({MATCHES_PER_COEFFICIENT} per coefficient) is not read."
        )

    def fit(
        self,
        division: str,
        history: Sequence[MatchObservation],
        fit_date: date,
        model: FittedModel,
    ) -> Term:
        term = self.features.fit(division, history, fit_date, model)
        return term if term.samples >= self.minimum else Unread(term.samples)
