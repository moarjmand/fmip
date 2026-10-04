# What only the maintainer can do

**Why this file exists.** An agent session can write, test, review and merge, but
there are things it must not do: create an account, spend money, hold a secret,
touch a physical device, or make a judgement the blueprint does not already
contain (`CLAUDE.md` §7). Those things are listed here, in the order in which
they unblock work, so that the list is a document rather than something
reconstructed from memory at the start of each session.

Each entry says what it is, **why it is yours and not an agent's**, what it
unblocks, and how to know it worked.

---

## Done

| | | When |
|---|---|---|
| The six policy defaults | Thresholds, the conduct ladder, how a grant ends, the two rules versions (`13-policy.md` §1–§5, D-059) | 2026-09-15 |
| The two member-facing texts | The platform rules and the contributor rules — the words a member accepts (`13-policy.md` §4, §5) | 2026-09-15 |
| The news licence question | Free publisher feeds, rights carried per source rather than assumed (D-061) | 2026-09-15 |
| The public preview | A Render service and a Neon database. Live at `https://fmip-preview.onrender.com`; the stream carries over the single published port, which is what T-086 was for (D-064) | 2026-09-15 |
| The launch review | Phase 0 and Phase 1 exit criteria signed one at a time against CI and the preview; the real-fixture clause is re-checked on the first real deployment (D-071) | 2026-09-19 |
| The viewing licence | Decided by delegation: the editorial desk, link-only, per territory (D-069) | 2026-09-18 |
| The data plan | API-Football Pro bought, 7,500 requests a day (D-076) | 2026-09-21 |
| The production deploy | Live at `https://traveltohormuz.ir` on a Hetzner server, backups off-site, restore drill passed | 2026-09-25 |
| Training on the feed's data | Allowed: the model learns from our own records of it (D-083, T-511) | 2026-09-26 |
| A native app | Not now: the installable web app is the mobile product (D-084, T-320) | 2026-09-26 |

These were judgements, not tasks: what a platform asks of its members is not
derivable from the code, and an agent that picked them would have been inventing
product.

---

## Now: what waits for you, in order (2026-10-01)

Everything an agent can do on its own is done or runs by itself (the
scheduled follow-up below). What is left is this list, most urgent first. For
every item: nothing goes into a chat -- keys, passwords and tokens go into the
server's `/opt/fmip/.env` by your own hand (`ssh fmip-prod`, then
`nano /opt/fmip/.env`; change a line that exists rather than adding a second
one) -- and `cd /opt/fmip && bash deploy/check-setup.sh` tells you whether it
took. Its output holds no secret and is safe to paste to whoever is helping.

1. **Renew the data plan before 2026-10-21 10:29 UTC** (a purchase). The Pro
   plan ends then; a prepaid plan that ends falls back to the free one (100
   requests a day), and scores, schedules and match details stop. On
   `https://dashboard.api-football.com`, signed in with the buying account,
   choose Pro again for 1, 3, 6 or 12 months (longer is cheaper per month,
   nothing is refundable) and pay, a few days early. Nothing changes on the
   server. *How to know:* the provider's `/status` shows the new end date (an
   agent reads it from inside the API container without seeing the key), and
   `check-setup.sh` keeps `Match data ... ON`.
**Done on 2026-09-30:** e-mail (T-330) through a dedicated Gmail with an app
password, `SMTP_URL=smtp://NAME%40gmail.com:APP_PASSWORD@smtp.gmail.com:587`
(Brevo asked for a non-Iranian phone number and Mailjet was unreachable; the
server's provider blocks outbound 465 and 25, so 587 with STARTTLS is the one
that works), with "Forgot password" delivering to the maintainer; push
(`webpush`); the language model (T-400, Mistral's free plan,
`ministral-14b-latest`); and the Telegram channel (T-524, `@fmipbot1`, the
bot an administrator allowed to post). `check-setup.sh` shows all four ON.

2. **One prediction of your own, from 2026-10-08** when club football
   resumes: sign in, predict an upcoming match before kick-off, and after it
   see it settled on your profile. The real-fixture re-check of D-071 needs a
   member's settled prediction.
3. **Optional: an editor for broadcast listings (T-310)**:
   `cd /opt/fmip && docker compose run --rm -T migrate node scripts/grant-role.mjs --email <address> --role editor --reason "enters broadcast listings"`;
   the desk appears at the bottom of every match page for them.
4. **Match highlights (T-1366), once you have subscribed to Highlightly**:
   the key into `.env`, then map the competitions and, as they queue, the
   teams -- §13.

**Meanwhile, by itself.** The scheduled task `fmip-server-followup` runs every
six hours from the Claude desktop app on your laptop, so it needs the laptop
awake and the app open until about mid-October. It finishes the detail
backlog and the adoptions, fits the line-up term (T-534), ticks Iran's first
forecast (T-512), measures the first match day (T-501, T-504), reports the
candidate model against the published one (T-535) and re-checks D-071 on real
matches. When it says its work is done, turn it off in the Scheduled tasks
list.

---

## 1. The Arabic translator (T-150)

**Why yours.** It is the one thing in this product that must be done by a person
who speaks the language. T-151 already settled the workflow and the rule that
makes the wait safe: **an untranslated string is visibly untranslated, never
machine output presented as a translation.** So `/ar` can ship incomplete and
still be honest — which is why this is not blocking anything.

**What it unblocks.** Nothing. It improves `/ar`, which already routes, formats,
sorts and lays out right-to-left correctly (T-152, T-153).

**What the translator gets, since 2026-09-18 (T-302, D-066).** One file:
`apps/web/src/i18n/catalogues/ar.json`. Every key the product shows, the
English beside it, and a `text` to fill in with a `status` to set --
`translated` when they have written it, `reviewed` when a second fluent
speaker has read it. Nothing to install, no account to make; the work comes
back as a pull request, and `/ar` shows it in place the moment it merges. The
same file exists for the other six languages.

## 2. The paid data provider (T-100)

**Why yours.** It is a purchase. `CLAUDE.md` §7: no session spends money.

**What it unblocks.** T-101 (player-level match statistics), T-103 (injuries and
suspensions), and the rest of the depth that a free tier does not carry.

**What the decision rests on.** The bake-off ran seven times and is written up in
`docs/05-data-providers.md`; D-049 records what was decided when this was first
deferred. T-025 — the Phase 1 version of the same gate — is deferred under D-033
and stays deferred until you say otherwise.

