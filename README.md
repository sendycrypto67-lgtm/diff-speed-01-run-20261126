# diff-speed: a faster makefun-diff 1.0.0

[![make.fun bounty](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/sendycrypto67-lgtm/diff-speed-01-run-20261126/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/sendycrypto67-lgtm/diff-speed-01-run-20261126/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)

A faster drop-in replacement for make.fun's own makefun-diff 1.0.0. It returns
exactly the same patch for every input, and runs about 2.5x faster than the
house baseline on the practice set (about 570 ms vs about 1,460 ms for the four
practice cases' `run()` calls, about 800 ms vs about 1,700 ms end to end).

## How it is faster

No shortcut changes the answer. The rule is the house rule, implemented
exactly: lines split after every `\n`, common prefix then common suffix
trimmed, Myers's greedy search with the deletion tie-break, hunks of 3 kept
lines either side, runs at most 6 kept lines apart sharing a hunk. The speed
comes from constant-factor work only:

- Lines are interned to small integers once, so the search compares integers
  instead of strings.
- The search keeps the furthest point per diagonal in one `Int32Array` row per
  edit count. The baseline allocates a path object (plus linked-list nodes)
  for every diagonal of every edit count; this version allocates none in the
  loop. The edit script is rebuilt by walking the stored rows backwards,
  re-deriving each forward choice with the same tie-break.
- Snakes run over sentinel-terminated integer arrays, so the inner loop needs
  no bounds checks.
- A huge positive sentinel makes the bounds checks alone reject unreachable
  diagonals, dropping two comparisons per step.

## Layout

- `solve.js` — `run(input)`, the fast diff. Self-contained, no dependencies.
- `main.ts` — the house driver, unchanged: reads `/input/cases.json`, answers
  each case alone with `run()`, writes `/output/answers.json`.

## Verification

- Practice set: all 4 cases byte-identical to the reference answers.
- Fuzzed against the house baseline: 3,000 random mutated pairs (heavy line
  repeats, CRLF, bare endings), 5,000 small random line arrays, and edge
  cases (empty texts, identical texts, single line, no trailing newline,
  all-deleted, all-inserted, 2,000 repeated lines, swapped blocks) — zero
  mismatches.
