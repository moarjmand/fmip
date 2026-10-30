"""The cross-league fit's candidate options (T-1654, D-309).

Off by default, the fit is the one the site publishes: the published version
and candidate 0.7.0 give the very probabilities they gave before T-1654 (the
numbers below were written by the code before it). On, each option does what
D-309 says on a synthetic world of two leagues: the Elo prior separates two
leagues no match between them separates, and tames a club seen four times;
the home advantage per competition group recovers a group's own; and the
backtest compares variants on the same matches.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import numpy as np
import pytest
from scipy.optimize import check_grad

from fmip_model.backtest.cross_league import (
    ELO_WEIGHT_GRID,
    HOLDOUT_FROM,
    HOME_RIDGE_GRID,
    XI_SWEEP,
    GroupScore,
    Tail,
    Variant,
    VariantScore,
    chosen,
    compare_variants,
    forecast_window,
    judge_variant,
    main,
    render_variants,
    tail_of,
    variants_body,
    variants_for,
)
from fmip_model.backtest.metrics import Forecast
from fmip_model.model.cross_league import (
    CROSS_LEAGUE,
    UEFA_MEMBERS,
    FixtureKey,
    fit_across,
    fit_joint,
    groups_for,
    home_group,
    is_uefa,
    joint_problem,
)
from fmip_model.model.dixon_coles import MatchObservation
from fmip_model.model.version import PUBLISHED, CrossLeague, load_candidate, load_candidates
from fmip_model.service.contract import ForecastRequest
from fmip_model.service.forecaster import Forecaster, TrainingSource

REPOSITORY = Path(__file__).resolve().parents[3]
FIT_DATE = date(2025, 6, 1)
NOW = datetime(2025, 6, 2, 12, 0, tzinfo=UTC)
KICKOFF = datetime(2025, 6, 3, 19, 0, tzinfo=UTC)


def club(i: int) -> str:
    return f"00000000-0000-4000-8000-{i:012d}"


ENGLAND = [club(i) for i in range(1, 9)]
SPAIN = [club(i) for i in range(11, 19)]
OUTSIDER = club(99)

Tagged = list[tuple[str, MatchObservation]]


def two_leagues(rng: np.random.Generator, *, home: float = 0.25) -> Tagged:
    """E0 and SP1, two seasons each: what a league's level is, its own matches cannot say."""
    out: Tagged = []
    for division, clubs in (("E0", ENGLAND), ("SP1", SPAIN)):
        own = {c: 0.35 - j * 0.1 for j, c in enumerate(clubs)}
        for season in (2023, 2024):
            day = date(season, 8, 10)
            for h in clubs:
                for a in clubs:
                    if h == a:
                        continue
                    # Within one league its own level cancels out of every match.
                    lam = np.exp(0.2 + own[h] / 2 - own[a] / 2 + home)
                    mu = np.exp(0.2 + own[a] / 2 - own[h] / 2)
                    m = MatchObservation(day, h, a, int(rng.poisson(lam)), int(rng.poisson(mu)))
                    out.append((division, m))
                    day += timedelta(days=3)
    return out


def between(
    rng: np.random.Generator,
    *,
    margin: float,
    home: float,
    start: date,
    every: int = 9,
    rounds: int = 1,
) -> list[MatchObservation]:
    """Matches between E0's and SP1's clubs; E0 ``margin`` stronger, ``home`` at home."""
    out: list[MatchObservation] = []
    day = start
    for _ in range(rounds):
        for i, e in enumerate(ENGLAND):
            for j, s in enumerate(SPAIN):
                if (i + j) % 2:
                    continue
                h, a = (e, s) if (i + j) % 4 == 0 else (s, e)
                edge = margin if h == e else -margin
                lam = np.exp(0.2 + edge / 2 + home)
                mu = np.exp(0.2 - edge / 2)
                out.append(MatchObservation(day, h, a, int(rng.poisson(lam)), int(rng.poisson(mu))))
                day += timedelta(days=every)
    return out