**What the evidence says, if you want a recommendation.** API-Football
(`api-sports.io`), the entry paid tier: in the bake-off it answered every call
and filled the most fields by a wide margin — 90% of fixture fields, 99% of
line-up fields, 95% of detail, with a live clock and no feature gating between
tiers. Its free tier failed for one reason only, the seasons it can see
(2022-2024), which a paid plan ends. The daily need is 1,000-1,500 requests,
so the ~$19 tier's 7,500 a day is roughly five times what the product uses;
the figures are from 2026-09-08 and belong re-checked on the vendor's page
before paying. Buy it directly from `api-sports.io` rather than through
RapidAPI: the adapter sends `x-apisports-key`, which is the direct API's
header.

**Bought on 2026-09-21 (D-076): API-Football Pro, 7,500 requests a day.**
What is below is what you do with it.

**The day it is bought (T-028, 2026-09-20).** In the server's `.env`:
`API_FOOTBALL_KEY` = the key, `INGESTION_SOURCE=api_football`,
`INGESTION_SCHEDULE=on`, and optionally `API_FOOTBALL_DAILY_BUDGET` = the
plan's daily limit so a ceiling is enforced here rather than discovered
mid-match. Then `docker compose restart api`. Nothing else, and no code
change: the profile was written before the purchase so that the purchase is
one line.

`bash deploy/check-setup.sh` will then say `Match data ... IDLE`, not `ON`,
and it is right to: a freshly migrated database holds no competition, so the
jobs have nothing to ask for and no fixture will ever appear however correct
the four lines above are. It becomes `ON` -- with the count of competitions
in season beside it -- after the catalogue below. The switch and the
catalogue look identical from the environment alone, which is why the check
reads the database rather than the environment (T-071).

**Then the catalogue, once (T-029, D-077).** A licence alone writes nothing:
the countries, competitions and seasons it covers have to exist here first,
and a deployment that has just been migrated holds none of the leagues --
no migration writes one, and the seed is refused in production. The countries
are already there: FIFA's 211 member associations arrive with the migrations
(D-078), because registration needs one. In this order, with `--by` naming the administrator you granted
yourself (the dates are the ones the provider gave on 2026-09-21):

```bash
catalog() { docker compose run --rm migrate node scripts/catalog.mjs "$@"; }

# 1. Countries: already there (D-078). Only one outside FIFA's list needs
#    catalog --add-country --code <FIFA trigram> --name "<name>" [--iso2 <XX>]

# 2. Competitions, by the provider's ids.
catalog --add-competition --external-id 39  --name "Premier League" --kind league --scope domestic --country ENG --by you@your-domain
catalog --add-competition --external-id 140 --name "La Liga"        --kind league --scope domestic --country ESP --by you@your-domain
catalog --add-competition --external-id 78  --name "Bundesliga"     --kind league --scope domestic --country GER --by you@your-domain
catalog --add-competition --external-id 135 --name "Serie A"        --kind league --scope domestic --country ITA --by you@your-domain
catalog --add-competition --external-id 61  --name "Ligue 1"        --kind league --scope domestic --country FRA --by you@your-domain
catalog --add-competition --external-id 2   --name "UEFA Champions League" --kind cup --scope continental --by you@your-domain

# 3. Their current seasons.
catalog --add-season --competition 39  --label 2026/27 --start 2026-08-21 --end 2027-05-30 --current --by you@your-domain
catalog --add-season --competition 140 --label 2026/27 --start 2026-08-15 --end 2027-05-30 --current --by you@your-domain
catalog --add-season --competition 78  --label 2026/27 --start 2026-08-28 --end 2027-05-22 --current --by you@your-domain
catalog --add-season --competition 135 --label 2026/27 --start 2026-08-22 --end 2027-05-30 --current --by you@your-domain
catalog --add-season --competition 61  --label 2026/27 --start 2026-08-21 --end 2027-05-29 --current --by you@your-domain
catalog --add-season --competition 2   --label 2026/27 --start 2026-07-07 --end 2027-01-27 --current --by you@your-domain

catalog --list    # "6 of 6 competition(s) mapped to api_football are in season"

# 4. The Champions League's stages. A domestic league's table falls back to the
#    competition's kind; a cup's has only its stages to go on, so without the
#    league stage the Champions League has no table at all.
catalog --add-stage --competition 2 --name "1st Qualifying Round" --kind qualifying --order 1 --legs 2 --by you@your-domain
catalog --add-stage --competition 2 --name "2nd Qualifying Round" --kind qualifying --order 2 --legs 2 --by you@your-domain
catalog --add-stage --competition 2 --name "3rd Qualifying Round" --kind qualifying --order 3 --legs 2 --by you@your-domain
catalog --add-stage --competition 2 --name "Play-offs"            --kind playoff    --order 4 --legs 2 --by you@your-domain
catalog --add-stage --competition 2 --name "League Stage"         --kind league     --order 5 --by you@your-domain
```

A stage's name is the provider's round without its matchday ("League Stage"
for "League Stage - 1"), and each line reports how many matches already held
it attached. The knockout rounds are added the same way once they are drawn,
under the names their matches arrive with; only the league stage has a table,
so until then nothing is missing but a label. The standings job says when a
table is short: every team of the provider's table named in its `partial`
message is a table we do not hold. Found on the server on 2026-09-26, when the
first matchday of the league stage had been played and our table was empty.

Every one of these is safe to repeat: a country, competition or season that
already exists is reported and left alone. The whole sequence was run on an
empty, freshly migrated database on 2026-09-24 before it was written here; an
earlier version of this section began with `--adopt-teams` and could not have
worked, because a domestic league needs a country and there was no way to add
one.

Then the backfill below. Its first pass writes few fixtures: the provider
names clubs the catalogue does not hold yet, and each is queued rather than
guessed at. Adopt them, and backfill again:

```bash
catalog --list                          # the queued clubs, by the provider's name
catalog --adopt-teams --dry-run         # what would be created
catalog --adopt-teams --by you@your-domain
```

**Then the people and the grounds (D-079), once the post-match job has run
for a while.** It asks about every finished match (T-102), and every player,
coach, referee and ground it names that the catalogue does not hold is queued
rather than guessed at -- so until they are adopted, line-ups are empty and a
goal has no scorer. Adopting them also tells the job to ask those matches
again:

```bash
catalog --adopt-people --by you@your-domain
catalog --adopt-venues --by you@your-domain
```

