# 21. On-device GPS track smoothing; no map-matching

Date: 2026-07-21

## Status

Proposed — draft for review. Flip to `Accepted` on merge.

## Context

The recorded run route should look like it follows roads/paths, and
distance/pace should be accurate — not distorted by GPS artifacts. The concern
was framed as "the path should align to roads, not the crow-flies line between
GPS points." **Literal road-alignment is out of reach without road data (see
below); this ADR delivers the outcome behind that ask — a clean line and
accurate pace — within the app's hard constraints** (no backend, no accounts, no
analytics, all data on-device — iCloud backup only; Mapbox already rejected on
exactly these grounds — AGENTS.md / the master C25K spec).

Research findings (verified 2026-07-21):

- **Chord-vs-curve error on the raw track is negligible.** At 1 Hz +
  `BestForNavigation` while running (~2–3 m/s), fixes are ~2–3 m apart;
  straight-lining a curve that densely shortfalls by `1 − sin(x)/x`
  (`x = s/2R`) — ~0.26% on a normal bend (R=10 m), **< 0.1% over a whole run**.
  The "crow-flies" worry is effectively zero *on the raw points*.
- **GPS jitter is the dominant error, and it *inflates* distance.** Ranacher et
  al., *Why GPS makes distances bigger than they are* (IJGIS 2016,
  `pmc.ncbi.nlm.nih.gov/articles/PMC4786863/`), shows noise causes systematic
  distance **over**estimation, worse as points densify for uncorrelated error
  (bounded in practice by the temporal autocorrelation of consecutive 1 s
  fixes). Validated sport-watch studies (JMIR, `mhealth.jmir.org/2020/6/e17118/`)
  find 3–6% distance MAPE, worse in adverse conditions.
- **No mainstream running app road-snaps the recorded run live on-device.**
  Strava's snap-to-road is a **server-side route-*builder*/authoring** feature,
  not applied to your activity; Apple's internal CoreLocation snap is
  network-dependent and **gated off below ~20 km/h** (never fires at running
  pace); Nike/Garmin draw the smoothed raw track. Live **raw-smoothing** is
  universal.
- **True map-matching is incompatible with the constraints.** Hosted services
  (Google Roads `snapToRoads`, Mapbox, HERE, hosted OSRM/Valhalla) need network
  + API key + GPS sent off-device. On-device offline engines (Valhalla/Meili,
  GraphHopper, fmm/hmm) have no Expo/iOS binding and need regional OSM
  road-graph tiles (hundreds of MB) bundled or downloaded (the latter
  reintroduces a server). Apple MapKit exposes no matching API (`MKDirections`
  is routing, not matching).

## Decision

**Record raw fixes; derive distance/pace from an on-device forward-smoothed
stream; render a simplified polyline. True map-matching is rejected. The route
will not hug a specific sidewalk — only road data does that — but the jitter
artifacts users actually notice are removed.**

1. **Raw fixes are the source of truth.** `run_points` stores every fix that
   passes the **accuracy gate only** (`accuracy > 0 && ≤ 50 m`, the existing
   `accuracyFilter`) — points-as-spine (ADR 0004). Smoothing is layered on top
   at derivation time, never stored destructively. So Apple Health (ADR 0011,
   `saveRun(run, segments, points)`) and the map both receive real GPS; the app's
   own rendered line is the DP-simplified smoothed track (§6), so it will look
   marginally cleaner than a raw Health-app route — accepted.
2. **Smoothing pipeline (pure, in `domain/geo.ts`):** (a) accuracy gate (above);
   (b) **velocity/outlier gate** — reject a fix whose implied speed from a short
   *median* reference (not a single prior fix, so one spike can't poison the
   anchor) exceeds a running ceiling with margin, Δt-aware; (c) **forward Kalman**
   (constant-velocity) run **in a local equirectangular metre plane** about a
   per-run reference latitude (never on raw lat/lng degrees), using `accuracy` as
   the measurement variance (this *is* the accuracy weighting — there is no
   second distance threshold) and a fixed process-noise `Q`; (d) **near-stationary
   deadband with carried residual** — suppress drift only when smoothed speed ≈ 0,
   and **never discard accumulated movement** (advance the distance anchor only
   once cumulative displacement clears the threshold), so a 1.4 m/s walker is
   fully counted.
3. **Determinism kills live-vs-saved divergence (the key correctness rule).**
   The smoother is a **forward/causal** function of the raw fix sequence + fixed
   params. It runs **incrementally in the engine during the run** (the engine's
   in-memory ingest state carries the filter state — position, velocity,
   covariance, reference latitude, residual), so the live `distanceM` on the run
   screen *is* the smoothed value. At `finalize()` and on crash-resume the
   **same forward filter is re-run over the persisted `run_points`**, producing an
   identical result — so live, saved, and resumed distances agree by
   construction. The crash snapshot stays tiny (event log + anchor, ADR 0007); it
   does **not** serialize filter state — resume reloads `run_points` and re-runs
   the filter to reconstruct it.
4. **Per-segment distance (order matters).** Smooth the whole stream first, then
   attribute each smoothed inter-fix delta to the segment its **end** fix falls
   in (by `segment_seq`); per-segment distances then sum exactly to the total.
   `run-stats` per-segment pace + the fastest-interval highlight consume these.