def golden_world() -> Tagged:
    """The world the golden numbers below were computed on, before T-1654."""
    rng = np.random.default_rng(1654)
    out = two_leagues(rng)
    out += [(CROSS_LEAGUE, m) for m in between(rng, margin=0.3, home=0.35, start=date(2023, 9, 20))]
    for k, e in enumerate(ENGLAND[:4]):
        out.append(
            (
                CROSS_LEAGUE,
                MatchObservation(date(2024, 8, 1) + timedelta(days=7 * k), e, OUTSIDER, 2, 0),
            )
        )
    return out


class World(TrainingSource):
    def __init__(
        self,
        tagged: Tagged,
        elo: Mapping[str, float] | None = None,
        labels: Mapping[FixtureKey, str] | None = None,
    ) -> None:
        self.tagged = tagged
        self.elo_ratings = dict(elo or {})
        self.labels = dict(labels or {})

    def aliases(self, division: str) -> Mapping[str, str]:
        return {}

    def matches(self, division: str, since: date, until: date) -> Sequence[MatchObservation]:
        return []

    def elo(self, day: date) -> Mapping[str, float]:
        return {}

    def every_match(self, since: date, until: date) -> Sequence[tuple[str, MatchObservation]]:
        return [(d, m) for d, m in self.tagged if since < m.date <= until]

    def own_elo_by_club(self, day: date) -> Mapping[str, float]:
        return self.elo_ratings

    def across_leagues_groups(self, since: date, until: date) -> Mapping[FixtureKey, str]:
        return {k: g for k, g in self.labels.items() if since <= k[0] <= until}


def ask(forecaster: Forecaster, home: str, away: str) -> object:
    return forecaster.forecast(
        ForecastRequest(
            fixture_id="00000000-0000-4000-8000-000000000999",
            home_team_id=home,
            away_team_id=away,
            division=CROSS_LEAGUE,
            kickoff_at=KICKOFF,
        )
    )


# --- off by default: the published version and 0.7.0 as before ---------------

PAIRS = [(ENGLAND[0], SPAIN[0]), (SPAIN[2], ENGLAND[5]), (ENGLAND[3], OUTSIDER)]
#: Written by the code before T-1654 (the same world, the same requests).
GOLDEN = [
    ((0.4931, 0.2844, 0.2225), (1.475, 0.911)),
    ((0.2217, 0.2408, 0.5375), (1.157, 1.895)),
    ((0.8284, 0.1669, 0.0047), (1.826, 0.033)),
]
GOLDEN_RAW = [
    (0.49306213871615756, 0.28444561459486994, 0.22249224668897258),
    (0.22174543529159904, 0.24083718805646878, 0.5374173766519322),
    (0.8283999265859605, 0.16693688225782333, 0.004663191156216187),
]


def test_the_published_version_and_the_candidate_name_neither_option() -> None:
    for version in (PUBLISHED, load_candidates()["dixon-coles-elo-0.7.0"]):
        assert version.cross_league is not None
        assert version.cross_league.elo_weight == 0
        assert version.cross_league.home_by_competition is None
        # What the files say, and what a report records of them, is unchanged.
        assert version.as_dict()["cross_league"] == {
            "xi": 0.0005,
            "team_ridge": 4.0,
            "group_ridge": 0.001,
        }


@pytest.mark.parametrize("which", ["published", "candidate"])
def test_with_the_options_off_the_forecasts_are_the_ones_before_t1654(which: str) -> None:
    version = PUBLISHED if which == "published" else load_candidates()["dixon-coles-elo-0.7.0"]
    # Elo and competition groups on offer: a version without the options reads neither.
    source = World(
        golden_world(),
        elo={c: 1500.0 + 10 * i for i, c in enumerate(ENGLAND + SPAIN)},
        labels={(KICKOFF.date(), h, a): "uefa" for h, a in PAIRS},
    )
    forecaster = Forecaster(source, version=version, clock=lambda: NOW)
    for (home, away), (probabilities, goals) in zip(PAIRS, GOLDEN, strict=True):
        answer = ask(forecaster, home, away)
        p = answer.probabilities  # type: ignore[attr-defined]
        xg = answer.expected_goals  # type: ignore[attr-defined]
        assert (p.home, p.draw, p.away) == probabilities
        assert (xg.home, xg.away) == goals
        assert answer.inputs.elo_used is False  # type: ignore[attr-defined]
        assert answer.inputs.data_completeness == "limited"  # type: ignore[attr-defined]