Run the pair again whenever `catalog --list` shows people waiting: new
signings and substitutes keep arriving all season.

**Then the model's side (D-080).** The forecast model and the Power Index are
fitted on football-data.co.uk's results and Club Elo (D-016), which a fresh
deployment does not hold, and they know clubs by those sources' names. Load the
history, say which division each league's results are in, and write the bridge
from our clubs to their names:

```bash
docker compose run --rm model python -m fmip_model.training.load football-data \
  --seasons 2324 2425 2526 2627 --divisions E0 SP1 D1 I1 F1
docker compose run --rm model python -m fmip_model.training.load clubelo --days 2026-09-20

catalog --set-division --competition 39  --division E0  --by you@your-domain
catalog --set-division --competition 140 --division SP1 --by you@your-domain
catalog --set-division --competition 78  --division D1  --by you@your-domain
catalog --set-division --competition 135 --division I1  --by you@your-domain
catalog --set-division --competition 61  --division F1  --by you@your-domain
catalog --alias-training --by you@your-domain
```

The last line reports, per division, how many of the newest season's results
agree with ours -- same day, same two clubs, same score. Anything short of all
of them is a club under the wrong name. Load the current season's file again
each week, and after a promotion add the new club's line to
`packages/db/scripts/data/training-aliases.csv`.

An adopted club gets its name and nothing invented; `--map` is for when the
provider means a club you already hold.

**A league only our own records cover (T-512, D-083).** Iran's league is not in
football-data.co.uk, so its history is the feed's, as we recorded it. Add and
backfill its past seasons (section 2, "A past season"), then give it a division
of its own and load it:

```bash
catalog --set-division --competition 290 --division IR1 --by you@your-domain
docker compose run --rm -T model python -m fmip_model.training.load records --divisions IR1
```

The load names our team ids as the training names and writes their aliases
itself, so there is no list to keep and no `--alias-training` for it. A
division another source already holds is refused. The model service reloads
such a division once a day before its first fit, so new results arrive without
a weekly step.

**Phase 6's eight competitions (T-502, T-503), as run on 2026-09-26.** The ids,
dates and divisions are the provider's and football-data.co.uk's on that day;
the alias list already carries the six leagues' clubs:

```bash
catalog --add-competition --external-id 40  --name "Championship"         --kind league --scope domestic --country ENG --by you@your-domain
catalog --add-competition --external-id 88  --name "Eredivisie"           --kind league --scope domestic --country NED --by you@your-domain
catalog --add-competition --external-id 94  --name "Primeira Liga"        --kind league --scope domestic --country POR --by you@your-domain
catalog --add-competition --external-id 203 --name "Süper Lig"            --kind league --scope domestic --country TUR --by you@your-domain
catalog --add-competition --external-id 144 --name "Belgian Pro League"   --kind league --scope domestic --country BEL --by you@your-domain
catalog --add-competition --external-id 179 --name "Scottish Premiership" --kind league --scope domestic --country SCO --by you@your-domain
catalog --add-competition --external-id 3   --name "UEFA Europa League"     --kind cup --scope continental --by you@your-domain
catalog --add-competition --external-id 848 --name "UEFA Conference League" --kind cup --scope continental --by you@your-domain

catalog --add-season --competition 40  --label 2026/27 --start 2026-08-14 --end 2027-05-01 --current --by you@your-domain
catalog --add-season --competition 88  --label 2026/27 --start 2026-08-07 --end 2027-05-23 --current --by you@your-domain
catalog --add-season --competition 94  --label 2026/27 --start 2026-08-07 --end 2027-05-16 --current --by you@your-domain
catalog --add-season --competition 203 --label 2026/27 --start 2026-08-14 --end 2027-05-23 --current --by you@your-domain
catalog --add-season --competition 144 --label 2026/27 --start 2026-08-07 --end 2027-05-22 --current --by you@your-domain
catalog --add-season --competition 179 --label 2026/27 --start 2026-07-31 --end 2027-04-10 --current --by you@your-domain
catalog --add-season --competition 3   --label 2026/27 --start 2026-07-09 --end 2027-01-28 --current --by you@your-domain
catalog --add-season --competition 848 --label 2026/27 --start 2026-07-07 --end 2026-12-17 --current --by you@your-domain

docker compose run --rm model python -m fmip_model.training.load football-data \
  --seasons 2324 2425 2526 2627 --divisions E1 N1 P1 T1 B1 SC0
catalog --set-division --competition 40  --division E1  --by you@your-domain
catalog --set-division --competition 88  --division N1  --by you@your-domain
catalog --set-division --competition 94  --division P1  --by you@your-domain
catalog --set-division --competition 203 --division T1  --by you@your-domain
catalog --set-division --competition 144 --division B1  --by you@your-domain
catalog --set-division --competition 179 --division SC0 --by you@your-domain

# Then: backfill, --adopt-teams, backfill again, the cups' stages (step 4's
# way, under the round names their matches arrive with), --alias-training.
```

**Their order on the scores page (T-504)**, after a member's own favourites.
Nothing in the data says which league a reader looks for first, so it is
stated by you. **From T-1162 (D-154) it is set in the console:** open
`/en/admin/competitions` as an administrator, give each competition its place
(1 first; empty clears it) with a reason, and the scores page and the homepage
show the new order on their next render. Each change is recorded in the audit
log with the place it had before. The command below still works and makes the
same audited change (with `--by`), which is the quicker way to set all fifteen
at once on a fresh deployment; `--order 0` clears a place, and a competition
without one sorts after every stated one by country and name:

```bash
n=1; for id in 2 39 140 135 78 61 290 3 848 40 88 94 203 144 179; do
  catalog --set-order --competition $id --order $n --by you@your-domain; n=$((n+1))
done
```

The provider's coverage flags on that day: all eight have events, line-ups,
match and player statistics and a table; availability (injuries) is missing
for Primeira Liga, the Belgian Pro League, the Scottish Premiership and the
Conference League, and those match pages say so.

**Then backfill the season, once (T-030).** The scheduled job asks for a window
around now, so a deployment licensed today knows about this week and nothing
before it -- and the standings writer then refuses the table, correctly,
because it disagrees with the matches you hold.

Open `/en/admin` as an administrator, find **Backfill the current seasons**
under Ingestion, give a reason and submit. It reads each current season's own
span from the catalogue, to the season's end (T-505), so the season you added
above is the season it fetches, and it appears in the same list as every other
run -- a `fixtures` run scoped `backfill` -- with your reason in the audit log.

