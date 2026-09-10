"""Backtesting and calibration (T-062).

A walk-forward evaluation: for each match day in the window, fit the model on
everything before that day, forecast the day's matches, and score the
forecasts against what happened. Scores are log loss, Brier, and a
reliability table; the bookmaker's closing odds, de-margined, are scored the
same way as the benchmark the model has to approach (D-016: "a model that
cannot match the market's calibration is not ready to publish").
"""
