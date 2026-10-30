"""The fit across leagues, judged on matches between clubs of different leagues (T-533).

    python -m fmip_model.backtest.cross_league \\
        --tune-from 2024-07-01 --tune-to 2025-06-30 \\
        --test-from 2025-07-01 --test-to 2026-06-30 --history-days 1100 --out reports

Only the matches of our own records that cross leagues (division ``XL``) are
forecast, each from a fit on every match before its day, refitted weekly --
the way the service fits. The constants are chosen on the tuning window and
the choice is scored once on the test window, against uniform and against the
tuning window's home/draw/away frequencies: a forecaster that knew nothing of
the clubs. Matches with a club of a league the model does not hold are also
scored on their own, because that is where the method is weakest.

``variants`` (T-1654, T-1653, D-309) compares D-309's fixed variants of a
version's cross-league fit with the fit as it is, on the same matches:

    python -m fmip_model.backtest.cross_league variants \\
        --from 2024-07-01 --to 2025-06-30 [--version dixon-coles-elo-0.7.0] --out reports

``DATABASE_URL`` is the training store (the lab's, D-303); the competitions
of the matches across leagues are read from ``CATALOG_DATABASE_URL`` (the
catalogue, read-only), else from ``DATABASE_URL``. A window reaching the
holdout (``HOLDOUT_FROM`` on) is refused without ``--holdout``.
"""

from __future__ import annotations

import argparse
import itertools
import json
import os
import sys
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass, field, replace
from datetime import date, timedelta
from pathlib import Path

from ..model.cross_league import (
    CROSS_LEAGUE,
    HOME_GROUPS,
    OTHER_GROUP,
    FixtureKey,
    JointFit,
    fit_across,
    groups_for,
)
from ..model.dixon_coles import MatchObservation
from ..model.version import CrossLeague, ModelVersion
from .inputs import BAR, Bar, paired_bootstrap
from .metrics import RESULTS, Forecast, Result, brier, log_loss
from .walk_forward import scorecard

XI_GRID = (0.001, 0.002, 0.004)
TEAM_RIDGE_GRID = (0.05, 0.2, 1.0)
GROUP_RIDGE_GRID = (0.001, 0.01, 0.1)

#: D-309's grids, fixed before any run: each option alone against the fit as
#: it is, the other constants held. Combinations are T-1660's.
ELO_WEIGHT_GRID = (0.1, 0.5, 2.0)
HOME_RIDGE_GRID = (3.0, 30.0, 300.0)
#: T-1653's half-lives for the fit across leagues: about 7.6, 1.9 and 0.95
#: years and 173 days, beside the published 0.0005 (3.8 years).
XI_SWEEP = (0.00025, 0.001, 0.002, 0.004)
#: A forecast this sure (its likeliest outcome above it) is in the tail.
TAIL = 0.85
#: D-303: 2024/25 is the development window; from here on is the holdout,
#: untouched until the combined candidate's one final run (T-1660).
HOLDOUT_FROM = date(2025, 7, 1)
#: The group of a match across leagues whose competition the catalogue did not give.
UNLABELLED = "unlabelled"

Tagged = Sequence[tuple[str, MatchObservation]]
EloByDay = Callable[[date], Mapping[str, float]]


def result_of(m: MatchObservation) -> Result:
    return "H" if m.home_goals > m.away_goals else "A" if m.home_goals < m.away_goals else "D"


@dataclass(frozen=True)
class CrossForecast:
    match: MatchObservation
    forecast: Forecast
    #: Whether either club is in the ``other`` group: no domestic league held.
    outsider: bool
    #: Its competition's home group (D-309), when the catalogue gave one.
    group: str | None = None

    @property
    def key(self) -> FixtureKey:
        return (self.match.date, self.match.home, self.match.away)


