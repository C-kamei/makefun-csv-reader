# csv-reader-speed-01-run-20261121 — faster drop-in for csv-reader 1.0.0

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/C-kamei/makefun-csv-reader/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/C-kamei/makefun-csv-reader/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

Entry for make.fun `csv-reader-speed-01-run-20261121` ($100 over 10 places,
deadline 2026-11-23 02:42 UTC). `solve.js` is an original implementation that
returns exactly csv-reader 1.0.0's answer `{columns, rows, errors}` for every
input, faster. `main.ts` is the kit's starter driver, unchanged.

## Files

- `solve.js` — the entry. Dependency-free ES module, exports `run(input)`.
- `main.ts` — the kit driver: reads `/input/cases.json`, answers each case
  with `run`, writes `/output/answers.json`. Turns V8 incremental marking
  off, as the house baseline does.
- `package.json` — `{"type": "module"}`.

## Semantics implemented (from competition.yaml / RULES.txt)

- A U+FEFF at the very start is dropped. A record ends at LF or CRLF; a
  line left with no characters is no record.
- Outside quotes, a CR not followed by LF is dropped (`stray_cr`).
- A field opening with a quote runs to the next non-doubled quote; `""`
  inside is one quote; CRLF / lone CR inside is read as LF. Text after the
  closing quote, up to the next comma or line break, is appended as it
  stands (`quote_junk`, when the field ends). A quote that never closes is a
  literal character and the text after it is re-read as unquoted
  (`unterminated_quote`).
- A quote inside an unquoted field is a literal character. Fields stay
  strings, never trimmed or converted.
- `columns` is the first record when `header` is true, else `null`; rows are
  padded with `""` (`short_row`, with `fields`) or cut (`long_row`, with
  `extra`) to the first record's width. Each error is `{code, line, row}` in
  the order met, with `line` the 1-based line the record starts on and `row`
  its index in `rows` (`null` for the header).

## Design (why it is faster)

The reference builds every field character by character with string
concatenation. This implementation never does that:

1. **Single-line record path** (`parseLineRecord`): most records are one
   line whose quoted fields all close on that line. They are parsed from
   the line segment with `indexOf` jumps for `,` / `"` and `slice` for
   fields — no per-character loop, no newline search per field. A quoted
   field that does not close on the line (multiline / unterminated) bails
   to the general parser.
2. **Plain-line path**: a line with no `"` and no stray CR is one `split(',')`.
3. **General field parser** (multiline quoted fields, unterminated quotes,
   stray CRs): jumps between delimiters with `indexOf` and slices fields.
   A quoted field finds its closing quote with `indexOf('"', …)` skipping
   `""` pairs; only a segment that actually contains `"`, `\r` or `\n`
   goes through the transforming slow path (which also counts the line
   breaks for the line counter). `readUnquoted` finds the next `,` / `\n`
   with `indexOf` and only scans for `\r` inside that segment.
4. Quote-junk errors found by the single-line path are counted locally and
   reported only on success, so a bail-out can never double-report.
5. No caching between cases: every `run(input)` is self-contained, as the
   rules require.

## Measured results (local, Node v24.22.1, this VM)

Method: one process imports the baseline and this entry, sets
`--no-incremental-marking` before importing (as the harness does), warms
up, then alternates 9 timed rounds per solver over the same cases;
CPU time is `process.cpuUsage()` user+system per round. Median of 9.

| set | csv-reader 1.0.0 (median) | this entry (median) | speedup |
| --- | --- | --- | --- |
| all 6 practice cases | 733.6 ms | 186.2 ms | **3.94x** |
| work set (cases 0–3) | 551.3 ms | 148.3 ms | 3.72x |
| hold-out (cases 4–5) | 197.6 ms | 40.8 ms | 4.84x |

Correctness: all 6 practice cases identical to csv-reader (kit scorer:
`passed: 1, cases_passed: 6/6`), plus 30,136 differential checks against
the reference (130 targeted edge inputs × header true/false, 30,000
random small inputs, 6 freshly generated large cases): 0 mismatches.

Repo size: 11,501 bytes total, far under the 1 MiB limit.

## Notes / remaining risks

- Timing is measured on this shared VM, not the grading sandbox; the
  speedup is a relative figure against the baseline measured in the same
  process and rounds, which is the more robust comparison.
- The scored set is drawn from a later drand round, so its exact mix of
  quoted/multiline records differs, but the parser has no case-specific
  tuning: every path is exercised by the fuzz checks above.

---

<sub>Entered on [make.fun](https://make.fun/?ref=fk5m5avs&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
