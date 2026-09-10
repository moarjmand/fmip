# Backtest reports

One directory per model version (`<name>-<version>`), one Markdown and one JSON
report per scope, written by `python -m fmip_model.backtest`. They are
committed because they are the evidence behind a model version: what it
scored, against which window, against the market. A new version writes a new
directory; an existing report is never edited by hand.

The verdict line applies D-016: a model whose log loss is not within 0.02 of
the de-margined closing odds is not ready to publish.
