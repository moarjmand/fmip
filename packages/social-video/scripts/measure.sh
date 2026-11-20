#!/usr/bin/env bash
# T-1931's measurement, repeatable: renders the matchday preview in the
# `fmip-social-video:t1931` image under the worker's limits (D-454 point 3)
# and appends one JSON line per run to <out>/runs.jsonl.
#
#   bash packages/social-video/scripts/measure.sh <absolute output directory>
#
# Git Bash on Windows: MSYS_NO_PATHCONV is set only on the docker call, so the
# container paths stay literal (docs/03-project-map.md, the host's notes).
set -euo pipefail

OUT="${1:?an absolute output directory}"
IMAGE="${IMAGE:-fmip-social-video:t1931}"
mkdir -p "$OUT"

# run <label> <cpus> <render.mjs flags...>
run() {
  local label="$1" cpus="$2"
  shift 2
  local started
  started=$(date +%s%N)
  MSYS_NO_PATHCONV=1 docker run --rm --cpus="$cpus" --memory=1280m -v "$OUT:/out" "$IMAGE" \
    node scripts/render.mjs --label "$label" --json /out/runs.jsonl "$@" >/dev/null
  echo "$label: container wall $(( ($(date +%s%N) - started) / 1000000 )) ms" | tee -a "$OUT/wall.txt"
}

# The worker's case: one CPU, 1,280 MB, one browser tab. Three runs an aspect.
for i in 1 2 3; do
  run "9x16 cpus=1 c=1 #$i" 1 --aspect 9x16 --concurrency 1 --out "/out/matchday-preview-9x16-run$i.mp4"
done
for i in 1 2 3; do
  run "4x5 cpus=1 c=1 #$i" 1 --aspect 4x5 --concurrency 1 --out "/out/matchday-preview-4x5-run$i.mp4"
done

# Comparisons: Remotion's own default concurrency under the same quota, then two CPUs.
run "9x16 cpus=1 c=default" 1 --aspect 9x16 --concurrency default --out /out/cmp-9x16-cpus1-default.mp4
run "9x16 cpus=2 c=1" 2 --aspect 9x16 --concurrency 1 --out /out/cmp-9x16-cpus2-c1.mp4
run "9x16 cpus=2 c=2" 2 --aspect 9x16 --concurrency 2 --out /out/cmp-9x16-cpus2-c2.mp4

# Determinism: the same three frames from two separate containers.
for i in 1 2; do
  run "stills en 9x16 #$i" 1 --aspect 9x16 --no-video --stills 45,225,449 --out "/out/stills$i/en-9x16"
done

# The Persian variant: frames in both aspects, and one clip to look at.
run "stills fa 9x16" 1 --aspect 9x16 --locale fa --no-video --stills 45,225,449 --out /out/stills1/fa-9x16
run "stills fa 4x5" 1 --aspect 4x5 --locale fa --no-video --stills 449 --out /out/stills1/fa-4x5
run "9x16 fa cpus=1 c=1" 1 --aspect 9x16 --locale fa --concurrency 1 --out /out/matchday-preview-9x16-fa.mp4