There is no `curl` for this and there is not meant to be: Caddy hands every
public path to the web app and the browser never reaches the API directly, so
the page is the way in, carrying your own session. On the server itself the
same act is a command (T-502), for when you are there anyway adding a
competition with `catalog.mjs`:

```bash
docker compose run --rm -T api node dist/cli/backfill.js --by you@your-domain --reason "why"
```

It checks that `--by` is an administrator, writes the same audit row as the
page before a request is spent, and never starts a second scheduler. On a new deployment run it
twice -- once to learn the clubs, once after adopting them -- and after that
once per new season; the schedule keeps it fresh.

**A past season, for the model (T-512, D-083).** Add it to the catalogue as
not current, with the provider's own dates, then backfill it by its label:

```bash
docker compose run --rm -T migrate node scripts/catalog.mjs --add-season --competition 290   --label 2025/26 --start 2025-08-18 --end 2026-07-22 --by you@your-domain
docker compose run --rm -T api node dist/cli/backfill.js --by you@your-domain   --reason "history for the model" --season 2025/26
```

Every competition holding a season of that label is read, over that season's
span only; the run's scope says `backfill 2025/26`. Leave `--current` off, or
the past season becomes the one the site shows.

## 3. The production deploy (T-074)

**Why yours.** It runs on a machine that does not exist yet, and buying it is a
purchase.

**Done on 2026-09-25.** You bought the server (Hetzner CPX22) and the domain
sits behind Cloudflare; the runbook ran on it, the zero-downtime check passed on
the real host (47 of 47), and the load test was rerun there. FMIP is live at
`https://traveltohormuz.ir` with real fixtures, an administrator, nightly
off-site backups and a passed restore drill. The record is the 2026-09-25 row of
`docs/09-deploy.md`.

**Still yours on it:** the server's SSH settings (step 1 of the runbook now
turns password logins off; the live server predates that line), and the three
optional capabilities `check-setup.sh` lists as `off`.

## 4. The launch review (T-084)

**Why yours.** It is a judgement — does this meet the exit criteria in
`01-roadmap.md`. Nothing else in the project can make it.

**The install tap is done.** It was the other half of this item: a physical
Android device confirming that Chrome itself offers to install the app, which a
headless browser cannot assert. On 2026-09-17 you opened the preview on Android
and Chrome's menu showed **Install app** — the browser's own offer, not the
always-present "Add to Home screen". It could not have shown it a day earlier:
the images shipped without `public/`, so the service worker and every icon were
404 on every deployment, and no local check could see it (`04-tasks-phase-1.md`,
T-082). That was found by asking the deployment rather than the build.

**Outcome:** signed on 2026-09-19 (D-071), conditional on the real-fixture
re-check after T-074.

## 5. Two members on the preview -- withdrawn on 2026-09-17

This asked you to register two accounts on the preview and fish their
verification links out of the service log, so the rest of Phase 3's exit
criteria could be walked. It is gone, and nothing replaced it for you.

Those criteria are now `apps/web/tests/e2e/journeys/social.spec.ts`: two
members, registered through the real form and verified from the real message,
against the real API, database and seed, on every pull request. The preview
walk would have been one observation, on one day, by one person, and it could
not have been repeated without that person. This is one on every commit -- and
it checks the criterion the preview could never have checked at all, because
messages arriving in real time needs a Redis the preview does not have.

If you ever want members on the preview for your own use, the procedure was:
register at `/en/register`, find the line beginning `[mail] to=` in the Render
logs, and open the `verify-email` link in it. Nothing in the project waits on
it any more.

## 6. Standing: approving contributors and analysts

**Why yours.** `13-policy.md` §3: a grant is a row that names its approver and
their reason. "The system approved it" is not an approver, which is the whole
point of recording one.

Eligibility is computed and never grants (T-250). What you see is a list of
members who **could** be approved; approving is a separate act, by a person,
with a reason that is stored.

**How you actually grant one (T-076, 2026-09-20).** On the server:

```bash
docker compose run --rm migrate node scripts/grant-role.mjs --list
docker compose run --rm migrate node scripts/grant-role.mjs \
  --email them@their-domain --role editor --reason "enters viewing listings" \
  --by you@your-domain
```

`--revoke` takes it back and wants the same reason. Roles: `admin`, `founder`,
`moderator`, `editor`. Your own first grant is in `09-deploy.md` under "The
first administrator" -- until it exists, `/en/admin` opens for nobody.

## 7. Phase 4: what the agent built and what waits for you

Written on 2026-09-18, when every Phase 4 task that needs nothing from you
was done (`04-tasks-phase-4.md`). What is left is yours, and each item below
is buildable the day you decide it.

**Translations (T-305).** The machinery exists: `POST /admin/articles/:id/
translations` writes a fluent speaker's version of a headline (and summary,
where the source grants one) as a new immutable version, and `POST .../
translations/:language/review` has a second speaker approve it (T-304). Both
need the `editor` role, granted with a reason in `user_role`. The interface
strings are the same job in another file: `apps/web/src/i18n/catalogues/
<locale>.json`, one entry per key with the English beside it (D-066). Nothing
here is machine-translated, and nothing will be (T-151).

**The viewing licence (T-310), decided on 2026-09-18 by delegation (D-069).**
You asked the agent to choose; under the rule that nothing is bought, it
chose the editorial desk: editors declare coverage per season and territory
and enter listings and official highlight pages by hand, link-only, every
row audited (T-313). What waits for you is editors' time -- grant `editor`
to whoever enters listings -- and a licence only if you ever want thumbnails
or embeds, which would be a second source beside the desk, not a replacement.

**A native app (T-320).** Decided on 2026-09-26: not now (D-084); the
installable web app is the mobile product. The contracts stay proven
platform-independent (T-321), so if the question returns, the app is a second
client of the same endpoints.