def forecast_window(
    tagged: Tagged,
    window: tuple[date, date],
    constants: CrossLeague,
    *,
    history_days: int,
    refit_every_days: int = 7,
    min_history: int = 60,
    elo_on: EloByDay | None = None,
    labels: Mapping[FixtureKey, str] | None = None,
) -> tuple[list[CrossForecast], int]:
    """Every cross-league match in the window that can be forecast, and how many could not.

    Each fit is ``fit_across``'s, the service's: ``elo_on`` gives our own Elo
    of a fit date by club (read only with the Elo option on), ``labels`` the
    competition groups (read only with the home option on).
    """
    ordered = sorted(tagged, key=lambda dm: dm[1].date)
    targets = [m for d, m in ordered if d == CROSS_LEAGUE and window[0] <= m.date <= window[1]]
    known = labels or {}
    out: list[CrossForecast] = []
    skipped = 0
    joint: JointFit | None = None
    groups: dict[str, str] = {}
    last_fit: date | None = None
    for match in targets:
        fit_date = match.date - timedelta(days=1)
        if joint is None or last_fit is None or (fit_date - last_fit).days >= refit_every_days:
            since = fit_date - timedelta(days=history_days)
            history = [(d, m) for d, m in ordered if since < m.date <= fit_date]
            if len(history) < min_history:
                skipped += 1
                continue
            groups = groups_for(history)
            elo = elo_on(fit_date) if elo_on is not None and constants.elo_weight > 0 else None
            joint = fit_across(history, fit_date, constants, elo=elo, labels=labels)
            last_fit = fit_date
        if match.home not in joint.model.attack or match.away not in joint.model.attack:
            skipped += 1
            continue
        group = known.get((match.date, match.home, match.away))
        outcome = joint.predict(match.home, match.away, group)
        out.append(
            CrossForecast(
                match,
                Forecast(outcome.home_win, outcome.draw, outcome.away_win),
                outsider=OTHER_GROUP in (groups.get(match.home), groups.get(match.away)),
                group=group,
            )
        )
    return out, skipped


def frequencies(forecasts: Sequence[CrossForecast]) -> Forecast:
    """Home, draw and away as often as they happened: the forecaster that knows no club."""
    results = [result_of(f.match) for f in forecasts]
    n = len(results)
    return Forecast(results.count("H") / n, results.count("D") / n, results.count("A") / n)


@dataclass(frozen=True)
class Score:
    forecasts: int
    log_loss: float
    brier: float
    uniform_log_loss: float
    frequencies_log_loss: float


def score(forecasts: Sequence[CrossForecast], base: Forecast) -> Score:
    results = [result_of(f.match) for f in forecasts]
    model = [f.forecast for f in forecasts]
    return Score(
        forecasts=len(forecasts),
        log_loss=log_loss(model, results),
        brier=brier(model, results),
        uniform_log_loss=log_loss([Forecast(1 / 3, 1 / 3, 1 / 3)] * len(results), results),
        frequencies_log_loss=log_loss([base] * len(results), results),
    )


# --- variants on the same matches (T-1654, T-1653, D-309) ----------------------


@dataclass(frozen=True)
class Variant:
    name: str
    #: ``current`` (the fit as the version has it), ``elo``, ``home`` or ``xi``.
    option: str
    constants: CrossLeague


def variants_for(base: CrossLeague) -> list[Variant]:
    """D-309's variants of ``base``: the fit as it is, then each option alone on its grid."""
    out = [Variant("current", "current", base)]
    out += [Variant(f"elo {w:g}", "elo", replace(base, elo_weight=w)) for w in ELO_WEIGHT_GRID]
    out += [
        Variant(f"home {r:g}", "home", replace(base, home_by_competition=r))
        for r in HOME_RIDGE_GRID
    ]
    out += [Variant(f"xi {x:g}", "xi", replace(base, xi=x)) for x in XI_SWEEP if x != base.xi]
    return out


@dataclass(frozen=True)
class Tail:
    """The forecasts whose likeliest outcome was given more than ``TAIL``."""

    forecasts: int
    #: The mean probability given to that outcome...
    said: float | None
    #: ...and how often it happened.
    seen: float | None


@dataclass(frozen=True)
class GroupScore:
    group: str
    forecasts: int
    log_loss: float
    current_log_loss: float

    @property
    def worse(self) -> bool:
        return self.log_loss > self.current_log_loss


@dataclass(frozen=True)
class VariantScore:
    name: str
    option: str
    constants: dict[str, float]
    forecasts: int
    log_loss: float
    brier: float
    calibration_error: float
    tail: Tail
    outsiders: int
    outsiders_log_loss: float | None
    held_log_loss: float | None
    groups: list[GroupScore]
    #: Against ``current``, on the same matches; ``None`` for ``current`` itself.
    difference: float | None = None
    interval: tuple[float, float] | None = None
    calibration_interval: tuple[float, float] | None = None
    verdict: str = "reference"
    reasons: list[str] = field(default_factory=list)