5. **GPS gaps.** A time gap beyond a max threshold **resets the anchor** — the
   chord across the gap is not counted as distance (the track shows a gap, spec
   §11), preventing a spurious post-gap jump.
6. **Rendering (Stage 4) is a Douglas–Peucker-simplified** smoothed track — a
   **pure helper in `domain/geo.ts`** applied *before* the `RouteMap` port
   (consistent with ADR 0010's "port takes segments + points"). Presentation
   only: **distance is NEVER derived from `summary_polyline` or the simplified
   line — only from `run_points`.** Epsilon is capped to avoid flattening tight
   real features.
7. **Rejected:** hosted snap services (network/account/telemetry vs no-backend);
   on-device OSM matching engines (no Expo/iOS path; unbounded on-device
   road-graph); reliance on Apple's internal snap (undocumented,
   network-dependent, off below ~20 km/h).
8. **Fallback ladder (all on-device):** (1) if field-tested distance error
   exceeds ~5% vs a known-length route, **tune params** first; (2) if routes
   still look jagged, **raise DP epsilon / add a light display spline**; (3)
   escalating to a hosted service is **out of scope** — it first requires
   reversing the no-backend hard constraint in **AGENTS.md / the master spec**
   (a new ADR + product decision), and there is no on-device middle option to
   fall back to.

## Parameters

Load-bearing constants live as named exports in `domain/geo.ts`, unit-tested
against fixture tracks; the fallback ladder tunes these. Initial defaults
(to be validated on real routes at the Milestone-0 device gate): accuracy hard
limit 50 m (existing); running-speed gate ceiling ~6.5 m/s over a short median
window; Kalman `Q` a small constant-velocity acceleration term (the
smoothing↔lag knob); near-stationary deadband ~1.5 m with carried residual, gated
on smoothed speed; max GPS-gap reset ~30 s; DP epsilon ~5 m. These are the
"deterministic function's fixed params" §3 relies on.

## Consequences

- The user-visible outcome (clean line + accurate pace) is achieved within the
  no-backend/on-device ethos — zero road data, zero network — matching what
  mainstream apps do *live*.
- Smoothing attacks the dominant error (jitter over-estimation), bounded against
  under-counting by `Q`, the carried-residual deadband, and the segment-sum
  invariant; the negligible raw chord is left alone.
- `runs.distance_m` is a **persisted projection**, recomputable from `run_points`
  by the same forward filter — no second source of truth, and re-tunable without
  data loss (points-as-spine).
- Stage split: **Stage 3** wins distance/pace (`domain/geo.ts` smoothing +
  engine integration); **Stage 4** wins the clean rendered line (DP). Raw
  `run_points` unchanged, so HealthKit (Stage 5) is unaffected.
- Over-smoothing is the real risk (too-aggressive `Q`/deadband under-counts);
  mitigated by unit tests + device validation + the tune-first fallback.
- No new dependency: gates, a forward CV-Kalman in a metre plane, and DP are
  pure TS in `domain/geo.ts`, `bun test`-covered (a correct CV-Kalman is real
  test surface, not trivial — budgeted accordingly).

## Plan impact (Stage 3 — this supersedes the raw-Σ distance path)

The already-built Wave A `geo.ts` (accuracy gate + haversine) and the plan's
raw-Σ finalize are now the *inputs* to smoothing, not the distance path. The
Stage 3 plan gains: a pure smoothing task in `domain/geo.ts` (velocity gate +
metre-plane forward Kalman + carried-residual deadband + gap reset); engine
ingestion (T12) carries the forward-filter state so live `distanceM` is smoothed;
`finalize()` (T8) and resume (T14) recompute distance via the same forward filter
over `run_points` (not `SUM(haversine)` over raw rows); per-segment attribution
(§4) feeds `run-stats`/T2b; and a **Stage 4** DP-simplification task
(`domain/geo.ts`, before `RouteMap`). These tasks each run the standard
per-task review pipeline when built.

## Alternatives considered

- **Hosted map-matching** (Google Roads / Mapbox / HERE) — rejected: network +
  account + off-device GPS; reverses no-backend/no-accounts.
- **On-device OSM matching** (Valhalla/GraphHopper/fmm) — rejected: no Expo/iOS
  binding; needs regional road-graph tiles bundled or downloaded.
- **Apple's internal CoreLocation snap** — rejected: undocumented,
  network-dependent, off below ~20 km/h, no API.
- **Live raw distance, overwrite with smoothed at finalize** — rejected: the run
  screen would show a number that silently changes on the summary; §3's
  forward-filter-both-live-and-batch avoids the divergence instead of papering
  over it.
- **Batch (forward–backward / RTS) smoother** — rejected for the authoritative
  path: non-causal, so it can't match a live value; forward-only accepts slight
  lag for live/saved consistency.
- **EMA instead of Kalman** — a simpler position EMA lags and biases path length
  downward; usable only as a characterized fallback, not the authoritative
  smoother, so the algorithm stays fixed (Kalman).
- **Store smoothed points instead of raw** — rejected: raw is the source of
  truth; smoothing must stay re-tunable and HealthKit/maps want real fixes.
- **Do nothing (raw track)** — rejected: it is the jagged line + inflated
  distance flagged as the problem.
