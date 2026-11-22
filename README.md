# Fast CSV Reader

[![csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/firehorse20/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/firehorse20/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A fast CSV reader for the make.fun `csv-reader-speed-01-run-20261121` bounty.
It returns exactly the answer of the house reference program (csv-reader 1.0.0),
but parses with chunk scanning instead of one character at a time.

## How it works

`solve.js` exports `run(input)` returning `{columns, rows, errors}` for one
`{text, header}` case, following the reference broken-row policy exactly:
BOM dropped, LF/CRLF record ends, stray CRs dropped with a `stray_cr` error,
quoted fields with doubled quotes and LF-normalised line breaks, junk after a
closing quote, unterminated quotes re-read as unquoted, short/long rows padded
or cut to the first record's width with `short_row`/`long_row` errors.

Speed comes from the scanning, not from cutting corners:

- An unquoted field is taken with two `indexOf` calls (next comma, next LF)
  and one `slice`. Stray CRs are walked inside that small slice only.
- A quoted field is taken with `indexOf('"')` and one slice per segment;
  line breaks inside quotes are normalised by one regex replace per segment
  that holds one.
- Nothing on the hot path reads one character at a time, and no public parser
  is wrapped: papaparse and d3-dsv answer differently on broken rows, so they
  cannot be used.

`main.ts` is the house driver, kept byte-identical: it reads every case from
`/input/cases.json`, answers each with `run()` from `solve.js`, and writes
`/output/answers.json`.

## Measured speed

On this machine, whole driver runs (`node main.ts`, same input, same machine):

| set | this entry | house baseline 1.0.0 | speedup |
| --- | --- | --- | --- |
| practice (6 cases, 11 MB) | 797 ms | 1505 ms | 1.89× |
| 5 freshly drawn sets (30 cases) | 682–796 ms per set | 1206–1301 ms per set | 1.68× overall |

Parse-only, in process: ~140 ms per set warm vs ~530–830 ms for the
reference reader. Every answer is byte-identical to the oracle's on the
practice set (6/6) and on all 30 freshly drawn cases, and two end-to-end
runs write byte-identical `answers.json`.