**Notification delivery (T-330).** Built end to end on 2026-09-20 without a
vendor: every kind leaves as the inbox's own sentence and route, e-mail is
SMTP (D-073, any service's credentials) and push is Web Push with your own
keys (D-074, no account). `/health/delivery` says both channels are absent
until the server has `SMTP_URL` + `DELIVERY_EMAIL_FROM` and a VAPID key pair
-- after the deploy (T-074), because credentials live on a server. §8 has
the exact lines. Campaigns (T-332) are built too (D-075): an audience
is a saved filter over what a member can see about themselves, and a send
goes through the inbox, so a member's preference decides.

## 8. The exact steps, per item

Written on 2026-09-18 after PR #200, when the agent's share of every open task
was merged and the maintainer asked for each remaining step spelled out. For
every item: what only you can do, in order, and what the agent builds the
moment it is done. Nothing below asks the agent to guess at a decision, a
purchase or a licence (`CLAUDE.md` §7).

**How to tell whether any step below worked.** One command on the server,
after every change to `.env`:

```bash
cd /opt/fmip && bash deploy/check-setup.sh
```

It says what this deployment can and cannot do -- the containers, the public
site through Caddy, and whether e-mail, push, a language model and match-data
ingestion are on -- and for each one that is off, the line to add. `off` is
never a failure there: all four are absent by design until someone turns them
on, and the product says so on the surface rather than pretending. What it
catches is the likeliest mistake in everything below -- a credential filled in
and its switch left at the default, which from outside looks exactly like
having done nothing. It prints no key, password or connection string, only
`set` or `empty`, so its output is safe to paste to whoever is helping you
(T-075).

**T-305, the strings.**
1. Find one fluent speaker for each of `es`, `fr`, `de`, `it`, `pt`, `tr`,
   `ar`; a second reader per language if you want `reviewed` rather than
   `translated`.
2. Send each one `apps/web/src/i18n/catalogues/<locale>.json`. Every entry has
   the English in `source`; they fill `text` and set `status`. A plural entry
   takes one form per category their language has, no more and no fewer
   (D-067). Nothing to install and no account to make.
3. Their work comes back as a pull request. CI's Verify runs
   `pnpm --filter @fmip/web i18n:catalogues --check` and `messages.spec.ts`,
   which refuse a stale `source`, a missing key, a status the text does not
   support and a plural missing a form.
4. `/admin` shows each language's percentage; the picker offers a language the
   day it crosses `SHIPPABLE_COMPLETENESS` (T-306), with no deploy decision
   in between.
5. Drafts were offered and declined on 2026-09-19: the translators are
   yours, and you asked not to be reminded. Nothing is drafted, and nothing
   about T-305 is raised again unless you raise it.

**T-310, the viewing licence: decided (D-069).** The editorial desk, chosen
by the agent at your request on 2026-09-18. Nothing to decide now: grant
`editor` to whoever enters listings -- the desk is at the bottom of any
match page for them (declare coverage first, then list) -- and revisit only
for a licence with more rights.

**T-320, the native app.** Decided on 2026-09-26: not now (D-084). If it
comes back, four things, all yours: whether at all; the
framework (the roadmap names Expo, and `CLAUDE.md` §2 wants a decision entry
before it is added); the two store accounts, Apple Developer Program and
Google Play Console, opened in your name and paid for; and one device per
platform, because T-322's right-to-left acceptance is checked on a device and
not in a browser. Then the agent builds T-322 and T-323; T-324 waits for
T-330's provider.

**T-074, the deploy.** You asked on 2026-09-19 for all of it to be done
by the agent, by any route. The route has a wall in it: the machine is a
purchase and its access is a credential, and neither is the agent's to make
-- the standing rule, not a preference. What the agent does instead is
below this list: rehearse the production stack on this laptop after every
change that touches it, and keep the runbook and the compose file current,
so the day the machine exists the steps are only the ones here. In order: buy the VPS (`09-deploy.md`, "What you need
before starting"); put the domain's DNS on Cloudflare; generate an SSH key on
your own machine; follow `09-deploy.md` §1 to §5; rerun `08-load-test.md`
against the server rather than a laptop; record the outcome in
`00-decisions.md`. The agent never holds the SSH key or the server's secrets,
which is why this cannot move without you.

**T-330, the provider.** Parked on 2026-09-19 at your request ("later").
After T-074, because a provider is a credential on a server. **E-mail is
built (D-073, 2026-09-20)** and takes any service's SMTP credentials: open
an account with a transactional e-mail service (Brevo, Mailjet, Postmark,
Amazon SES, or any relay), verify your domain there as it asks (a few DNS
records in Cloudflare), copy its SMTP host, port, user and password into the
server's `.env` as `SMTP_URL=smtps://USER:PASSWORD@HOST:465` (or
`smtp://HOST:587`), set `DELIVERY_EMAIL_FROM="FMIP <no-reply@your-domain>"`
and `DELIVERY_EMAIL_PROVIDER=smtp`, restart the API: `/health/delivery`
says `smtp`, and from that moment every notification and the verification
and reset mails go out. Nothing else to tell the agent. **Push is built too (D-074,
2026-09-20)**, as Web Push with your own keys, no account anywhere. On the
server, once:

```bash
cd /opt/fmip && docker compose run --rm --no-deps api npx web-push generate-vapid-keys
```

put the two keys it prints into `.env` as `VAPID_PUBLIC_KEY` and
`VAPID_PRIVATE_KEY`, set `VAPID_SUBJECT=mailto:you@your-domain` and
`DELIVERY_PUSH_PROVIDER=webpush`, restart the API. Members then turn push
on per device from Settings → Notifications → "On this device";
`/health/delivery` says `webpush`.

**T-332, campaigns.** Built on 2026-09-20 (D-075): audiences, campaigns and
the send through the inbox, administrators only, at `/admin/campaigns`.
Nothing from you.

**T-025 / T-100, the data plan.** §2 above has the recommendation and the
evidence behind it. The steps after paying are four lines in `.env` and a
restart, and `deploy/check-setup.sh` tells you whether they took. Until then
the product runs on the free split (`INGESTION_SOURCE=live`) or the
recordings, and every module neither reaches says `not_supplied` rather than
looking empty.

**T-084, the launch review.** Signed on 2026-09-19 (D-071), one criterion at
a time in chat; what remains is the re-check with real fixtures on the
server after T-074. The original steps, kept for that re-check:
read the exit criteria in `01-roadmap.md` and
in each `04-tasks-phase-*.md` against the public preview or the VPS, and
sign off in `00-decisions.md`. The agent can walk the public pages and
report what it sees, and did for the news pages on 2026-09-18 locally; the
preview itself refused the agent's browser that day, so the public
walk-through is yours or waits for a session whose browser is allowed there.

**The local database.** The development Postgres on this machine carries
rows from runs that did not finish -- on 2026-09-18: 28 teams named
`Test Home`, `Test Away` and `News Schema Team`, 33 fixtures on them, 27
`@example.test` accounts and 31 of their messages. Every API spec that
inserts a team was run alone that day and left nothing behind; what remains
is from interrupted runs. The rows are held by immutable tables (settlement,
forecast, evaluation, message tombstones), so the honest fix is a fresh
volume rather than a hand-written delete, and removing a volume is a step
the agent's sandbox refuses, rightly:

```bash
docker compose stop postgres && docker compose rm -f postgres
docker volume rm fmip_postgres-data
docker compose up -d --wait postgres
set -a; . ./.env; set +a
pnpm --filter @fmip/db build && pnpm --filter @fmip/db migrate:up && pnpm --filter @fmip/db seed
```

CI is unaffected: every run there starts from an empty database.

## 9. Phase 5: the intelligence layer waits on one key

Written on 2026-09-19, when the phase was planned (`04-tasks-phase-5.md`)
and its port built (D-070). Fourteen of its fifteen tasks need nothing from
you, because a language model is a provider behind a port with an honest
absence, exactly like delivery. The one that does is **T-400**: a key on the
server.

**What you do, after the deploy (T-074).** Open an account with the provider
you choose -- the first adapter drives Anthropic's Messages API, and a second
provider is an adapter beside it -- and put the key in the server's `.env`
as `ANTHROPIC_API_KEY`, with `INTELLIGENCE_PROVIDER=anthropic`. Nothing in
chat, nothing in a file the agent writes. `INTELLIGENCE_MODEL` names the
model (the reference's current default when empty) and `INTELLIGENCE_EFFORT`
is `low`, `medium` or `high`. Restart the API; `/health/intelligence` says
`configured`, and every Phase 5 surface starts answering. It costs per
generation at the provider's token prices, and nothing until the key exists.

**Testing before the deploy, for free (D-072, 2026-09-19).** You asked to try
Mistral's free tier first and to keep every model open later. Both are
built. On your own machine: in Mistral Studio, activate Free mode and create
an API key; in **your local** `.env` set `INTELLIGENCE_PROVIDER=mistral` and
`MISTRAL_API_KEY=` (the key; never in chat) and `INTELLIGENCE_MODEL=
ministral-14b-latest` -- on 2026-09-19 the free plan answered only the
Ministral models (3b, 8b, 14b); Small, Medium and Magistral came back 429
with a request limit of zero and Large 403, and the log names that as
"not in this workspace's plan". Start the API and open a finished match,
the search box with a question, and Following's briefing button. The same
two lines on the server later. Any other model: `INTELLIGENCE_PROVIDER=
openai_compatible` with `INTELLIGENCE_BASE_URL`, `INTELLIGENCE_API_KEY` and
`INTELLIGENCE_MODEL`, which covers a local runtime as well as a vendor.

**What the agent builds without it.** Every schema, contract, grounding gate,
surface and honest-absence sentence in the plan. With the key absent, each
surface says so in a sentence; nothing on the critical path is touched either
way.

---

## 10. Phase 6: the daily channel post waits on a bot and a channel (T-524)

Written on 2026-09-26, when the post itself (T-525) was built. Once a UTC
day, from 06:00 UTC, the API posts the day's matches still to come with the
statistical model's forecast, each linking to its match page, to a public
Telegram channel. It is labelled as the model's on every message and a day
with no match posts nothing. It is built and tested, and **off** until the
two values below exist on the server: `check-setup.sh` reports it as `off`,
which is the designed state, not a fault.

**Why it is yours.** Creating the bot and the channel is opening accounts,
and the bot's token is a secret. Nothing in chat, nothing in a file the
agent writes.

**What you do, on your own phone or computer, then on the server.**

1. In Telegram, open **@BotFather**, send `/newbot`, and follow its two
   questions (a display name, then a username ending in `bot`). It answers
   with the bot's **token**. Keep it to yourself.
2. Create the **channel** (New Channel), make it public, and choose its
   username -- the part after `t.me/`.
3. In the channel: Administrators, Add Administrator, find the bot by its
   username, and leave **Post messages** allowed. Without this, Telegram
   refuses every post.
4. On the server, in `/opt/fmip/.env`, add the two values:

   ```bash
   TELEGRAM_BOT_TOKEN=<the token from step 1>
   TELEGRAM_CHANNEL=@<the channel username from step 2>
   ```

   Optionally `CHANNEL_POST_HOUR=<0-23>` for an hour other than 06:00 UTC.
   Both values or neither: one alone stops the new API container at boot,
   and the rollout keeps the old one running and says so.
5. Roll the API onto them:

   ```bash
   cd /opt/fmip && bash deploy/rollout.sh api
   ```

**How to know it worked.** `bash deploy/check-setup.sh` shows `Daily channel
post ... ON telegram, from 6:00 UTC`, then after the next post hour the day
and `sent`. A day the channel refused (most often a bot that is not an
administrator yet) shows `refused` with a note; the API tries that day again
on the next hourly tick once you have fixed it. The post runs on the API
with `INGESTION_SCHEDULE=on`, the same one that fetches the fixtures.

## 11. National-team competitions (T-1332, D-179)

Four competitions, so Scores is not empty during a FIFA window: the UEFA
Nations League (5), international friendlies (10), the Asian Cup (7) and the
Africa Cup of Nations qualification (36), by the provider's ids. **Deploy
T-1332 first**: before it, a queued team carries no competition and
`--adopt-teams` would make every national team a club.

`--scope international` is what marks their teams as national teams (D-179);
the UEFA club cups stay `continental`. A season's label is the adapter's,
`YYYY/YY` from the provider's season year -- the provider's season 2026 is
`2026/27` here even for a calendar-year competition -- and a fixture whose
label has no season is refused, so these labels are not a choice. The
friendlies' start was not given with the others; `2026-01-01` is the start
of the provider's season year (the backfill then reads the year's earlier
windows too).

```bash
cd /opt/fmip
catalog() { docker compose run --rm -T migrate node scripts/catalog.mjs "$@"; }

# 1. The competitions.
catalog --add-competition --external-id 5  --name "UEFA Nations League"                   --kind cup        --scope international --by you@your-domain
catalog --add-competition --external-id 10 --name "Friendlies"                            --kind friendly   --scope international --by you@your-domain
catalog --add-competition --external-id 7  --name "AFC Asian Cup"                         --kind cup        --scope international --by you@your-domain
catalog --add-competition --external-id 36 --name "Africa Cup of Nations - Qualification" --kind qualifying --scope international --by you@your-domain

# 2. Their current seasons (the provider's seasons 2026, 2026, 2027 and 2027).
catalog --add-season --competition 5  --label 2026/27 --start 2026-09-24 --end 2026-11-17 --current --by you@your-domain
catalog --add-season --competition 10 --label 2026/27 --start 2026-01-01 --end 2026-11-17 --current --by you@your-domain
catalog --add-season --competition 7  --label 2027/28 --start 2027-01-07 --end 2027-01-20 --current --by you@your-domain
catalog --add-season --competition 36 --label 2027/28 --start 2026-03-25 --end 2027-03-28 --current --by you@your-domain
catalog --list    # with nothing queued: "19 of 19 competition(s) mapped to api_football are in season ..."

# 3. Learn the teams: the first pass writes almost nothing and queues them.
docker compose run --rm -T api node dist/cli/backfill.js --by you@your-domain --reason "national-team competitions (T-1332)"

# 4. Adopt them. --adopt-teams leaves every team seen in these four alone and
#    says how many; --adopt-national needs each one's country (FIFA trigram:
#    IRN, JPN, KOR, CIV ...), which you write into the list it prints.
catalog --adopt-teams --dry-run         # clubs only; "N national team(s) ... are left for --adopt-national"
catalog --adopt-national --dry-run > national-teams.csv
nano national-teams.csv                 # fill the second column of every line
catalog --adopt-national --file - --by you@your-domain < national-teams.csv

# 5. The matches, now that both sides of each are known.
docker compose run --rm -T api node dist/cli/backfill.js --by you@your-domain --reason "national-team competitions, after adoption (T-1332)"
```

`--adopt-national` adopts only an id the ingestion queued from one of these
competitions, refuses a code with no country (every FIFA member is there,
D-078) and a country that already has a national team (then the provider
means that one: `--map --type team --external-id <id> --to <its id>`), and
prints each refusal; run it again with the corrected lines, since what it
adopted is no longer waiting. The name column is for you and is never read.
The next international window queues teams not seen before: run step 4 again
then.

**After step 4: the sides that are not ours (T-1338).** The friendlies also
carry under-23, women's and a few club sides. They are not adopted, so they
stay in the queue, and until T-1338 every run that met one of their matches
said "N provider ids have no mapping and are queued for review" -- most runs
on `/health/ingestion` were partial for it, which hid the real gaps. Once
every senior men's national team is adopted (the step above), set the rest
aside: an ignored team's matches are skipped quietly, are not written and do
not make a run partial.

```bash
# Read the list first: it is every team still waiting whose last sighting was
# one of these four. A senior national team in it is one step 4 has not
# adopted yet -- adopt it, then list again.
catalog --ignore --type team --waiting-international --dry-run < /dev/null
catalog --ignore --type team --waiting-international --by you@your-domain \
        --reason "youth, women's and club sides of the international friendlies (T-1338)" < /dev/null
catalog --list --type team < /dev/null     # what still waits is what is still to decide
```

Each id is set aside with your address and the reason, in the queue
(`resolved_by`, `resolution_note`) and in the audit log
(`catalog.entity_ignored`); a team already adopted is reported and left
alone. For particular ids, list them in a file instead (first column, an
optional `provider_id` header, `#` comments; anything after the first comma is
for you and is never read) and pass `--file - < it` in place of
`--waiting-international`; `--type person` and `--type venue` work the same
way. A decision you want back:

```bash
printf '%s\n' 12345 67890 > back.csv     # the provider ids, one a line
catalog --unignore --type team --file - --by you@your-domain --reason "a senior side after all" < back.csv
```

puts them back in the queue (audited as `catalog.entity_unignored`); their
next match queues them again, and step 4 adopts them as usual.

**6. Stages.** A friendly has no competition context and needs none. The
other three are cups, and without a stage a Nations League match reads as a
knockout tie (its round, "League A - 1", has no "group" in it). List the
rounds the matches arrived with:

```bash
docker compose exec -T postgres psql -U fmip -d fmip -Atc "
  SELECT pm.external_id, f.round, count(*) FROM fixture f
    JOIN season s ON s.id = f.season_id AND s.is_current
    JOIN provider_mapping pm ON pm.internal_id = s.competition_id
     AND pm.provider = 'api_football' AND pm.entity_type = 'competition'
   WHERE pm.external_id IN ('5', '7', '36') AND f.stage_id IS NULL
   GROUP BY 1, 2 ORDER BY 1, 2"
```

and add one stage per round name without its matchday, as for the Champions
League in section 2. If the listing shows the names expected below, these are
the lines; a name that differs is written as the listing has it, and each
line says how many matches it attached (0 means the name is wrong):

```bash
catalog --add-stage --competition 5  --name "League A"    --kind group --order 1 --by you@your-domain
catalog --add-stage --competition 5  --name "League B"    --kind group --order 2 --by you@your-domain
catalog --add-stage --competition 5  --name "League C"    --kind group --order 3 --by you@your-domain
catalog --add-stage --competition 5  --name "League D"    --kind group --order 4 --by you@your-domain
catalog --add-stage --competition 7  --name "Group Stage" --kind group --order 1 --by you@your-domain
catalog --add-stage --competition 36 --name "Group Stage" --kind group --order 2 --by you@your-domain
# Only if the listing shows a preliminary round for 36:
catalog --add-stage --competition 36 --name "Preliminary Round" --kind qualifying --order 1 --legs 2 --by you@your-domain
```

What a reader then sees, and what is not there yet:

- **Scores** groups the four under "International" (no country), in the
  order the console gives them (`/en/admin/competitions`); without a stated
  place they sort after every stated one.
- **A national team's page** says it is a national team and shows its
  country; its squad photos come from its matches' line-ups (the squads job
  asks clubs only).