def test_the_fit_with_the_options_off_is_the_fit_before_t1654() -> None:
    tagged = golden_world()
    constants = CrossLeague(0.0005, 4.0, 0.001)
    before = fit_joint(
        [m for _, m in tagged],
        groups_for(tagged),
        FIT_DATE,
        xi=0.0005,
        team_ridge=4,
        group_ridge=0.001,
    )
    joint = fit_across(
        tagged, FIT_DATE, constants, elo={ENGLAND[0]: 1700.0}, labels={(FIT_DATE, "x", "y"): "uefa"}
    )
    assert joint.home_by_group == {} and joint.rated_clubs == 0
    for (home, away), raw in zip(PAIRS, GOLDEN_RAW, strict=True):
        for model in (before, joint.model):
            o = model.predict(home, away)
            assert (o.home_win, o.draw, o.away_win) == pytest.approx(raw, abs=1e-7)
    # The same parameters as before: the options append theirs only when on.
    problem = joint_problem(
        [m for _, m in tagged],
        groups_for(tagged),
        FIT_DATE,
        xi=0.0005,
        team_ridge=4,
        group_ridge=0.001,
    )
    clubs, groups = len(before.teams), len(set(groups_for(tagged).values()))
    assert problem.theta0.shape == (2 * clubs + 2 * groups + 2,)


# --- the version file -----------------------------------------------------------


def write_version(tmp_path: Path, cross: Mapping[str, object]) -> Path:
    path = tmp_path / "dixon-coles-elo-0.9.0.json"
    path.write_text(json.dumps({"version": "0.9.0", "cross_league": cross}), encoding="utf-8")
    return path


def test_a_version_file_turns_each_option_on(tmp_path: Path) -> None:
    base = {"xi": 0.0005, "team_ridge": 4, "group_ridge": 0.001}
    version = load_candidate(
        write_version(tmp_path, {**base, "elo_weight": 0.5, "home_by_competition": 30})
    )
    assert version is not None and version.cross_league is not None
    assert version.cross_league == CrossLeague(0.0005, 4.0, 0.001, 0.5, 30.0)
    assert version.as_dict()["cross_league"] == {
        **base,
        "elo_weight": 0.5,
        "home_by_competition": 30.0,
    }
    with pytest.raises(ValueError, match="elo_weight"):
        load_candidate(write_version(tmp_path, {**base, "elo_weight": -1}))
    with pytest.raises(ValueError, match="ridge"):
        load_candidate(write_version(tmp_path, {**base, "home_by_competition": 0}))


# --- the Elo prior ----------------------------------------------------------------


def stronger_england(rng: np.random.Generator) -> tuple[Tagged, dict[str, float]]:
    """E0 truly 0.6 stronger than SP1, no match between them; Elo knows it."""
    tagged = two_leagues(rng)
    elo = {c: 1620.0 - 25 * j for j, c in enumerate(ENGLAND)}
    elo |= {c: 1380.0 - 25 * j for j, c in enumerate(SPAIN)}
    return tagged, elo


def test_the_elo_prior_separates_leagues_no_match_between_them_separates() -> None:
    tagged, elo = stronger_england(np.random.default_rng(7))
    off = fit_across(tagged, FIT_DATE, CrossLeague(0.0005, 4.0, 0.001))
    on = fit_across(tagged, FIT_DATE, CrossLeague(0.0005, 4.0, 0.001, elo_weight=0.5), elo=elo)

    def gap(model: object) -> float:
        strength = model.strength  # type: ignore[attr-defined]
        return float(
            np.mean([strength(c) for c in ENGLAND]) - np.mean([strength(c) for c in SPAIN])
        )

    assert abs(gap(off.model)) < 0.05
    # 240 Elo points are 0.6 of strength; the leagues' own matches say nothing against it.
    assert gap(on.model) == pytest.approx(0.6, abs=0.1)
    assert on.rated_clubs == len(ENGLAND) + len(SPAIN)


