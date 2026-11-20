# @fmip/social-video

Remotion compositions for the social posts' short videos (D-454). This package is **T-1931's
measurement spike**: one representative composition, the matchday preview, and the instrument that
measured what rendering it costs under the worker's limits. It is private, imported by nothing, not
a compose service and not deployed. The product's composition is T-1935 and the worker is T-1932.

## What is here

| Path                                                    | What it is                                                                                                                                                                                                        |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/props.ts`                                          | The clip's props and `clipProblems` / `parseClipProps`: one prediction product a clip (rule 6), the model's version required (rule 5), no picture or address key (D-454 point 5).                                 |
| `src/text.ts`                                           | The words, pure: London time in English; Tehran time, the Persian calendar and Persian digits in Persian; a countdown that runs from the props' `as_of`, never the clock.                                         |
| `src/tokens.ts`, `src/fonts.ts`                         | The social card's Night tokens and faces, and Vazirmatn; every face is loaded before the first frame.                                                                                                             |
| `src/compositions/matchday-preview.tsx`, `src/root.tsx` | `matchday-preview-9x16` (1080 x 1920) and `matchday-preview-4x5` (1080 x 1350), 15 s at 30 fps (450 frames). Logical properties and `dir` only.                                                                   |
| `fixtures/matchday-preview.json`                        | The fixed props: Kheybar Khorramabad v Esteghlal, the model's forecast as the public match page showed it on 2026-11-19 (`dixon-coles-elo@0.7.0`, 24.8 / 35.2 / 40.0). Read from the page, not from the database. |
| `scripts/prepare-assets.mjs`                            | Copies the faces into `public/fonts` (git-ignored) from `apps/web/public/fonts/card` and `@fontsource-variable/vazirmatn`. Nothing is fetched.                                                                    |
| `scripts/bundle.mjs`                                    | Builds the Remotion bundle into `build/` once. A render never bundles.                                                                                                                                            |
| `scripts/render.mjs`                                    | Renders one clip, or PNG frames, from the bundle and prints one JSON line: seconds, the container's cgroup memory peak, CPU seconds, the file's SHA-256, versions.                                                |
| `scripts/measure.sh`                                    | The whole measurement under `--cpus=1 --memory=1280m`.                                                                                                                                                            |
| `Dockerfile`                                            | Node 22 (bookworm-slim), Chrome Headless Shell's libraries as [Remotion's Docker page](https://www.remotion.dev/docs/docker) lists them, the headless shell, the bundle.                                          |

## How to render

In Docker, under the worker's limits (D-454 point 3), from the repository root:

```sh
docker build -f packages/social-video/Dockerfile -t fmip-social-video:t1931 .
# Docker Hub answers 403 from the maintainer's network; Docker's own mirror of the same image works:
#   --build-arg NODE_IMAGE=public.ecr.aws/docker/library/node:22-bookworm-slim

docker run --rm --cpus=1 --memory=1280m -v <absolute dir>:/out fmip-social-video:t1931 \
  node scripts/render.mjs --aspect 9x16 --concurrency 1 --out /out/clip.mp4

# PNG frames only, in Persian:
docker run --rm --cpus=1 --memory=1280m -v <absolute dir>:/out fmip-social-video:t1931 \
  node scripts/render.mjs --aspect 4x5 --locale fa --no-video --stills 45,225,449 --out /out/fa

