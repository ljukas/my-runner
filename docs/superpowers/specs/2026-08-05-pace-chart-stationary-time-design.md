# Pace chart: a stationary runner must not set the pace axis — design

Date: 2026-08-05
Status: **design — approved, in implementation**
Revision: **4**. Revisions 1–3 each tried to *classify* standing from the data, and each failed on the
same population — slow walkers. §11 records all three and the reason the fourth does not try. The
diagnosis (§2, §3) has survived six independent adversarial reviews unchanged; only the remedy moved.

Refines the pace chart shipped in the
[run elevation & pace chart slice](2026-08-02-run-elevation-and-pace-chart-design.md). **It does not
reverse that slice's §5.2** — see §8.

Measured against four field captures from the
[field-test capture protocol](../../field-test-capture-protocol.md). `active` is `activeDurationS`
from each export's header:

| capture | session | distance | active | fixes |
| --- | --- | --- | --- | --- |
| `runbro-20260731-1421-3ff243b0` | w3d3 | 2765 m | 1415 s | 1414 |
| `runbro-20260731-1542-38f9634f` | w3d1 | 2966 m | 1590 s | 1532 |
| `runbro-20260803-1722-98459df2` | w3d1 | 2934 m | 1456 s | 1460 |
| `runbro-20260803-1753-b4ae7b11` | w3d2 | 3108 m | 1469 s | 1463 |

**Sample caveat.** One runner, one phone, one city, all four in week 3. The slowest sustained walk in
the sample is ~1.3 m/s, and every capture carries 0.18–0.34 m of position residual. Revisions 1–3 all
died on populations the sample does not contain — slow walkers, noisy positions, irregular fix
cadence — so §10 covers those synthetically and deliberately does not lean on the captures.

---

## 1. What this slice is

Two changes, neither of which decides whether the runner was standing.

1. **In the fold:** a leg that committed no distance carries its seconds forward to the leg that
   finally commits, instead of being charged to a bucket that earned no distance.
2. **On the chart:** the pace axis's slow bound becomes the series' 95th percentile rather than its
   maximum, so one extreme bucket cannot set the scale.

**It is not:** any classification of standing, any exclusion of time, any trimming, any marker, any
new threshold on runner speed, any change to `toRunProfile`'s signature, and no change to recorded
distance, `activeDurationS`, the splits or Apple Health. Nothing new is persisted and no dependency is
added, so the native fingerprint is untouched and the next release stays OTA-eligible (ADR 0012).

## 2. The defect

The chart buckets by **distance**, and each bucket's pace is `seconds / metres` (§5.2 of the pace
chart design). That is the right series for a pace-vs-distance chart, and it makes a stationary runner
a **pole**: seconds accrue while metres do not, so the bucket's pace grows without bound — and the y
axis auto-fits to it.

| capture | worst bucket | vs median |
| --- | --- | --- |
| `3ff243b0` | #112 = 16:19 | 1.79× |
| `38f9634f` | #119 = **125:36** | **15.90×** |
| `98459df2` | #119 = 18:56 | 2.21× |
| `b4ae7b11` | #0 = 16:32 | 1.99× |

On `38f9634f` one bucket — 24.7 m of ground carrying 186 s, of which 169 s is motion below 0.1 m/s —
owns almost the whole axis:

```
BEFORE   axis 5:11 (top) … 125:36 (bottom)
  5:11 |***********************************************************
       |*
       |
       |
 65:24 |
       |
       |
       |
125:36 |
```

## 3. Why the shipped `MAX_GAP_S` guard misses it

§5.2 excludes any leg longer than `MAX_GAP_S` (30 s), which is correct for a pause or a tunnel: the
fixes are *absent*, and such a leg committed no distance to lose. It assumed a standstill would look
the same. **It does not, because iOS keeps delivering fixes while the phone stands still.**

Across all four captures: **5,865 legs, of which exactly 1 exceeds `MAX_GAP_S`** — and that one is
`38f9634f`'s fix #0→#1, before the run's own start. Median inter-fix interval is **1.00 s whether
moving or stationary**. So a 173-second standstill arrives as ~173 fully-counted one-second legs.

## 4. Why nothing is classified

Three mechanisms were built and measured before this one, each trying to decide from the data whether
the runner had stopped. Each failed on slow walkers, and the sixth review supplied the reason rather
than another data point:

> **The deadband has already discarded the distinguishing information.** `geo.ts:332` withholds a
> commit while `smoothedSpeed < 0.5 && d < 1.5`, so during a hold the ~1.2 m of ground detail is gone.
> What survives is one flush whose size is set by departure speed × fix interval — and standing and
> slow departure produce the same flush.

