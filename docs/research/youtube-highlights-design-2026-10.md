# Official YouTube channels as a second highlights source: design (T-1489, D-261)

Written 2026-10-25, after the highlights-count diagnosis (T-1488, D-260).
Status: **proposed**. Nothing here is built. It waits for the maintainer's
YouTube API key and the terms check below.

## 1. Why

Highlightly is healthy but thin where it matters most to readers. Over the
closed window from 12 to 22 Oct, the share of finished matches that got a clip:

| Competition | With a clip |
| --- | --- |
| Premier League | 7 / 11 |
| Bundesliga | 5 / 9 |
| Ligue 1 | 6 / 9 |
| UEFA Champions League | 20 / 36 |
| UEFA Conference League | 6 / 19 |
| FA Cup | 2 / 43 |
| Danish Superliga | 1 / 6 |
| Super League Greece | 1 / 6 |
| Persian Gulf Pro League | 0 / 13 |

For the missing matches Highlightly holds only `UNVERIFIED` goal clips on
mirror sites, which we rightly refuse, or nothing at all. Leagues and clubs
publish their own highlights on their official YouTube channels. Linking to
those videos is the same thing we already do for Highlightly's verified clips,
whose URLs are mostly the same YouTube videos: link only, never embedded
(D-184).

## 2. What the YouTube Data API v3 gives us

The plan rests on these API facts. Re-check them against the live
documentation when the key exists.

| Call | Quota cost | Use |
| --- | --- | --- |
| `playlistItems.list` on a channel's uploads playlist | 1 unit per page of 50 | The channel's newest videos, with `publishedAt`. The playlist id is the channel id with `UC` changed to `UU`. |
| `videos.list?part=contentDetails,status,snippet` | 1 unit for up to 50 ids | Duration, `privacyStatus`, title, channel. `contentDetails.regionRestriction.{allowed,blocked}` maps directly onto our territory rule (`allowed_territories` / `blocked_territories`, D-184, D-260). |
| `search.list` | 100 units | Avoided in the job. At most an operator's aid for finding channel ids. |

- The default project quota is 10,000 units a day, free, with no billing account.
- YouTube does not mark a video as "highlights" the way Highlightly does. That
  is the main difference, and section 4 handles it.

## 3. Identity: rule 1 holds

- **A channel is mapped, never named.** Add `youtube` to `provider_mapping`'s
  provider check (migration). A channel id is mapped with
  `entity_type = 'team'` (a club's channel) or `'competition'` (a league's
  channel), through `catalog.mjs --map --provider youtube`, by the operator.
  The external id is the channel id (`UC...`), never its title.
- **Club channels first (phase A).** A video on a mapped club channel belongs
  to that team (our UUID, from the mapping). The match is the team's one
  finished fixture whose kick-off is between 51 hours and 90 minutes before the
  video's `publishedAt`. If there are zero or two such fixtures, the video is
  kept out with a reason (`no_fixture` / `ambiguous`), the same reasons as
  `placeOnFixture`. No name is read to place a video.
- **League channels (phase B, needs its own decision).** One league channel
  covers many matches, so placing a video would mean reading team names out
  of its title. That is a name match, which rule 1 forbids as a key. Phase B
  would need either an alias table checked by the operator or YouTube's
  chapter/description metadata. Leave it out of phase A.

## 4. Which videos count as highlights

All of these must hold. The checks are cheap and decided by the job, not by a
model:

1. `status.privacyStatus = 'public'` and the video is not a live stream.
2. The duration is between 2 and 25 minutes. This leaves out Shorts, goal
   clips, press conferences and full-match replays.
3. The title contains a highlights word from a short per-language list kept
   in the adapter (`highlights`, `resumen`, `melhores momentos`, `zusammenfassung`,
   `résumé`, `sintesi`, `özet`, `خلاصه`, ...). This is a filter on a
   publisher's own description of its own video, never a key.
4. It is published after kick-off and inside the 51-hour window.

Of the videos that pass, the newest is kept. A fixture that already has a row
in `highlight_feed` is never written again (the existing
`ON CONFLICT (fixture_id) DO NOTHING`), so YouTube only fills matches that
Highlightly left empty, and an editor's withdrawal stays withdrawn.