def test_the_elo_prior_tames_a_club_seen_four_times() -> None:
    """Four 2-0 defeats put a club of an unheld league near nothing (the LASK case)."""
    tagged = golden_world()
    elo = {c: 1550.0 - 10 * j for j, c in enumerate(ENGLAND + SPAIN)} | {OUTSIDER: 1450.0}
    base = CrossLeague(0.0005, 4.0, 0.001)
    off = fit_across(tagged, FIT_DATE, base).predict(ENGLAND[3], OUTSIDER)
    on = fit_across(tagged, FIT_DATE, replace(base, elo_weight=0.5), elo=elo).predict(
        ENGLAND[3], OUTSIDER
    )
    assert off.home_win > 0.8
    assert on.home_win < off.home_win - 0.1
    assert on.away_win > 5 * off.away_win


def test_the_service_reads_the_prior_and_says_so() -> None:
    tagged, elo = stronger_england(np.random.default_rng(8))
    # A few matches across leagues, so the version answers for XL at all.
    tagged += [
        (CROSS_LEAGUE, m)
        for m in between(np.random.default_rng(9), margin=0.6, home=0.25, start=date(2024, 9, 1))
    ]
    version = replace(
        PUBLISHED, version="0.9.0", cross_league=CrossLeague(0.0005, 4.0, 0.001, elo_weight=0.5)
    )
    answer = ask(Forecaster(World(tagged, elo=elo), version=version, clock=lambda: NOW), *PAIRS[0])
    assert answer.inputs.elo_used is True  # type: ignore[attr-defined]
    # Both clubs have far more than 15 matches: with a prior, the forecast is complete.
    assert answer.inputs.data_completeness == "available"  # type: ignore[attr-defined]
    factors = {f.factor: f for f in answer.leading_factors}  # type: ignore[attr-defined]
    assert "and the Elo prior" in factors["team_strength"].note


def test_the_analytic_gradient_is_the_gradient_with_both_options_on() -> None:
    rng = np.random.default_rng(12)
    tagged = golden_world()
    labels = [
        "uefa" if i % 3 == 0 else "domestic_cup" if i % 3 == 1 else None for i in range(len(tagged))
    ]
    home_groups = [
        g if d == CROSS_LEAGUE else None for (d, _), g in zip(tagged, labels, strict=True)
    ]
    elo = {c: 1500.0 + 15 * i for i, c in enumerate(ENGLAND + SPAIN[:5])}
    problem = joint_problem(
        [m for _, m in tagged],
        groups_for(tagged),
        FIT_DATE,
        xi=0.002,
        team_ridge=0.5,
        group_ridge=0.02,
        elo=elo,
        elo_weight=0.7,
        home_groups=home_groups,
        home_ridge=3.0,
    )
    theta = rng.normal(0.0, 0.2, size=problem.theta0.shape)
    theta[len(theta) - 3] = 0.05  # rho: the two home deviations follow it
    error = check_grad(lambda t: problem.objective(t)[0], lambda t: problem.objective(t)[1], theta)
    assert error < 1e-3 * np.linalg.norm(problem.objective(theta)[1])


# --- the home advantage per competition group --------------------------------------


def cup_world() -> tuple[Tagged, dict[FixtureKey, str]]:
    """Leagues at home 0.25; the UEFA matches between them at home 0.7, the cups at 0.25."""
    rng = np.random.default_rng(31)
    tagged = two_leagues(rng)
    uefa = between(rng, margin=0.0, home=0.7, start=date(2023, 9, 1), every=2, rounds=6)
    cups = between(rng, margin=0.0, home=0.25, start=date(2023, 9, 2), every=2, rounds=2)
    tagged += [(CROSS_LEAGUE, m) for m in uefa + cups]
    labels = {(m.date, m.home, m.away): "uefa" for m in uefa}
    labels |= {(m.date, m.home, m.away): "domestic_cup" for m in cups}
    return tagged, labels