- **No forecast**: the model has no history for national teams, and the
  match page says "This competition's history is not in the model's training
  data." Predictions and consensus work as for any match.
- **Group tables (T-1333, D-180).** The provider's fixtures do not name a
  match's group; its tables do. The hourly standings run (minute 23) gives
  each match of a `group` stage the group both its teams are in and then
  compares the provider's group tables with ours, group by group. Nothing
  to run by hand: once step 6's stages are in, the next standings run fills
  the groups of the matches already stored, and every later run the new
  ones. Until a match's stage exists it has no group, the match page says
  its group table is not supplied, and the data-quality page lists its
  teams under "table disagrees" ("ours has no row") -- the stage is what is
  missing, not matches. A Nations League group reads "Group 1"; its league
  is the stage. To see what was written:

  ```bash
  docker compose exec -T postgres psql -U fmip -d fmip -Atc "
    SELECT pm.external_id, st.name, f.group_name, count(*) FROM fixture f
      JOIN stage st ON st.id = f.stage_id AND st.kind = 'group'
      JOIN season s ON s.id = f.season_id AND s.is_current
      JOIN provider_mapping pm ON pm.internal_id = s.competition_id
       AND pm.provider = 'api_football' AND pm.entity_type = 'competition'
     WHERE pm.external_id IN ('5', '7', '36')
     GROUP BY 1, 2, 3 ORDER BY 1, 2, 3"
  ```

  A row with an empty group is a match whose teams the provider's tables do
  not put in one group (or do not name): it stays without one rather than
  take a guessed group.
