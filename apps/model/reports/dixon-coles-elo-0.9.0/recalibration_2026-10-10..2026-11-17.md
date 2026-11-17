# D-450 recalibration fit (T-1876)

Window: matches kicked off 2026-10-10..2026-11-17 UTC, each once by its last pre-kick-off forecast: 1035 matches ({'dixon-coles-elo@0.6.0': 362, 'dixon-coles-elo@0.7.0': 673}).

## Screen

- Fit on the first 690 by kick-off: T = 1.024526, beta_draw = -0.299546; at half strength T = 1.012263, beta_draw = -0.14977282.
- Last 345: stored log loss 0.95664, mapped 0.95219 (difference -0.00445).
- Whole window: T-hat = 1.079057, beta-hat_draw = -0.24723 (5 Newton steps).
- Lower log loss: True; directions (T-hat > 1, beta-hat < 0): True. **Screen passed.**

## Frozen (half strength)

- Fitted: T-hat = 1.079057, beta-hat_draw = -0.24723.
- Applied: T* = 1.0395285, beta*_draw = -0.123615.

## In sample (descriptive only)

| | Log loss | Draw said | Draw seen | Favourite said | Favourite seen |
|---|---|---|---|---|---|
| stored | 0.95376 | 24.75 | 19.9 | 51.83 | 57.68 |
| half_strength | 0.94833 | 22.23 | 19.9 | 53.95 | 57.68 |

Every match read is listed by fixture and forecast id in the JSON report.