Measured at 1 Hz: the releasing commit for a **genuine standing start** spans 1.41–3.60 m; for a
runner who **never stood and merely started slowly**, 1.21–3.67 m. The distributions overlap
completely, so no threshold on that quantity can separate them. That is why a speed window (revision
1), a hold duration (revision 2) and a release rate (revision 3) each failed in turn.

**The measurement that settled it.** A steady 0.30 m/s walk with 1 m of position noise — the app's own
audience, within a factor of 3 of the captures' residual — against a true pace of 55:33:

| | reported |
| --- | --- |
| today | 39:53 *(28% fast)* |
| revision 3's rate rule | 33:06 *(40% fast)* |
| **carry-forward, no classification** | **56:58** *(2.5% slow)* |

Classification was never the improvement; it was the harm. The improvement is the part that decides
nothing.

## 5. The fold change

Today, `run-profile.ts:66-70` charges a zero-metre leg's seconds to the bucket it happened in:

```ts
if (legMeters <= 0) {
  seconds[bucketAt(from.distanceM, width, bucketCount)] += legSeconds;
  continue;
}
```

That branch is replaced by a carry: those seconds ride forward onto the leg that finally commits, so
distance and the time it took travel together — the principle §5.2's entry-leg rule already rests on.

- A leg over `MAX_GAP_S` **clears** the carry: unmeasured time must not cross into a bucket.
- A leg with `seconds <= 0` (a duplicate or backwards timestamp) contributes nothing and **must not
  clear** the carry. Dropping accrued seconds there reports a slow walker four times too fast — a
  measured defect, not a hypothetical.

This is why the deadband case improves: below 0.5 m/s the smoother withholds commits for several
seconds at a time, and charging those seconds to a bucket that earned no distance is exactly what made
the walker read fast.

**Total folded time is preserved** — seconds move, they are never dropped — so the chart's time basis
still agrees with `activeDurationS`. Measured against the Avg Pace tile: **+0.05% / −0.39% / −0.09% /
+0.27%**, inside the ±0.4% the chart already sits at today. **Nothing is owed to the user in
explanation, and no disclosure is added.**

## 6. The axis change

`run-profile-chart.tsx:89-93` already owns the pace domain explicitly:

```ts
return [Math.max(...paces), Math.min(...paces)] as [number, number];
```

The slow bound becomes the series' **95th percentile**. Buckets beyond it are clipped by
victory-native, which renders chart children inside a clip group (`CartesianChart.tsx:977-981`,
`clipRect = boundsToClip(chartBounds)`), so the line visibly exits the top of the plot rather than
painting over the axis. That was verified in source — an earlier draft rejected this whole approach on
an unverified assumption that it would *not* clip.

**Why the 95th and not the 98th.** q=0.95 scores better on all four captures and tolerates **5**
poled buckets against q=0.98's **2**. With carry-forward each stand poles roughly one bucket, so 5 is
headroom for a stop-and-go urban run — the case field testing is most likely to surface. The cost is
4% of buckets clipped rather than 1.7%.

**A minimum span is required.** On a perfectly uniform series the 95th percentile equals the minimum
and the domain collapses — measured on a synthetic steady run, p95 and min both 5:34. The domain must
never be narrower than a floor; the exact form is settled in implementation and pinned by a test
(§10).

The domain must be computed by a **pure helper**, not inline in the component, so it is testable
without a renderer.

## 7. Result

Ground-truth band contrast — `(walk pace − run pace)` taken from each capture's own recorded segments,
over the **domain** span:

| capture | today | **after** | domain after | clipped |
| --- | --- | --- | --- | --- |
| `3ff243b0` | 0.36 | **0.61** | `5:46…12:00` | 5/120 |
| `38f9634f` | 0.02 | **0.43** | `5:11…10:25` | 5/120 |
| `98459df2` | 0.25 | **0.46** | `5:51…11:04` | 5/120 |
| `b4ae7b11` | 0.28 | **0.59** | `5:13…10:35` | 5/120 |

Today's axes are `5:46…16:19`, `5:11…125:36`, `5:51…18:56`, `5:13…16:32`. For comparison, revision 3's
rate rule reached 0.52 / 0.16 / 0.25 / 0.41 — this is better on all four and **2.7× better on the
capture that motivated the slice**.

## 8. What this does not change

**§5.2's decision stands.** That section holds that a standstill with fixes is real elapsed time and
that only a bare gap is unmeasured. Under this design those seconds are still counted — attributed to
the leg that earned the distance rather than to a bucket that earned none. Verified: the test pinning
it (`run-profile.test.ts:210-226`, `max > 1.2 × steady` and `min ≈ steady`) passes with carry-forward
at **541.5** against its 400 bar, and both gap tests hold at band **0.960**. Revisions 1–3 all
reversed §5.2 and required an amendment to it; revision 4 does not, and that amendment is withdrawn.