def tail_of(forecasts: Sequence[Forecast], results: Sequence[Result]) -> Tail:
    sure: list[tuple[float, bool]] = []
    for f, r in zip(forecasts, results, strict=True):
        probabilities = f.as_tuple()
        top = max(probabilities)
        if top > TAIL:
            sure.append((top, RESULTS[probabilities.index(top)] == r))
    if not sure:
        return Tail(0, None, None)
    return Tail(
        len(sure),
        round(sum(p for p, _ in sure) / len(sure), 4),
        round(sum(1 for _, hit in sure if hit) / len(sure), 4),
    )


def judge_variant(score: VariantScore, bar: Bar = BAR) -> tuple[str, list[str]]:
    """D-139's bar on the matches across leagues, the competition groups as its divisions."""
    if score.forecasts < bar.min_applied:
        return "insufficient", [f"{score.forecasts} matches, fewer than {bar.min_applied}"]
    assert score.interval is not None and score.calibration_interval is not None
    reasons: list[str] = []
    if not score.interval[1] < 0:
        reasons.append(f"the log-loss interval {list(score.interval)} is not wholly below zero")
    if score.calibration_interval[0] > 0:
        reasons.append(
            f"calibration is worse: its rise's interval {list(score.calibration_interval)} "
            "is wholly above zero"
        )
    judged = [g for g in score.groups if g.forecasts >= bar.min_division_applied]
    worse = [g.group for g in judged if g.worse]
    if judged and len(worse) > bar.max_worse_share * len(judged):
        reasons.append(f"worse in {len(worse)} of {len(judged)} competition groups: {worse}")
    return ("failed", reasons) if reasons else ("passed", [])


def compare_variants(
    tagged: Tagged,
    window: tuple[date, date],
    variants: Sequence[Variant],
    *,
    history_days: int,
    elo_on: EloByDay | None = None,
    labels: Mapping[FixtureKey, str] | None = None,
    bar: Bar = BAR,
    refit_every_days: int = 7,
) -> tuple[list[VariantScore], dict[str, object]]:
    """Every variant walked over the window with the same fit dates, scored on the
    matches all of them forecast; the first variant is the reference."""
    if not variants or variants[0].option != "current":
        raise ValueError("the first variant is the fit as it is ('current')")
    runs: list[dict[FixtureKey, CrossForecast]] = []
    skipped: dict[str, int] = {}
    for variant in variants:
        made, missed = forecast_window(
            tagged,
            window,
            variant.constants,
            history_days=history_days,
            refit_every_days=refit_every_days,
            elo_on=elo_on,
            labels=labels,
        )
        runs.append({f.key: f for f in made})
        skipped[variant.name] = missed
        print(f"{variant.name}: {len(made)} forecast, {missed} skipped", flush=True)
    keys = [k for k in runs[0] if all(k in run for run in runs[1:])]
    reference = [runs[0][k] for k in keys]
    results = [result_of(f.match) for f in reference]
    group_of = [f.group or UNLABELLED for f in reference]
    current = [f.forecast for f in reference]

    def mean_loss(forecasts: Sequence[Forecast], where: Sequence[bool]) -> float | None:
        picked = [(f, r) for f, r, w in zip(forecasts, results, where, strict=True) if w]
        if not picked:
            return None
        return round(log_loss([f for f, _ in picked], [r for _, r in picked]), 5)

    outsider = [f.outsider for f in reference]
    held = [not o for o in outsider]
    scores: list[VariantScore] = []
    for variant, run in zip(variants, runs, strict=True):
        forecasts = [run[k].forecast for k in keys]
        if not forecasts:
            raise ValueError("no match was forecast by every variant")
        card = scorecard(forecasts, results)
        groups = []
        for g in (*HOME_GROUPS, UNLABELLED):
            where = [x == g for x in group_of]
            n = sum(where)
            if n:
                own, ref = mean_loss(forecasts, where), mean_loss(current, where)
                assert own is not None and ref is not None
                groups.append(GroupScore(g, n, own, ref))
        score = VariantScore(
            name=variant.name,
            option=variant.option,
            constants=variant.constants.as_dict(),
            forecasts=len(forecasts),
            log_loss=round(card.log_loss, 5),
            brier=round(card.brier, 5),
            calibration_error=round(card.calibration_error, 5),
            tail=tail_of(forecasts, results),
            outsiders=sum(outsider),
            outsiders_log_loss=mean_loss(forecasts, outsider),
            held_log_loss=mean_loss(forecasts, held),
            groups=groups,
        )
        if variant.option != "current":
            boot = paired_bootstrap(current, forecasts, results, bar)
            reference_loss = log_loss(current, results)
            score = replace(
                score,
                difference=round(card.log_loss - reference_loss, 6),
                interval=boot.log_loss,
                calibration_interval=boot.calibration_error,
            )
            verdict, reasons = judge_variant(score, bar)
            score = replace(score, verdict=verdict, reasons=reasons)
        scores.append(score)
    meta: dict[str, object] = {
        "targets": sum(
            1 for d, m in tagged if d == CROSS_LEAGUE and window[0] <= m.date <= window[1]
        ),
        "forecast_by_every_variant": len(keys),
        "skipped": skipped,
        "unlabelled": sum(1 for g in group_of if g == UNLABELLED),
    }
    return scores, meta


