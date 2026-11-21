# RUN-LOG — csv-reader-speed-01-run-20261121

Flow: `~/workspace/makefun/improvement-flow.md`. Spec frozen from
`competition.yaml` / `RULES.txt` / reference `vendor/csv-reader/index.js`
(csv-reader 1.0.0). Practice set split: work = cases 0–3 (g-0001..g-0004),
hold-out = cases 4–5 (g-0005, g-0006; one header=false case included).
Adoption gated on hold-out improvement. Timing: interleaved A/B in one
process, `--no-incremental-marking`, `process.cpuUsage()` user+system,
median of N rounds; local Node v24.22.1 (harness runs node22).

## Round 0 — freeze + baseline

- Baseline = kit `baselines/csv-reader` (csv-reader 1.0.0 itself).
- Work set, driver 5 reps (non-interleaved, noisy VM): baseline median
  730.8 ms / 4 cases. Hold-out 5 reps: baseline median 225.5 ms / 2 cases.
- Correctness oracle: kit `practice/reference/expected.json` + direct
  differential checks vs `readCsv`.

## Round 1 — v1: indexOf/slice field parser + plain-line fast path

- Change: record fast path (`split(',')` for lines with no `"` / stray CR);
  general fallback parser using `indexOf` jumps + `slice` instead of
  char-by-char concatenation; quoted-field transform only when the segment
  holds `"`, `\r` or `\n`; exact error order / line / row attribution.
- Work set (driver, 5 reps): ALL MATCH, median 141.7 ms vs baseline
  730.8 ms (~5.2x, non-interleaved — noisy, see Round 3 A/B for the
  reliable figure).
- Hold-out (driver, 5 reps): ALL MATCH, median 96.2 ms vs baseline
  225.5 ms (~2.3x).
- Fuzz vs reference: 30,136 checks (130 targeted edges × header t/f,
  30,000 random small inputs, 6 freshly generated large cases via the kit
  generator) — 0 mismatches.
- Verdict: adopted (hold-out improved).

## Round 2 — v2d: single-line record parser (`parseLineRecord`)

- Change: records whose quoted fields all close on the same line are
  parsed directly from the line segment (no per-field `\n` search);
  multiline / unterminated quotes bail to the Round 1 fallback.
  Quote-junk errors are counted locally and reported only on success, so
  a bail-out never double-reports.
- Work set, interleaved A/B 7 rounds: v1 median 158.7 ms, v2d median
  109.2 ms (1.45x vs v1). Repeat run: v1 122.1 ms, v2d 100.7 ms.
- Hold-out, interleaved A/B 9 rounds: v2d median 34.0 ms.
- Fuzz vs reference after adoption: 30,136 checks — 0 mismatches.
- Verdict: adopted (hold-out improved vs Round 1; see final A/B below).

## Round 2 (rejected) — v2a: sticky/global regex delimiter scan

- Change: `readUnquoted` finds the next `,` / `\n` with one global-regex
  `exec` instead of two `indexOf` calls; quoted-segment check fused into
  one regex test. (First attempt used a sticky `/y` regex — wrong: it
  only matches *at* `pos`, so it returned wrong answers fast; caught by
  the correctness check before any timing was trusted. Fixed to `/g`.)
- Work set, interleaved A/B 7 rounds: v2a median 200.9 ms vs v1 158.7 ms —
  slower. Verdict: rejected (regex `exec` overhead beats `indexOf` here).

## Round 3 — v3: cached next-LF across a record's fields

- Change: `readUnquoted` reuses a cached `nextLF` (recomputed only when
  `pos` moves past it) instead of `indexOf('\n')` per field.
- Work set, interleaved A/B 9 rounds: v2d median 120.3 ms, v3 median
  112.3 ms (~7%, within VM noise).
- Hold-out, interleaved A/B 9 rounds: v2d median 34.0 ms, v3 median
  34.7 ms — no improvement.
- Verdict: rejected (improvement-zero round per the flow). Kept v2d as
  the best checkpoint. Stopping here (3 rounds reached in spirit:
  R1 adopt, R2 adopt, R3 no gain).

## Final — adopted v2d, end-to-end verification

- Kit scorer on the entry's own `main.ts` output: `passed: 1,
  cases_passed: 6, cases_total: 6`.
- Final interleaved A/B, 9 rounds, all 6 practice cases:
  baseline median 733.6 ms, v2d median 186.2 ms → **3.94x**
  (means 713.3 ms vs 196.9 ms → 3.62x).
- Split: work median 551.3 ms → 148.3 ms (3.72x); hold-out median
  197.6 ms → 40.8 ms (4.84x).
- Repo size: 11,501 bytes total (limit 1,048,576).
- Files: `~/workspace/makefun/bot-csv-20261121/` — `solve.js`,
  `main.ts` (kit driver verbatim), `package.json`, `README.md`,
  `RUN-LOG.md`. Working notes / variants / drivers in
  `~/workspace/makefun/csv-work/` (not part of the submission).
