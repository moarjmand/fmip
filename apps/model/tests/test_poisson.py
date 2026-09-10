import numpy as np
import pytest

from fmip_model.model.poisson import outcome_from_matrix, score_matrix


def test_matrix_is_a_distribution_and_outcomes_sum_to_one() -> None:
    matrix = score_matrix(1.6, 1.1, rho=-0.1)

    assert matrix.shape == (11, 11)
    assert (matrix >= 0).all()
    assert abs(float(matrix.sum()) - 1.0) < 1e-12

    outcome = outcome_from_matrix(matrix)
    assert abs(outcome.home_win + outcome.draw + outcome.away_win - 1.0) < 1e-12
    assert outcome.home_win > outcome.away_win  # the home side expects more goals


def test_expected_goals_read_back_from_the_matrix() -> None:
    outcome = outcome_from_matrix(score_matrix(1.5, 1.2))
    # Truncation at ten goals removes only negligible mass.
    assert abs(outcome.expected_home_goals - 1.5) < 1e-3
    assert abs(outcome.expected_away_goals - 1.2) < 1e-3


def test_low_score_correction_moves_mass_between_the_four_low_scores() -> None:
    plain = score_matrix(1.3, 1.3, rho=0.0)
    corrected = score_matrix(1.3, 1.3, rho=-0.1)

    # A negative rho (the usual football fit) raises 0-0 and 1-1, lowers 1-0 and 0-1.
    assert corrected[0, 0] > plain[0, 0]
    assert corrected[1, 1] > plain[1, 1]
    assert corrected[1, 0] < plain[1, 0]
    assert corrected[0, 1] < plain[0, 1]
    assert np.allclose(corrected[2:, :], plain[2:, :] * (plain.sum() / corrected.sum()), rtol=1e-6)


def test_most_likely_scorelines_are_sorted_and_the_top_is_plausible() -> None:
    outcome = outcome_from_matrix(score_matrix(2.0, 0.8), top=3)

    probabilities = [s.probability for s in outcome.most_likely]
    assert probabilities == sorted(probabilities, reverse=True)
    assert (outcome.most_likely[0].home, outcome.most_likely[0].away) in {(1, 0), (2, 0)}


def test_rounded_probabilities_total_exactly_one() -> None:
    # 0.3335 / 0.3335 / 0.333 would round to 0.334 + 0.334 + 0.333 = 1.001.
    outcome = outcome_from_matrix(score_matrix(1.35, 1.35, rho=-0.05))
    h, d, a = outcome.rounded(3)
    assert round(h + d + a, 3) == 1.0
    assert abs(h - outcome.home_win) < 0.002


def test_rejects_non_positive_expectations() -> None:
    with pytest.raises(ValueError):
        score_matrix(0.0, 1.0)
