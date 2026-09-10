# Recorded provider responses

One directory per provider (`api-football/`, `football-data-org/`,
`highlightly/`), one JSON file per scenario. A scenario is a contract call, its
arguments, the responses the provider actually returned, and what a conforming
adapter must make of them:

```json
{
  "name": "list-fixtures-premier-league-week",
  "recordedAt": "2026-09-12T10:00:00Z",
  "call": "listFixtures",
  "args": [
    {
      "competitionExternalId": "39",
      "seasonLabel": "2025/26",
      "from": "2025-08-15",
      "to": "2025-08-18"
    }
  ],
  "expect": { "ok": true, "minItems": 10 },
  "requests": [{ "method": "GET", "url": "https://...", "status": 200, "body": {} }]
}
```

Recordings are produced with `RecordingTransport` against a live key and
committed as they came back. They are never edited by hand and never invented:
a scenario that was not recorded does not exist. `checkAdapterContract` replays
them through `ReplayTransport`; an adapter that requests a URL absent from the
recording fails the check.

Recordings are made with `scripts/record.mjs` (see the plan files under
`scripts/plans/`). `api-football/` holds the first set (T-021). `loadScenarios`
on an empty directory yields no scenarios, and the check reports the adapter as
unverified rather than passing it.