**No API change.** `toRunProfile(fixes, bucketCount?) => ProfilePoint[]` keeps its exact signature. No
`foldRunProfile`, no `RunProfileFold`, no `excludedStandstillSeconds`, and no ripple through
`use-run-track`, `RunProfileCard`, `isDrawableProfile` or `paceRange`.

**No card copy.** There is nothing to disclose (§5), so no text is added, and the label's distance
sentence already reads true — the x extent still equals `run.distanceM` exactly, because nothing is
trimmed.

**But the VoiceOver label's *range* sentence must change (§8.1).**

### 8.1 The spoken range sentence, which this design does break

`paceRange`'s own contract is *"the pace axis's extent, for the card's VoiceOver label"* — and after §6
it no longer describes the axis. It returns the full series' min and max, so on `38f9634f` the card
would announce *"The chart spans 5:11 to 125:36"* while the visible axis tops out at **10:25**. That is
a number no sighted user can see, in the one channel that has nothing else to go on. An earlier draft
of this revision claimed no accessibility change was needed; that was wrong.

The label must describe what is plotted, and — because a sighted user *does* see the line exit the top
of the plot — must say that too:

> "Pace profile over 2.97 km. The chart spans 5:11 to 10:25. 5 slower points reach 125:36, above the
> chart."

The second sentence appears only when points are clipped. This gives the listener the visible range
plus the true extreme, which is strictly more than the sighted user gets and nothing that is false.

`paceRange` therefore reports the **domain's** extent and how many points fall outside it. This is the
only consumer, so widening it costs nothing elsewhere.

## 9. Limits, stated plainly

- **The percentile clips real data, but only on runs long enough to have buckets to spare.**
  `Math.ceil((n − 1) × 0.95)` lands on the **last index** for any n ≤ 20, so a run of 20 buckets or
  fewer clips nothing at all and its domain is identical to today's. Clipping begins at **21 buckets
  — about 105 fixes, or 105 seconds of running** (verified on device: a 15-bucket run clipped
  nothing, a 48-bucket run clipped one). At the 120-bucket cap it is 5 buckets, 4%. That threshold is
  a good accident rather than a design choice: short runs, where one bucket is a large share of the
  evidence, are left alone.
- **The clamp is one-tailed.** Only the slow bound is a percentile; the fast bound is still the raw
  minimum, so a fast-side outlier stretches the axis exactly as a slow one used to. Observed on
  device: a verification run averaging 6:25 got a 2:40–5:58 domain, because one bucket read 2:40 /km
  (6.25 m/s, at `RUNNING_SPEED_CEILING`) from a GPS artifact. A round-1 reviewer predicted this —
  *"it is blind to fast-side outliers"*. It is not this slice's defect, since the pole this slice
  exists for is always slow-side, and a p05 fast bound would hide genuinely fast running. Recorded
  for the follow-up in §12.
- **A run with more than 5 poled buckets** — six or more separate stands — pulls the domain back up.
  Nothing in the sample comes close; if field testing finds one, q moves.
- **The pole is still in the data.** Nothing is deleted, so `paceRange` and any future consumer of the
  series still sees the extreme value. That is honest, and it is why no disclosure is owed — but a
  future consumer must not assume the series is outlier-free.
- **A 15–29 s pause still poles its bucket.** The engine ingests no fixes while paused, and the
  resumed fix commits 0.19–0.54 m of stale Kalman velocity, so the leg is not a gap and its full
  duration lands in one bucket — up to 39:25 measured at a 29 s pause. The percentile domain hides it
  exactly as it hides a stand's. Worth fixing in the engine, not the fold.

## 10. Testing

Unit only, in `bun test` — `src/domain/run-profile.ts` is pure TS with no Expo or React Native import,
and §6's domain helper must be pure for the same reason.

- **The whole existing suite passes unchanged**, including the §5.2 test and both gap tests. A failure
  there means the carry is wrong.
- **A slow walker is not reported fast.** Steady walks at 0.3–1.4 m/s report true pace to within a few
  s/km at **1000, 1001, 900, 1100, 500 and 2000 ms cadences, under ±3 ms jitter, and with 0.5 m and
  1 m of position noise.** This is the test revisions 1–3 lacked; `straightRun` needs both a cadence
  and a noise parameter to express it. **Noise-free, fixed-cadence fixtures are what hid three
  successive regressions** — that is the lesson worth encoding.
- **A duplicate timestamp does not discard accrued seconds** — the walker still reports true pace.
- **Total folded time is preserved.** Summed bucket seconds equal elapsed minus only what a
  `MAX_GAP_S` gap legitimately removes. Assert every bucket non-null first, so it cannot pass
  vacuously.