def chosen(scores: Sequence[VariantScore]) -> dict[str, str | None]:
    """Per option, its passing variant with the lowest log loss, else none (D-309)."""
    out: dict[str, str | None] = {}
    for option in ("elo", "home", "xi"):
        passed = [s for s in scores if s.option == option and s.verdict == "passed"]
        out[option] = min(passed, key=lambda s: s.log_loss).name if passed else None
    return out


def variants_body(
    version: ModelVersion,
    window: tuple[date, date],
    scores: Sequence[VariantScore],
    meta: Mapping[str, object],
    *,
    note: str = "",
    bar: Bar = BAR,
) -> dict[str, object]:
    from ..model.own_elo import RULES

    return {
        "task": "T-1654",
        "decision": "D-309",
        "version": version.id,
        "window": [window[0].isoformat(), window[1].isoformat()],
        "history_days": version.history_days,
        "own_elo_rules": RULES.id,
        "bar": asdict(bar),
        "tail_above": TAIL,
        "grids": {
            "elo_weight": list(ELO_WEIGHT_GRID),
            "home_by_competition": list(HOME_RIDGE_GRID),
            "xi": list(XI_SWEEP),
        },
        **meta,
        "variants": [asdict(s) for s in scores],
        "chosen": chosen(scores),
        "note": note,
    }