def test_a_competition_group_gets_its_own_home_advantage() -> None:
    tagged, labels = cup_world()
    base = CrossLeague(0.0005, 4.0, 0.001)
    shared = fit_across(tagged, FIT_DATE, base)
    weak = fit_across(tagged, FIT_DATE, replace(base, home_by_competition=1.0), labels=labels)
    stiff = fit_across(tagged, FIT_DATE, replace(base, home_by_competition=1e7), labels=labels)
    assert set(weak.home_by_group) == {"uefa", "domestic_cup"}
    # The UEFA matches' 0.45 beyond the leagues' is recovered; the cups' nothing.
    assert weak.home_by_group["uefa"] == pytest.approx(0.45, abs=0.12)
    assert abs(weak.home_by_group["domestic_cup"]) < 0.15
    assert weak.model.home_advantage == pytest.approx(0.25, abs=0.08)
    assert max(abs(v) for v in stiff.home_by_group.values()) < 1e-3
    # One shared home advantage sits between the leagues' and the UEFA matches'.
    assert weak.model.home_advantage < shared.model.home_advantage
    # A match of an unknown group reads the shared one.
    assert weak.for_group(None) is weak.model and weak.for_group("other") is weak.model
    uefa = weak.predict(ENGLAND[0], SPAIN[0], "uefa")
    league = weak.predict(ENGLAND[0], SPAIN[0], None)
    assert uefa.home_win > league.home_win + 0.05


def test_the_service_reads_the_fixtures_group() -> None:
    tagged, labels = cup_world()
    home, away = PAIRS[0]
    version = replace(
        PUBLISHED,
        version="0.9.0",
        cross_league=CrossLeague(0.0005, 4.0, 0.001, home_by_competition=3),
    )
    named = World(tagged, labels=labels | {(KICKOFF.date(), home, away): "uefa"})
    unnamed = World(tagged, labels=labels)
    with_group = ask(Forecaster(named, version=version, clock=lambda: NOW), home, away)
    without = ask(Forecaster(unnamed, version=version, clock=lambda: NOW), home, away)
    assert with_group.probabilities.home > without.probabilities.home + 0.03  # type: ignore[attr-defined]


def test_competition_groups_come_from_scope_kind_and_clubs_never_names() -> None:
    assert home_group("continental", "cup", uefa=True) == "uefa"
    assert home_group("continental", "qualifying", uefa=False) == "continental"
    assert home_group("continental", "super_cup", uefa=True) == "other"
    assert home_group("domestic", "cup", uefa=True) == "domestic_cup"
    assert home_group("domestic", "super_cup", uefa=False) == "other"
    assert home_group("international", "cup", uefa=False) == "other"
    assert is_uefa({"ENG": 4, "ESP": 4, "POR": 2})
    assert not is_uefa({"BRA": 10, "ARG": 8})
    assert not is_uefa({"ENG": 1, "KSA": 1})  # half is not more than half
    assert not is_uefa({})


def test_the_uefa_members_are_the_contracts_list() -> None:
    source = (REPOSITORY / "packages/contracts/src/confederation.ts").read_text(encoding="utf-8")
    block = re.search(r"uefa:\s*((?:'[^']*'\s*\+?\s*)+),", source)
    assert block is not None
    codes = "".join(re.findall(r"'([^']*)'", block.group(1))).split()
    assert frozenset(codes) == UEFA_MEMBERS


# --- the backtest: variants on the same matches -----------------------------------------


def test_the_grids_are_d309s() -> None:
    base = CrossLeague(0.0005, 4.0, 0.001)
    variants = variants_for(base)
    assert variants[0] == Variant("current", "current", base)
    assert [v.constants.elo_weight for v in variants if v.option == "elo"] == list(ELO_WEIGHT_GRID)
    assert [v.constants.home_by_competition for v in variants if v.option == "home"] == list(
        HOME_RIDGE_GRID
    )
    assert [v.constants.xi for v in variants if v.option == "xi"] == list(XI_SWEEP)
    # Each variant changes one thing.
    for v in variants[1:]:
        changed = [k for k, x in v.constants.as_dict().items() if base.as_dict().get(k) != x]
        assert len(changed) == 1, v.name


