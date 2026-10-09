"""The collaborator's comparison (T-1368, D-186): a proposed candidate file
against the reference, on the same matches, judged by D-139's bar."""

import json
from dataclasses import replace
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

import numpy as np
import pytest

from fmip_model.backtest import compare
from fmip_model.backtest.compare import (
    DivisionResult,
    _within_history,
    accuracy,
    choose_reference,
    render,
    report_body,
    run_division,
    seasons_between,
    write,
)
from fmip_model.backtest.metrics import Forecast
from fmip_model.backtest.walk_forward import BacktestMatch
from fmip_model.model.version import BASELINE, PUBLISHED, load_candidate, load_candidates

TEAMS = [f"C{i}" for i in range(10)]
START = date(2024, 8, 1)
WINDOW = (START + timedelta(days=3 * 20), START + timedelta(days=3 * 90))
ODDS = (2.4, 3.3, 3.1)


def season(seed: int) -> list[BacktestMatch]:
    """Ninety rounds of five matches, three days apart, with closing odds on each."""
    rng = np.random.default_rng(seed)
    strength = {t: float(rng.normal(0, 0.4)) for t in TEAMS}
    out: list[BacktestMatch] = []
    for r in range(90):
        day = START + timedelta(days=3 * r)
        order = rng.permutation(TEAMS)
        for k in range(5):
            home, away = str(order[2 * k]), str(order[2 * k + 1])
            lam = np.exp(0.1 + 0.25 + strength[home] - strength[away])
            mu = np.exp(0.1 + strength[away] - strength[home])

            out.append(
                BacktestMatch(
                    day,
                    home,
                    away,
                    int(rng.poisson(lam)),
                    int(rng.poisson(mu)),
                    *(Decimal(str(o)) for o in ODDS),
                )  # fmt: skip
            )
    return out


# A reference that forgets almost at once and is shrunk hard: close to uniform.
POOR = replace(BASELINE, version="0.8.0", xi=0.05, ridge=40.0)
GOOD = replace(BASELINE, version="0.9.0", xi=0.004, ridge=0.01)


@pytest.fixture(scope="module")
def better() -> DivisionResult:
    return run_division("T9", season(7), WINDOW, proposed=GOOD, reference=POOR, refit_every_days=21)


def test_a_clearly_better_proposal_passes_on_the_same_matches(better: DivisionResult) -> None:
    body = report_body(GOOD, POOR, WINDOW, START, [better], {"T9": "football_data"}, "")
    assert body["verdict"] == "passed"
    pooled = body["pooled"]
    assert isinstance(pooled, dict)
    assert pooled["proposed"]["log_loss"] < pooled["reference"]["log_loss"]
    # Every forecaster is scored on the same matches.
    assert {s["n"] for s in pooled.values()} == {len(better.rows)}
    assert pooled["uniform"]["accuracy"] == pytest.approx(1 / 3, abs=1e-4)


def test_a_proposal_that_changes_nothing_fails_and_reuses_the_fits() -> None:
    same = replace(POOR, version="0.8.1")
    result = run_division(
        "T9", season(7), WINDOW, proposed=same, reference=POOR, refit_every_days=21
    )
    assert all(r.proposed == r.reference for r in result.rows)
    body = report_body(same, POOR, WINDOW, START, [result], {"T9": "football_data"}, "")
    assert body["verdict"] == "failed"


def test_too_few_matches_give_no_verdict() -> None:
    short = (WINDOW[0], WINDOW[0] + timedelta(days=30))
    result = run_division(
        "T9", season(7), short, proposed=GOOD, reference=POOR, refit_every_days=21
    )
    body = report_body(GOOD, POOR, short, START, [result], {"T9": "football_data"}, "")
    assert body["verdict"] == "insufficient"


def test_a_match_without_odds_is_left_out_and_counted() -> None:
    matches = season(3)
    bare = replace(matches[300], odds_home=None, odds_draw=None, odds_away=None)
    matches[300] = bare
    result = run_division("T9", matches, WINDOW, proposed=GOOD, reference=POOR, refit_every_days=21)
    assert result.without_odds == 1
    assert all(r.match != bare for r in result.rows)