## 5. Shape in the code

| Piece | Where | What |
| --- | --- | --- |
| Adapter | `packages/ingestion/src/adapters/youtube/` | `uploads(channelId, since)` and `videos(ids)`, normalised to `{ externalId, url, title, publishedAt, durationSeconds, live, public, allowed, blocked }`. No YouTube field leaves this folder (rule 2). Recorded fixtures under `_fixtures/youtube/`. |
| Transport | The existing `DailyBudgetTransport` | Counts **units**, not requests, against `YOUTUBE_DAILY_UNITS` (default 8,000, leaving headroom under the 10,000). The count is persisted in Redis so a deploy does not reset it. That is the same fix the Highlightly counter needs, since the "0 of 5000" reading was an in-process count reset by a deploy. |
| Job | `apps/api/src/modules/viewing/youtube-highlight-feed.service.ts` | BullMQ queue `youtube-highlight-feed`, every two hours at :59, scheduled only with `INGESTION_SCHEDULE=on` and a key. It asks only the channels of teams with a finished match in the window **and no clip yet**: about 60 channels × 2 units × 12 runs ≈ 1,500 units a day. The run summary has the same fields as `HighlightsFeedRun`, and it is exposed at `GET /health/youtube-highlights`. |
| Store | `PostgresHighlightFeedStore.store` | Takes the source id as a parameter instead of the fixed Highlightly id. |
| Source row | Migration | `viewing_source` id `00000000-0000-4000-8000-000000000903`, "YouTube (official channels)", `rights = 'link'`. Its `kind` needs the decision in D-261 point 4: the `highlight_feed_link_source` trigger accepts only `licensed_feed`. |
| Env | `.env.example`, `docs/03-project-map.md` | `YOUTUBE_API_KEY` (empty = off, the honest absence) and `YOUTUBE_DAILY_UNITS`. |
| Watchdog | `watchdog/internal/conditions.ts` | `youtube_budget`, like `highlightly_budget`. |

## 6. Terms to check before building (the maintainer's or the agent's, not assumed)

- YouTube API Services Terms and Developer Policies: storing API data. The
  policies limit how long some API data may be kept without being refreshed
  (about 30 days). Either re-read each stored video's status and region rule
  within that limit, or delete the row. This is to be confirmed on the live
  policy page.
- Showing a YouTube link with the channel name and our own text, without
  YouTube's branding requirements on a link-only list. This is to be confirmed.
- Account location: the key belongs to the project's own Google account. Under
  the project's jurisdiction (abroad, see the maintainer's note) Google's
  sanctions terms are those of that country.

## 7. What the maintainer creates (the agent creates no account)

1. In the project's Google account, open Google Cloud Console and create a
   project named `fmip-youtube`.
2. Go to **APIs & Services → Library**, find **YouTube Data API v3**, and click
   **Enable**. No billing is needed.
3. Go to **APIs & Services → Credentials → Create credentials → API key**.
4. Edit the key:
   - **API restrictions:** restrict it to **YouTube Data API v3** only.
   - **Application restrictions:** **IP addresses**, then add the production
     server's public IP (`ssh fmip-prod curl -s ifconfig.me` shows it).
5. On the server, add one line to `/opt/fmip/.env`:
   `YOUTUBE_API_KEY=<the key>`. The maintainer edits `.env` by hand; the
   agent never does. Until phase A is deployed the key does nothing.
6. Say "the key is in". The agent then measures, within quota, how many of the
   missing matches of the last two weeks the mapped club channels would have
   filled. That number decides whether phase A is built.

## 8. Phase A acceptance (T-1489)

- The adapter's specs run on recorded responses: normalisation, the region
  rule, live and private videos refused, and the duration and title filters.
- The placement spec places a club video on its one fixture, and keeps a video
  out as `no_fixture` / `ambiguous` exactly as `placeOnFixture` does.
- A store spec shows a fixture with a Highlightly clip is never overwritten.
- The unit count survives a restart (Redis).
- The health endpoint and the watchdog condition report the YouTube feed.
- With an empty key: no queue, no request, no row.