# Everything T-1931 measured (Git Bash: pass the directory as E:/..., not /e/...):
bash packages/social-video/scripts/measure.sh <absolute dir>
```

Without Docker (no limits, so no measurement): `pnpm --filter @fmip/social-video bundle`, then
`pnpm --filter @fmip/social-video render -- --aspect 4x5`. The first render downloads Chrome
Headless Shell into `node_modules/.remotion`.

## Measurements (T-1931)

Machine: the maintainer's PC, an Intel Core i7-1065G7 (4 cores, 8 threads, 1.3 GHz base, a 15 W
laptop chip), 16 GB, Windows 11, Docker Desktop 29.8.2 on WSL2 (6 CPUs and 7.8 GB given to Docker,
kernel 6.18, cgroup v2). **The PC was shared with other work throughout** and never idle; how busy
it was is the last column, and it decides the seconds.

Each run is one fresh container, `docker run --rm --cpus=1 --memory=1280m`, one browser tab
(`concurrency: 1`), H.264 (`yuv420p`, Remotion's default quality, a silent AAC track), the bundle
already built. "Seconds" is the whole process, from Node starting to the file hashed (the
container's own start and stop add 8 to 21 s on this PC). "Peak" is the kernel's own high-water
mark for the container (`memory.peak`: everything the limit is enforced on, page cache included);
"cannot be dropped" is the largest anonymous plus shared memory seen, sampled four times a second.
The limit was never reached and nothing was killed in any run.

| Clip               | Run                  | Seconds   | Peak MB | Cannot be dropped MB | The PC meanwhile                                    |
| ------------------ | -------------------- | --------- | ------- | -------------------- | --------------------------------------------------- |
| 1080 x 1920 (9:16) | A1, 2026-11-19 20:37 | 126.4     | 947.6   | 782.3                | busy (54 to 68% of all threads, sampled once)       |
|                    | A2                   | 90.3      | 788.3   | 766.2                | as above                                            |
|                    | A3                   | 110.8     | 801.3   | 787.5                | as above                                            |
|                    | 4, 2026-11-20 08:44  | 101.9     | 797.3   | 771.4                | busy                                                |
|                    | 5, 2026-11-20 08:51  | **191.8** | 776.6   | 761.2                | saturated (64 to 93%, then 100%)                    |
|                    | B1, 2026-11-20 09:10 | **251.6** | 806.7   | 790.2                | saturated (100%); the container used 247.9 s of CPU |
| 1080 x 1350 (4:5)  | A1, 2026-11-19 20:44 | 92.5      | 632.8   | 614.8                | busy                                                |
|                    | A2                   | 123.1     | 632.0   | 616.7                | busy                                                |
|                    | A3                   | 74.7      | 634.5   | 618.1                | busy                                                |
|                    | 4, 2026-11-20 08:54  | **182.6** | 629.8   | 614.7                | saturated                                           |
|                    | B1, 2026-11-20 09:15 | **345.3** | 619.9   | 601.6                | saturated (100%); 329.2 s of CPU                    |

Comparisons, 1080 x 1920, during series A:

| Limits           | Tabs               | Seconds | Peak MB |
| ---------------- | ------------------ | ------- | ------- |
| 1 CPU, 1,280 MB  | Remotion's default | 80.2    | 801.3   |
| 2 CPUs, 1,280 MB | 1                  | 47.7    | 811.6   |
| 2 CPUs, 1,280 MB | 2                  | 46.3    | 885.5   |

- **Memory holds.** About 800 MB for 9:16 and 630 MB for 4:5, the same in every run whatever the
  PC was doing; the one 948 MB is the first run after the image was built, 165 MB of it page cache
  that the kernel can drop. That is 77 MB under the stop rule's 1,024 MB at worst and about 220 MB
  under it otherwise, and 330 to 480 MB under the container's 1,280 MB.
- **Time does not hold by itself.** A render is one core working flat out from start to finish
  (CPU seconds equal wall seconds), so it takes whatever that core is worth at the time: 90 to 126 s
  while the PC was merely busy, 183 to 345 s once other work saturated it. 4:5 was only about a
  sixth cheaper than 9:16 in series A, so "4:5 only" does not rescue a slow core.
- **One tab is right, and costs nothing.** Under a one-CPU quota Node itself sees one CPU, so
  Remotion's default concurrency is already one tab: asking for `concurrency: 1` changes neither
  the seconds nor the memory. With two CPUs a second tab buys nothing (46.3 against 47.7 s) and
  costs about 75 MB. A second CPU, though, halves the time with one tab, because FFmpeg and
  Chrome's own processes take it.
- **Files:** 1,068,936 bytes (9:16) and 1,046,398 bytes (4:5); D-454 guessed about 10 MB a clip.
- **Image:** 1.30 GB as `docker images` reports it (1,298,175,344 bytes); its layers add up to
  about 1.06 GB: the base 326 MB, Chrome's libraries 135 MB, production `node_modules` 302 MB, the
  headless shell 254 MB, the bundle and faces 38 MB. D-454 guessed about 1 GB. T-1932 can drop the
  bundler from the final stage.

### The stop rule

T-1931's rule: more than 180 s or more than 1,024 MB for the 9:16 clip under these limits returns
the question to the maintainer. **Memory passes in every run. Time passes in four runs of six and
fails in two (191.8 s and 251.6 s), both while the PC was saturated by other work. So the answer is
not a clean go: it goes back to the maintainer with these figures.** What matters for the decision
was that the production server is closer to the saturated case than to the other one (2 cores, a
load near 2.8 on the 2026-11-18 snapshot), and that nothing on the PC measured the server's own
core. The choices are written in D-454's "Measured" note.

**Measured on the server, 2026-11-20 (the maintainer's yes on the first choice): the rule passes
there.** This image, streamed to production and run once per size under the same limits with no
match live: 1080 x 1920 in 42.0 s with a peak of 850.1 MB, 1080 x 1350 in 37.7 s with a peak of
542.2 MB, and an uncached page fetched from outside answered as fast as before and after. T-1932
onwards may start; the 180 s timeout stays. Figures and raw output: D-454, "Measured on the
server".

## Determinism

The same props give the same bytes.

- The 9:16 MP4 has the same SHA-256 (`27ccb630…7a1b0`) in all nine English renders: series A's
  three, the default-concurrency and two-CPU comparisons, and three more, one after each of three
  rebuilds of the image. The 4:5 MP4 (`0bccdca6…6987f`) is the same in all five.
- PNG frames 45, 225 and 449 (1.5 s, 7.5 s and the last frame) of the 9:16 clip are byte-identical
  across four separate containers and three image builds (`21b387bf…`, `07104f7e…`, `00c35263…`),
  and the Persian ones across two (`005d4749…`, `38fa8e08…`, `6cf5a2ca…`).
- Another machine does NOT give the same bytes: the server's 1080 x 1920 file has the same size
  (1,068,936 bytes) and another SHA-256 (`8d39a660…`), so "the same props give the same file"
  holds per machine. T-1932 sets the encoder settings and checks again.

## Persian and right-to-left

`--locale fa` draws the same composition with `dir="rtl"` and Vazirmatn (the variable face from
`@fontsource-variable/vazirmatn`, the package the site uses). Looked at, frame by frame: the layout
mirrors (the home side and the wordmark at the right, the bar filling from the right), the letters
join and the zero-width non-joiners hold (`پیش‌بینی`, `خرم‌آباد`), the day is the Persian calendar's
in Tehran time with Persian digits and the momayyez, and the Latin islands (the wordmark, the
model's `name@version`, the countdown's order) stay left-to-right inside the right-to-left frame.

Found and fixed in the spike: the three Persian figures overflowed the frame's edge in 9:16.
Left for T-1935 and the designer: the badges keep their Latin letters in the Persian clip, the
Persian wording here is the spike's own and unreviewed, and whether Persian clips are made at all
is D-454's open question 1.

## Versions

| What                                                  | Version                                                                                                               |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `remotion`, `@remotion/bundler`, `@remotion/renderer` | 4.0.541 exactly (published 2026-11-05; all Remotion packages must share one version, so none carries a range)         |
| Chrome Headless Shell                                 | 158.0.8127.2 (`158.0.8127.2-remotion-v3`), fetched by `ensureBrowser()` from `remotion.media` when the image is built |
| FFmpeg                                                | the one inside `@remotion/compositor-linux-x64-gnu` 4.0.541; none is installed in the image                           |
| Node                                                  | 22.23.5 in the image (`node:22-bookworm-slim`, digest `sha256:e9f565d3…ab21ee` from Docker's mirror on ECR Public)    |
| React, React DOM                                      | 19.2.8                                                                                                                |
| `@fontsource-variable/vazirmatn`                      | 5.3.0                                                                                                                 |

## Licence

Remotion is source-available, not open source. It is used here under its **Free License**, which
covers individuals and companies of up to three people, automation included; we are two (D-454's
licence note, the business adviser's reading of 2026-11-19, not legal advice). **Re-check the count
before a fourth person joins.** Installing and rendering asked for no licence key, no account and
no consent. No `licenseKey` is passed anywhere, and for versions below 5.0 Remotion's licensing page
says a render then sends no usage event; `@remotion/licensing` arrives as a dependency of the
renderer and is not called. Remotion 5.0 changes that for paying automators, so an upgrade past 4.x
is a decision, not a version bump.

The faces are under the SIL Open Font License 1.1: the card's (their licences are beside them in
`apps/web/public/fonts/card/`) and Vazirmatn.

## What the spike did not do

- Its own runs were on the PC; the one render on the production server came afterwards
  (2026-11-20, above) and was a measurement only: nothing is deployed there.
- The fixture holds a real match and a real forecast read from the public page. Renders made
  from it are for measuring and looking at, not for publishing.
- It did not set T-1932's encoder settings (a closed group of 60 frames, `+faststart`) or check the
  file with `ffprobe`.
- The composition is representative, not the product: no golden frames, no design review, and its
  4:5 layout is tight under the eyebrow.
- It did not try the cheaper renders that would buy time: fewer frames a second, a faster x264
  preset, a shorter clip.