- **The Asian Cup's knockout rounds** are played after 2027-01-20. When the
  provider publishes them, run step 2's line for 7 again with the new end
  date (it updates the season), then add the knockout stages under the names
  the matches arrive with.
- **People and grounds**: national-team line-ups bring players the clubs did
  not; `--adopt-people` and `--adopt-venues` as in section 2.

## 12. Watch listings by default (T-1360)

Instead of listing every match by hand, say once which service carries a
competition in a territory; the listings follow (D-181). Coverage first, as
always: a default is refused until the competition's current season is
declared covered for viewing in that territory.

```bash
cd /opt/fmip
viewing() { docker compose run --rm -T migrate node scripts/viewing.mjs "$@"; }

viewing --list-broadcasters
viewing --add-broadcaster --name "Varzesh TV" --kind tv --homepage https://example.test --by you@your-domain
# prints the broadcaster's id (an existing one with exactly that name is printed, not duplicated)

# Coverage of the competition's current season (39 = the provider's Premier League id; a uuid works too).
viewing --declare --competition 39 --territory IR --module viewing --state available \
        --note "the broadcaster's published schedule" --by you@your-domain

# The default: creates it and lists the covered upcoming matches at once; the hourly job keeps it up.
viewing --set-default --competition 39 --territory IR --broadcaster <broadcaster id> --access free \
        --url https://example.test/live --note "the broadcaster's published schedule" --by you@your-domain
viewing --list-defaults --territory IR
viewing --remove-default --id <default id> --reason "the rights moved" --by you@your-domain

# One match on one more service, from the day's published schedule (T-1362):
viewing --upcoming --competition 290 --territory IR --days 2     # provider ids, Tehran times, what is listed
viewing --list --fixture <provider fixture id> --territory IR --broadcaster <broadcaster id> --access free         --url https://example.test/live/tv3 --note "the day's published schedule" --by you@your-domain
```

