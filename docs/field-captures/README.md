# Field-capture metrics ledger

One JSON per barometer field capture, holding the metrics derived from its export —
never the export itself.

**Why the split.** A run export contains the runner's home address twice: every run
starts and ends at the front door, so the first and last GPS fixes are it, at ~5 m
accuracy. The raw exports therefore live in gitignored `field-data/` and never leave
the machine. What is committed here is derived aggregates only — cadence, coverage,
noise, closure, reducer output — with no coordinate, and no value from which one can
be reconstructed. `scripts/analyze-field-capture.ts` enforces that boundary: it reads
coordinates but emits only aggregates.

That split is what makes the measurements citable across sessions and in pull
requests while the underlying captures stay private.

## Adding a capture

```sh
bun scripts/analyze-field-capture.ts field-data/<export>.txt --json docs/field-captures
```

For a capture where the phone did not move — capture 1, or any retake of it — add
`--zero-truth`. That switches the reducer grid to a phantom-gain reading (ground
truth is 0.00 m) and adds the drift analysis. Pass it explicitly rather than
trusting detection: capture 1 accumulated **858 m** of indoor GPS jitter while
never leaving a 16.8 m radius, so recorded distance says nothing about whether a
phone was still.

Then add a row to the ledger table in
[the capture analysis](../superpowers/research/2026-08-06-barometer-field-capture-analysis.md#9-capture-ledger)
and, if it is one of the six protocol captures, to the Log table in
[the capture protocol](../field-test-capture-protocol.md#log).

For captures 3 and 4 — the same route on two different days — also run the
repeatability comparison, which is the only estimate of run-to-run variance the
protocol produces:

```sh
bun scripts/analyze-field-capture.ts field-data/<c3>.txt field-data/<c4>.txt --compare
```

## Reading a summary

`schema` is the summary format version; bump it in the script when fields change
meaning, so an old file is never silently compared against a new one.

Three fields decide whether a capture is usable at all before any of the rest is
worth reading:

- `run.isFieldTestMode` — false means this was a plan session, not a protocol
  capture. Still useful as instrument evidence; **not** usable as protocol ground
  truth, and it will have marked a training day complete and written to Apple Health.
- `complete` — the `# end` trailer matched the header's section counts. False means a
  truncated file; discard it.
- `log.sensor` — the run's real hardware answer (`available`, `permission`). Check
  this, not `device.anySamplesRecorded`, which is equally false for a device with no
  barometer, a denied permission and a run that ended before the first reading.