def render_variants(body: Mapping[str, object]) -> str:
    def num(x: object, digits: int = 4) -> str:
        return "–" if x is None else f"{float(str(x)):.{digits}f}"

    variants = body["variants"]
    assert isinstance(variants, list)
    lines = [
        f"# The fit across leagues: D-309's variants of {body['version']}",
        "",
        f"Window {body['window'][0]} .. {body['window'][1]}, "  # type: ignore[index]
        f"history {body['history_days']} days; {body['forecast_by_every_variant']} of "
        f"{body['targets']} matches across leagues forecast by every variant "
        f"({body['unlabelled']} without a competition group). Bar: D-139's, the "
        "competition groups as its divisions. Note: "
        f"{body['note'] or '-'}",
        "",
        "| Variant | Log loss | Difference [95%] | Brier | Calibration | Its rise [95%] "
        f"| Above {TAIL:.0%}: n, said, seen | Outsiders | Verdict |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for v in variants:
        assert isinstance(v, dict)
        tail = v["tail"]
        interval = v["interval"]
        rise = v["calibration_interval"]
        lines.append(
            f"| {v['name']} | {num(v['log_loss'])} | "
            + (
                "–"
                if interval is None
                else f"{num(v['difference'])} [{num(interval[0])}, {num(interval[1])}]"
            )
            + f" | {num(v['brier'])} | {num(v['calibration_error'])} | "
            + ("–" if rise is None else f"[{num(rise[0])}, {num(rise[1])}]")
            + f" | {tail['forecasts']}, {num(tail['said'], 3)}, {num(tail['seen'], 3)} | "
            f"{v['outsiders']}: {num(v['outsiders_log_loss'])} | {v['verdict']} |"
        )
    lines += ["", "Per competition group (log loss, the variant's against current's):", ""]
    lines += ["| Variant | " + " | ".join((*HOME_GROUPS, UNLABELLED)) + " |"]
    lines += ["|---" * (len(HOME_GROUPS) + 2) + "|"]
    for v in variants:
        assert isinstance(v, dict)
        cells = {g["group"]: g for g in v["groups"]}
        row = [
            "–"
            if g not in cells
            else f"{num(cells[g]['log_loss'])} / {num(cells[g]['current_log_loss'])} "
            f"(n {cells[g]['forecasts']})"
            for g in (*HOME_GROUPS, UNLABELLED)
        ]
        lines.append(f"| {v['name']} | " + " | ".join(row) + " |")
    reasons = [v for v in variants if isinstance(v, dict) and v["reasons"]]
    if reasons:
        lines += ["", "Why a variant did not pass:", ""]
        lines += [f"- {v['name']}: {'; '.join(v['reasons'])}" for v in reasons]
    lines += ["", f"Chosen per option (the passing one with the lowest log loss): {body['chosen']}"]
    return "\n".join(lines) + "\n"


def write_variants(body: Mapping[str, object], version: ModelVersion, out: Path) -> Path:
    folder = out / f"{version.name}-{version.version}"
    folder.mkdir(parents=True, exist_ok=True)
    window = body["window"]
    assert isinstance(window, list)
    stem = f"cross_league_variants_{window[0]}..{window[1]}"
    (folder / f"{stem}.json").write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8")
    md = folder / f"{stem}.md"
    md.write_text(render_variants(body), encoding="utf-8")
    return md


def versions_by_name() -> dict[str, ModelVersion]:
    from ..model.version import PUBLISHED, load_candidates

    return {f"{PUBLISHED.name}-{PUBLISHED.version}": PUBLISHED, **load_candidates()}


def variants_main(argv: Sequence[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="fmip_model.backtest.cross_league variants",
        description="D-309's variants of a version's fit across leagues, on the same matches.",
    )
    parser.add_argument("--from", dest="start", type=date.fromisoformat, required=True)
    parser.add_argument("--to", dest="end", type=date.fromisoformat, required=True)
    parser.add_argument(
        "--version",
        help="a version file's stem (default: the newest candidate, as D-139 judges against)",
    )
    parser.add_argument("--out", type=Path, default=Path("reports"))
    parser.add_argument("--note", default="")
    parser.add_argument(
        "--holdout",
        action="store_true",
        help=f"allow a window reaching the holdout ({HOLDOUT_FROM} on): T-1660's final run only",
    )
    args = parser.parse_args(list(argv))
    if not args.start <= args.end:
        print("--from must not be after --to", file=sys.stderr)
        return 2
    if args.end >= HOLDOUT_FROM and not args.holdout:
        print(
            f"{args.end} is in the holdout (from {HOLDOUT_FROM}, D-303): "
            "pass --holdout only for the combined candidate's final run (T-1660)",
            file=sys.stderr,
        )
        return 2
    versions = versions_by_name()
    if args.version is None:
        from ..model.version import load_candidate

        version = load_candidate()
        if version is None:
            print("no candidate: name a version with --version", file=sys.stderr)
            return 2
    elif args.version in versions:
        version = versions[args.version]
    else:
        print(f"no version {args.version!r}; one of {sorted(versions)}", file=sys.stderr)
        return 2
    if version.cross_league is None:
        print(f"{version.id} has no fit across leagues", file=sys.stderr)
        return 2
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 2
    catalog_url = os.environ.get("CATALOG_DATABASE_URL") or database_url

    import psycopg

    from ..model.data import every_match_before
    from ..training.own_elo import read_matches
    from ..training.records import across_leagues_groups
    from .elo_prior import OwnEloByDay

    since = args.start - timedelta(days=version.history_days + 1)
    with psycopg.connect(database_url) as conn:
        tagged = [
            (d, m)
            for d, m in every_match_before(conn, args.end, since=since)
            if version.forecasts(d)
        ]
        elo = OwnEloByDay(read_matches(conn, args.end), {})
    with psycopg.connect(catalog_url) as conn:
        labels = across_leagues_groups(conn, since, args.end)
    if not any(d == CROSS_LEAGUE for d, _ in tagged):
        print("no match across leagues in the training store", file=sys.stderr)
        return 1
    scores, meta = compare_variants(
        tagged,
        (args.start, args.end),
        variants_for(version.cross_league),
        history_days=version.history_days,
        elo_on=elo.by_club,
        labels=labels,
    )
    body = variants_body(version, (args.start, args.end), scores, meta, note=args.note)
    path = write_variants(body, version, args.out)
    for s in scores:
        detail = "" if s.interval is None else f" {s.difference:+.4f} {list(s.interval)}"
        print(f"{s.name}: {s.log_loss:.4f} over {s.forecasts}{detail} {s.verdict}")
    print(f"chosen {body['chosen']} -> {path}")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    given = list(sys.argv[1:] if argv is None else argv)
    if given and given[0] == "variants":
        return variants_main(given[1:])
    parser = argparse.ArgumentParser(prog="fmip_model.backtest.cross_league", description=__doc__)
    parser.add_argument("--tune-from", type=date.fromisoformat, required=True)
    parser.add_argument("--tune-to", type=date.fromisoformat, required=True)
    parser.add_argument("--test-from", type=date.fromisoformat, required=True)
    parser.add_argument("--test-to", type=date.fromisoformat, required=True)
    parser.add_argument("--history-days", type=int, default=1100)
    parser.add_argument("--out", type=Path, default=Path("reports"))
    parser.add_argument("--xi", type=float, nargs="+", default=list(XI_GRID))
    parser.add_argument("--team-ridge", type=float, nargs="+", default=list(TEAM_RIDGE_GRID))
    parser.add_argument("--group-ridge", type=float, nargs="+", default=list(GROUP_RIDGE_GRID))
    args = parser.parse_args(given)
    if not args.tune_to < args.test_from:
        print("the test window must start after the tuning window ends", file=sys.stderr)
        return 2
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 2

    import psycopg

    from ..model.data import every_match_before

    since = args.tune_from - timedelta(days=args.history_days + 1)
    with psycopg.connect(database_url) as conn:
        tagged = every_match_before(conn, args.test_to, since=since)
    if not any(d == CROSS_LEAGUE for d, _ in tagged):
        print(
            "no cross-league match in the training store: load records --divisions XL",
            file=sys.stderr,
        )
        return 1

    tuning: list[dict[str, object]] = []
    best: tuple[float, CrossLeague] | None = None
    for xi, team_ridge, group_ridge in itertools.product(
        args.xi, args.team_ridge, args.group_ridge
    ):
        constants = CrossLeague(xi, team_ridge, group_ridge)
        forecasts, skipped = forecast_window(
            tagged, (args.tune_from, args.tune_to), constants, history_days=args.history_days
        )
        if not forecasts:
            print("no tuning match could be forecast", file=sys.stderr)
            return 1
        loss = log_loss([f.forecast for f in forecasts], [result_of(f.match) for f in forecasts])
        tuning.append(
            {**asdict(constants), "log_loss": loss, "forecasts": len(forecasts), "skipped": skipped}
        )
        print(
            f"tune xi {xi} team {team_ridge} group {group_ridge}: {loss:.4f} ({len(forecasts)})",
            flush=True,
        )
        if best is None or loss < best[0]:
            best = (loss, constants)
    assert best is not None
    chosen = best[1]

    tuned, _ = forecast_window(
        tagged, (args.tune_from, args.tune_to), chosen, history_days=args.history_days
    )
    base = frequencies(tuned)
    tested, skipped = forecast_window(
        tagged, (args.test_from, args.test_to), chosen, history_days=args.history_days
    )
    overall = score(tested, base)
    outsiders = [f for f in tested if f.outsider]
    report = {
        "chosen": asdict(chosen),
        "history_days": args.history_days,
        "tune": {
            "from": args.tune_from.isoformat(),
            "to": args.tune_to.isoformat(),
            "grid": tuning,
        },
        "test": {
            "from": args.test_from.isoformat(),
            "to": args.test_to.isoformat(),
            "skipped": skipped,
            "all": asdict(overall),
            "with_an_outsider": asdict(score(outsiders, base)) if outsiders else None,
            "between_held_leagues": (
                asdict(score([f for f in tested if not f.outsider], base))
                if len(outsiders) < len(tested)
                else None
            ),
        },
    }
    args.out.mkdir(parents=True, exist_ok=True)
    path = args.out / f"cross_league_{args.test_from.isoformat()}..{args.test_to.isoformat()}.json"
    path.write_text(json.dumps(report, indent=2))
    print(
        f"chosen {asdict(chosen)} | test {overall.log_loss:.4f} over {overall.forecasts} "
        f"(uniform {overall.uniform_log_loss:.4f}, frequencies {overall.frequencies_log_loss:.4f}, "
        f"skipped {skipped}) -> {path}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