Add `--dry-run` to any write to see what it would do and keep nothing.
`--by` must be an account holding `admin` or `editor`; every write is
audited as the console audits it. A competition is never named by its name.
One match on another service: remove that listing on the match page (it will
not come back), then list the right one. Removing a default deletes its
listings for matches not yet kicked off and keeps the rest.

The same work has a page (T-1361): **Admin → Watch listings**
(`/en/admin/viewing`), open to editors and administrators. Choose a territory
(IR unless you change it) and a competition; the page shows the current
season's coverage there with a form to declare it, the broadcasters with a
form to add one, the standing defaults (each removable with a reason) with a
form to add one, and the next days' matches (7 unless `days` says otherwise,
up to 21). Tick matches -- covered ones with nothing listed start ticked, an
uncovered one cannot be ticked -- choose a service, an access and the official
page, and press "List selected"; the page says how many listings it created
and how many it left because they were already there. Each listing can be
taken down with a reason below the table. Times are in UTC.

## 13. Match highlights from Highlightly (T-1366, D-184)

What it does once the key is in: every two hours the server asks Highlightly
for the **verified** highlights (the clubs' and leagues' own uploads) of
matches that finished in the last two days, and the match page and match
lists show **Official highlights (LaLiga)** -- a link to the original video,
never a player on our page. Each clip is shown only in the territories
Highlightly says it may be watched in. A highlight page the desk entered by
hand for the same match and territory wins over the feed's.

Until the key is in, all of it is off and harmless: no request, nothing
stored, and `check-setup.sh` shows `Highlights off`.

**1. The key.** After subscribing (Pro, a separate budget from API-Football),
copy the API key from Highlightly's dashboard into the server's `.env` by
your own hand -- never into a chat:

```bash
ssh fmip-prod
nano /opt/fmip/.env          # the line HIGHLIGHTLY_KEY=... (it is already there, empty)
                             # optional: HIGHLIGHTS_DAILY_BUDGET=5000 (empty means 5000; the plan allows 7,500)
cd /opt/fmip && bash deploy/rollout.sh api
bash deploy/check-setup.sh   # Highlights  ON  every 2 hours ...
```

**2. Tell it which of our competitions are which at Highlightly** (once per
competition; never by name, rule 1). Highlightly's league id is in its
dashboard and in `/leagues` on its documentation page. `<our competition
uuid>` is the id at the end of the competition's page address on the site.

```bash
cd /opt/fmip
catalog() { docker compose run --rm -T migrate node scripts/catalog.mjs "$@"; }
catalog --map --provider highlightly --type competition --external-id <Highlightly league id> \
        --to <our competition uuid> --by you@your-domain
```

**3. The teams, as they arrive.** Each run puts the Highlightly teams it saw
in a mapped competition into the queue with their names. Place each one on
the team we already hold (the id at the end of its team page's address).
Do **not** use `--adopt-teams` for Highlightly: that would create a second
copy of a club we already have.

```bash
catalog --list --type team --provider highlightly          # who is waiting, with Highlightly's ids and names
catalog --map --provider highlightly --type team --external-id <Highlightly team id> \
        --to <our team uuid> --by you@your-domain
```

**How to know it works.** `bash deploy/check-setup.sh` shows the newest run
(how many clips it stored, today's requests against the ceiling) and, while
competitions or teams are still unmapped, a note saying how many. The same
facts, with the time of the run, are at `GET /health/highlights` on the API.
On the site: a match that finished in the last two days in a mapped
competition with both teams mapped shows the link within a few hours of the
clubs uploading it. The API log names every clip it kept out and why:
`docker compose logs api | grep highlights.unmatched`.

**A wrong clip.** On the match page, the desk's "remove highlight" with a
reason takes the feed's clip down in every territory, for good (audited).