- **Distance conservation** — buckets sum to the run total.
- **The domain helper** — returns `[p95, min]` for a spread series; never returns a span below the
  minimum-span floor; handles an empty series, a single point, and an all-identical series.
- **`paceRange` reports the domain, not the series** — on a fixture with a pole it must report the
  p95 bound and a non-zero clipped count, never the pole as the range. This is the assertion that
  keeps §8.1's defect from returning.
- No test asserts that a stop was detected, because nothing detects one.

**No E2E.** Simulated GPS motion is unreachable by Maestro (ADR 0001, 2026-07-31 amendment).

**Simulator verification, done 2026-08-06** (iPhone 17 Pro / iOS 26.5, dev client). Two runs, driven
with `simctl location` and a static fix in the middle for the stand:

| run | buckets | label |
| --- | --- | --- |
| 0.26 km / 1:15 | ~15 | *"…spans 4:13 to 5:09 /km."* — nothing clipped, no third sentence |
| 0.65 km / 4:09 | ~48 | *"…spans 2:40 to 5:58 /km. 1 slower point reaches 6:09 /km, above the chart."* |

Both axes' tick labels fall inside their stated domain, and the singular form reads correctly.

**One caution for whoever verifies this next: you cannot tell clipping from genuinely slow pace by
eye.** On the second run the line runs flat near the bottom of the plot, which reads at a glance like
a stroke pinned at a clip boundary; it is not — the domain's floor is below the lowest tick and that
stretch is real pace. Only the label distinguishes them, which is an argument for the label sentence
existing rather than against it.

## 11. Review record

Six independent adversarial reviews across three rounds. The diagnosis (§2, §3) survived all six.
Every remedy that classified standing was broken by the next round.

**Revision 1** — a 0.8 m/s speed floor over a 5 s window, an end-trim, and a dashed stop marker. Six
Criticals: the detector deleted a leg at 1.90 m/s as standstill; at exactly 0.80 m/s it produced **no
chart at all**; a degenerate window manufactured phantom multi-minute stops; its headline metric
`(p95 − min)/(max − min)` was invalid — it saturates at 100% once six buckets are wrecked, and would
have *rejected* this slice on a stop-and-go run; and the marker was unrenderable, because victory
clips children to the first and last bucket **centre**, so on 3 of 4 captures every marker drew
nothing.

**Revision 2** — a hold-duration guard derived as
`NEAR_STATIONARY_DEADBAND_M / NEAR_STATIONARY_SPEED_MPS` = 3 s. Analytically wrong: 3 s is the
*infimum* of legitimate accrual, not the supremum, so it separated nothing. One 1001 ms interval
reported a 0.4 m/s walker at **10:26** against a true 41:40. Four further Criticals were tests passing
for the wrong reason — both standstill tests hard-coded `bucketCount` 20 and failed at the default,
and the conservation test was the arithmetic identity `(n−0.5)·T/n + T/2n === T`, which a
chart-collapsing mutant passed.

**Revision 3** — a release-rate test at 0.25 m/s plus a head clause. Reviewers found the rate test
fires on *decelerating* rather than standing (63 s of "standing" disclosed on a run with none, using
the suite's own generator with no noise at all); the 3 m head margin is not a discriminator (§4); its
constant was calibrated against a quantity the code does not compute; the head clause was already
dead on 1 of 4 captures; and a single velocity-gated fix inside a stand restored two thirds of the
original defect. A 10 s duration floor removed every false positive and simultaneously removed the
benefit on 2 of 4 captures — because short stands and deceleration transitions are the same duration.

**Two implementers refused to force a red test green**, and were right both times: once about a
threshold in the plan, once about the rule itself. That instruction found more real defects than any
single review.

**What survived every round:** §3's cadence measurement; §2's worst-bucket table; that no bucket goes
null; that the x extent equals the stored distance exactly; and §1's fingerprint/OTA claim.

## 12. Out of scope

- Elevation. Still unrendered, still waiting on barometer tuning (ADR 0015).
- **The x-axis revisit.** The prior design chose distance for elevation's sake, deferred elevation,
  and kept the axis as the owner's standing decision "revisited when elevation lands". A reviewer
  argued a time axis dissolves this whole problem, since a stop would be as wide as it is long. It
  belongs with the elevation work the axis was chosen for.
- Per-segment or segment-coloured pace. `segmentSeq` is already at the fold site.
- The 15–29 s pause defect (§9) — an engine concern, not a fold one.
- **A fast-side bound** (§9). Symmetrising the clamp would tighten an axis stretched by a GPS
  artifact, at the cost of hiding real fast running. Decide it against field captures, not here.
- **Live validation.** The owner will run this on real sessions after it ships, and look again at the
  percentile choice and at whether the clipped buckets read correctly on device.