def test_variants_are_scored_on_the_same_matches_against_the_fit_as_it_is() -> None:
    tagged, labels = cup_world()
    window = (date(2024, 4, 1), date(2024, 8, 31))
    base = CrossLeague(0.0005, 4.0, 0.001)
    variants = [
        Variant("current", "current", base),
        Variant("home 3", "home", replace(base, home_by_competition=3.0)),
        Variant("elo 0.5", "elo", replace(base, elo_weight=0.5)),
        Variant("xi 0.002", "xi", replace(base, xi=0.002)),
    ]
    elo = {c: 1500.0 for c in ENGLAND + SPAIN}
    scores, meta = compare_variants(
        tagged, window, variants, history_days=1100, elo_on=lambda day: elo, labels=labels
    )
    current, *others = scores
    alone, _ = forecast_window(tagged, window, base, history_days=1100, labels=labels)
    assert current.forecasts == len(alone) == meta["forecast_by_every_variant"]
    assert current.log_loss == pytest.approx(
        -np.mean([np.log(f.forecast.of(_result(f.match))) for f in alone]), abs=1e-5
    )
    assert all(s.forecasts == current.forecasts for s in others)
    assert current.interval is None and current.verdict == "reference"
    for s in others:
        assert s.interval is not None and s.interval[0] <= s.interval[1]
        assert s.difference == pytest.approx(s.log_loss - current.log_loss, abs=2e-5)
        # A few dozen matches: never a verdict either way.
        assert s.verdict == "insufficient"
    assert {g.group for g in current.groups} <= {"uefa", "domestic_cup"}
    assert meta["unlabelled"] == 0
    body = variants_body(PUBLISHED, window, scores, meta, note="test")
    assert body["chosen"] == {"elo": None, "home": None, "xi": None}
    text = render_variants(json.loads(json.dumps(body)))
    assert "| home 3 |" in text and "insufficient" in text


def _result(m: MatchObservation) -> str:
    return "H" if m.home_goals > m.away_goals else "A" if m.home_goals < m.away_goals else "D"


def score(**changes: object) -> VariantScore:
    base = VariantScore(
        name="elo 0.5",
        option="elo",
        constants={},
        forecasts=900,
        log_loss=0.96,
        brier=0.57,
        calibration_error=0.03,
        tail=Tail(0, None, None),
        outsiders=100,
        outsiders_log_loss=0.8,
        held_log_loss=0.99,
        groups=[GroupScore("uefa", 500, 0.95, 0.97), GroupScore("domestic_cup", 300, 0.97, 0.98)],
        difference=-0.01,
        interval=(-0.02, -0.004),
        calibration_interval=(-0.01, 0.01),
    )
    return replace(base, **changes)  # type: ignore[arg-type]


def test_the_bar_is_d139s_with_the_competition_groups_as_divisions() -> None:
    assert judge_variant(score()) == ("passed", [])
    assert judge_variant(score(forecasts=299))[0] == "insufficient"
    verdict, reasons = judge_variant(score(interval=(-0.02, 0.001)))
    assert verdict == "failed" and "not wholly below zero" in reasons[0]
    assert judge_variant(score(calibration_interval=(0.001, 0.02)))[0] == "failed"
    worse = [GroupScore("uefa", 500, 0.99, 0.97), GroupScore("other", 60, 0.99, 0.98)]
    assert judge_variant(score(groups=worse))[0] == "failed"
    # A group under 50 matches is not judged.
    few = [GroupScore("uefa", 500, 0.95, 0.97), GroupScore("other", 49, 1.2, 0.9)]
    assert judge_variant(score(groups=few))[0] == "passed"
    picked = chosen(
        [
            score(name="elo 0.1", log_loss=0.97, verdict="passed"),
            score(name="elo 0.5", log_loss=0.95, verdict="passed"),
            score(name="elo 2", log_loss=0.94, verdict="failed"),
        ]
    )
    assert picked == {"elo": "elo 0.5", "home": None, "xi": None}


def test_the_tail_is_said_against_seen() -> None:
    forecasts = [Forecast(0.9, 0.06, 0.04), Forecast(0.04, 0.06, 0.9), Forecast(0.5, 0.3, 0.2)]
    tail = tail_of(forecasts, ["H", "H", "H"])
    assert tail == Tail(2, 0.9, 0.5)
    assert tail_of(forecasts[2:], ["D"]) == Tail(0, None, None)


def test_the_holdout_is_refused_without_its_flag(capsys: pytest.CaptureFixture[str]) -> None:
    to = HOLDOUT_FROM.isoformat()
    assert main(["variants", "--from", "2024-07-01", "--to", to]) == 2
    assert "holdout" in capsys.readouterr().err
