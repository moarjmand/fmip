"""The fit recovers what was put in, on synthetic seasons with known strengths."""

from datetime import date, timedelta

import numpy as np
import pytest

from fmip_model.model.dixon_coles import ELO_SCALE, MatchObservation, fit, time_weights

TEAMS = ["Strong", "Good", "Mid", "Weak"]
TRUE_ATTACK = {"Strong": 0.45, "Good": 0.15, "Mid": -0.15, "Weak": -0.45}
TRUE_DEFENCE = {"Strong": -0.35, "Good": -0.1, "Mid": 0.1, "Weak": 0.35}
TRUE_HOME = 0.28


def simulate(seasons: int, seed: int = 7) -> list[MatchObservation]:
    rng = np.random.default_rng(seed)
    matches: list[MatchObservation] = []
    day = date(2023, 8, 1)
    for _ in range(seasons):
        for home in TEAMS:
            for away in TEAMS:
                if home == away:
                    continue
                lam = float(np.exp(TRUE_ATTACK[home] + TRUE_DEFENCE[away] + TRUE_HOME))
                mu = float(np.exp(TRUE_ATTACK[away] + TRUE_DEFENCE[home]))
                matches.append(
                    MatchObservation(day, home, away, int(rng.poisson(lam)), int(rng.poisson(mu)))
                )
                day += timedelta(days=3)
    return matches


def test_recovers_the_strength_order_and_a_positive_home_advantage() -> None:
    matches = simulate(seasons=12)
    model = fit(matches, fit_date=matches[-1].date, xi=0.0)  # xi=0: every match counts alike

    strengths = [model.strength(t) for t in TEAMS]
    assert strengths == sorted(strengths, reverse=True), strengths
    assert 0.1 < model.home_advantage < 0.5
    assert model.matches_used == len(matches)


def test_prediction_favours_the_stronger_side_and_sums_to_one() -> None:
    model = fit(simulate(seasons=12), fit_date=date(2030, 1, 1), xi=0.0)

    strong_home = model.predict("Strong", "Weak")
    weak_home = model.predict("Weak", "Strong")

    assert strong_home.home_win > 0.6
    assert weak_home.away_win > weak_home.home_win
    assert abs(strong_home.home_win + strong_home.draw + strong_home.away_win - 1.0) < 1e-9
    assert strong_home.expected_home_goals > strong_home.expected_away_goals


def test_time_weights_halve_at_the_half_life() -> None:
    xi = 0.0065
    fit_date = date(2025, 6, 1)
    w = time_weights([fit_date, fit_date - timedelta(days=round(np.log(2) / xi))], fit_date, xi)
    assert w[0] == 1.0
    assert abs(w[1] - 0.5) < 0.01


def test_a_match_after_the_fit_date_is_refused() -> None:
    with pytest.raises(ValueError, match="future"):
        fit(
            [MatchObservation(date(2025, 6, 2), "A", "B", 1, 0)],
            fit_date=date(2025, 6, 1),
        )


def elo_for(net_strength: float) -> float:
    """The Elo that the prior maps to a given net strength (ELO_SCALE per 400)."""
    return 1700.0 + 400.0 * net_strength / ELO_SCALE


def test_elo_prior_gives_a_team_with_no_matches_a_sensible_strength() -> None:
    matches = simulate(seasons=8)
    true_net = {t: TRUE_ATTACK[t] - TRUE_DEFENCE[t] for t in TEAMS}  # 0.8, 0.25, -0.25, -0.8
    elo = {t: elo_for(net) for t, net in true_net.items()}
    elo["Newcomer"] = elo_for(0.5)  # between Good (0.25) and Strong (0.8)

    model = fit(matches, fit_date=matches[-1].date, xi=0.0, elo=elo)

    assert "Newcomer" in model.teams
    # Never played, yet rated between Good and Strong, where its Elo puts it.
    assert model.strength("Good") < model.strength("Newcomer") < model.strength("Strong")
    forecast = model.predict("Newcomer", "Weak")
    assert forecast.home_win > forecast.away_win


def test_elo_prior_is_a_pull_not_a_dictate() -> None:
    # Twelve seasons of results say Weak is weak; an absurd Elo cannot make it strong.
    matches = simulate(seasons=12)
    elo = {"Strong": 1500.0, "Good": 1500.0, "Mid": 1500.0, "Weak": elo_for(1.5)}

    model = fit(matches, fit_date=matches[-1].date, xi=0.0, elo=elo)

    assert model.strength("Weak") < model.strength("Strong")


def test_unknown_team_is_an_error_not_a_guess() -> None:
    model = fit(simulate(seasons=2), fit_date=date(2030, 1, 1), xi=0.0)
    with pytest.raises(KeyError, match="unknown team"):
        model.predict("Strong", "Nobody")