def test_a_division_without_odds_keeps_its_matches_and_scores_no_market() -> None:
    # Our records (IR1) have no closing odds (T-1372).
    bare = [replace(m, odds_home=None, odds_draw=None, odds_away=None) for m in season(3)]
    result = run_division(
        "IR9", bare, WINDOW, proposed=GOOD, reference=POOR, refit_every_days=21,
        require_odds=False,
    )  # fmt: skip
    assert result.rows and result.without_odds == len(result.rows)
    body = report_body(GOOD, POOR, WINDOW, START, [result], {"IR9": "our_records"}, "")
    pooled = body["pooled"]
    assert isinstance(pooled, dict)
    assert "market" not in pooled and body["market_gap"] is None
    assert pooled["uniform"]["draw_mean"] == pytest.approx(1 / 3, abs=1e-5)
    assert pooled["proposed"]["rps"] < pooled["uniform"]["rps"]
    text = render(body)
    assert "market (closing odds)" not in text and "Draw probability" in text
    assert body["verdict"] == "passed"


def test_a_fit_reads_only_the_versions_history_days() -> None:
    matches = season(1)
    fit_date = START + timedelta(days=200)
    history = [m for m in matches if m.date <= fit_date]
    model = _within_history(replace(BASELINE, history_days=30))(history, fit_date, None)
    assert model.matches_used == sum(1 for m in history if (fit_date - m.date).days <= 30)


def test_accuracy_shares_a_tie_at_the_top() -> None:
    sure = Forecast(0.6, 0.2, 0.2)
    tie = Forecast(0.4, 0.4, 0.2)
    assert accuracy([sure, sure], ["H", "A"]) == 0.5
    assert accuracy([tie], ["D"]) == 0.5
    assert accuracy([Forecast(1 / 3, 1 / 3, 1 / 3)], ["A"]) == pytest.approx(1 / 3)


def test_seasons_run_july_to_june() -> None:
    assert seasons_between(date(2023, 7, 1), date(2026, 6, 30)) == ["2324", "2425", "2526"]
    assert seasons_between(date(2024, 1, 5), date(2024, 8, 1)) == ["2324", "2425"]


def test_the_report_is_written_beside_the_versions_evidence(
    better: DivisionResult, tmp_path: Path
) -> None:
    body = report_body(GOOD, POOR, WINDOW, START, [better], {"T9": "football_data"}, "a note")
    md = write(body, GOOD, tmp_path)
    assert md == tmp_path / "dixon-coles-elo-0.9.0" / f"compare_{WINDOW[0]}..{WINDOW[1]}.md"
    text = md.read_text(encoding="utf-8")
    assert "**Verdict: passed.**" in text and "market (closing odds)" in text
    assert json.loads(md.with_suffix(".json").read_text(encoding="utf-8"))["verdict"] == "passed"
    assert render(body) == text


def test_a_candidate_file_can_set_the_default_constants_and_the_elo_weight(
    tmp_path: Path,
) -> None:
    path = tmp_path / "dixon-coles-elo-0.9.0.json"
    path.write_text(
        json.dumps({"version": "0.9.0", "elo_prior": "own", "elo_weight": 0.8, "xi": 0.004,
                    "per_division": {"E0": {"xi": 0.002, "ridge": 0.003}}}),
        encoding="utf-8",
    )  # fmt: skip
    version = load_candidate(path)
    assert version is not None
    assert version.elo_weight == 0.8
    assert version.constants_for("E0") == (0.002, 0.003)
    assert version.constants_for("SP1") == (0.004, BASELINE.ridge)

    only_weight = tmp_path / "dixon-coles-elo-0.9.1.json"
    only_weight.write_text(json.dumps({"version": "0.9.1", "elo_prior": "clubelo",
                                       "elo_weight": 0.8}), encoding="utf-8")  # fmt: skip
    assert load_candidate(only_weight) is not None

    negative = tmp_path / "dixon-coles-elo-0.9.2.json"
    negative.write_text(json.dumps({"version": "0.9.2", "ridge": -1}), encoding="utf-8")
    with pytest.raises(ValueError):
        load_candidate(negative)


def test_the_reference_is_the_newest_other_candidate_else_published(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # None in shadow since 0.6.0 was published (D-191): the reference is the published version.
    assert load_candidates() == {}
    proposal = replace(PUBLISHED, version="99.0.0")
    assert choose_reference(proposal, None) == PUBLISHED
    assert choose_reference(proposal, "published") == PUBLISHED
    assert choose_reference(proposal, "no-such-name") is None

    older = replace(PUBLISHED, version="0.7.0")
    newer = replace(PUBLISHED, version="0.8.0")
    shadow = {"dixon-coles-elo-0.7.0": older, "dixon-coles-elo-0.8.0": newer}
    monkeypatch.setattr(compare, "load_candidates", lambda: shadow)
    assert choose_reference(proposal, None) == newer
    assert choose_reference(newer, None) == older
    assert choose_reference(proposal, "dixon-coles-elo-0.7.0") == older
