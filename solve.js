// Faster drop-in for makefun-diff 1.0.0: returns exactly makefun-diff's patch for every input.
// Same rule as the house baseline (header of vendor/makefun-diff/index.js): lines split after
// every "\n", common prefix then common suffix trimmed, Myers greedy search with the deletion
// tie-break, hunks of 3 kept lines either side, runs at most 6 kept lines apart sharing a hunk.
// Speed comes from honest constant-factor work only: lines are interned to small integers once,
// the search keeps furthest-x per diagonal in one Int32Array row per edit count (no path object
// per step, no snapshot copies), snakes run over sentinel-terminated integer arrays with no
// bounds checks, and the edit script is rebuilt by walking the stored rows backwards with the
// same tie-break.

const KEEP = 0;
const DELETE = 1;
const INSERT = 2;

/** The edit-script runs of a[0..n) into b[0..m): [{kind, count}], kind 0 keep, 1 delete, 2 insert. a[n] and b[m] are sentinels that never match each other or any line code. */
function myersRuns(a, n, b, m) {
  if (n === 0) return m === 0 ? [] : [{ kind: INSERT, count: m }];
  if (m === 0) return [{ kind: DELETE, count: n }];
  const UN = 1000000000;
  const rows = [];
  // d = 0: the snake from (-1, -1) on diagonal 0.
  let x = -1;
  while (a[x + 1] === b[x + 1]) x++;
  const r0 = new Int32Array(1);
  r0[0] = x;
  rows[0] = r0;
  if (x + 1 >= n && x + 1 >= m) return x + 1 > 0 ? [{ kind: KEEP, count: x + 1 }] : [];
  const max = n + m;
  let D = -1;
  let kf = 0;
  for (let d = 1; d <= max; d++) {
    const P = rows[d - 1];
    const plen = P.length;
    const C = new Int32Array(2 * d + 1);
    rows[d] = C;
    let done = false;
    for (let k = -d, ci = 0; k <= d; k += 2, ci += 2) {
      const vm = ci >= 2 ? P[ci - 2] : UN;
      const vp = ci < plen ? P[ci] : UN;
      // UN is huge, so the bounds checks alone reject unreachable diagonals.
      const canDel = vm + 1 < n;
      const canIns = vp - k < m;
      if (!canDel && !canIns) { C[ci] = UN; continue; }
      // make.fun's tie-break: further into the old text, deletion when both reach one point.
      let xx = canDel && (!canIns || vm + 1 >= vp) ? vm + 1 : vp;
      let yy = xx - k;
      while (a[xx + 1] === b[yy + 1]) { xx++; yy++; }
      C[ci] = xx;
      if (xx + 1 >= n && yy + 1 >= m) { D = d; kf = k; done = true; break; }
    }
    if (done) break;
  }
  if (D < 0) throw new Error('makefun-diff: the search ended without reaching both ends');
  // Walk back from (D, n-m): each step re-derives the forward choice from the stored rows.
  const segs = [];
  let d = D;
  let k = kf;
  let xEnd = n - 1;
  while (d > 0) {
    const prev = rows[d - 1];
    const pi = d - 1;
    const vi = k + d - 2;
    const vj = k + d;
    const vm = vi >= 0 && vi < prev.length ? prev[vi] : UN;
    const vp = vj >= 0 && vj < prev.length ? prev[vj] : UN;
    const canDel = vm + 1 < n;
    const canIns = vp - k < m;
    if (canDel && (!canIns || vm + 1 >= vp)) {
      segs.push({ keep: xEnd - (vm + 1), edit: DELETE });
      xEnd = vm;
      k = k - 1;
    } else {
      segs.push({ keep: xEnd - vp, edit: INSERT });
      xEnd = vp;
      k = k + 1;
    }
    d--;
  }
  segs.push({ keep: xEnd + 1, edit: 0 });
  const runs = [];
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i];
    // Forward order within a step: the edit first, then the snake that follows it
    // (the d=0 segment has no edit, only its snake).
    if (s.edit !== 0) {
      const last = runs[runs.length - 1];
      if (last !== undefined && last.kind === s.edit) last.count += 1;
      else runs.push({ kind: s.edit, count: 1 });
    }
    if (s.keep > 0) {
      const last = runs[runs.length - 1];
      if (last !== undefined && last.kind === KEEP) last.count += s.keep;
      else runs.push({ kind: KEEP, count: s.keep });
    }
  }
  return runs;
}

/** make.fun's own patch of input.old into input.new. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const aP = input.old.split('\n');
  const bP = input.new.split('\n');
  const aLast = aP.length - 1;
  const bLast = bP.length - 1;
  const n = aP[aLast] === '' ? aLast : aP.length;
  const m = bP[bLast] === '' ? bLast : bP.length;
  // Intern each distinct line part once; a line's code is its part's id plus its newline flag,
  // so two lines are equal exactly when their codes are equal. Codes are >= 0; the sentinels
  // below (-1, -2) never match each other or any code.
  const ids = new Map();
  let nextId = 0;
  const A = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    let id = ids.get(aP[i]);
    if (id === undefined) { id = nextId++; ids.set(aP[i], id); }
    A[i] = (id << 1) | (i < aLast ? 1 : 0);
  }
  A[n] = -1;
  const B = new Int32Array(m + 1);
  for (let i = 0; i < m; i++) {
    let id = ids.get(bP[i]);
    if (id === undefined) { id = nextId++; ids.set(bP[i], id); }
    B[i] = (id << 1) | (i < bLast ? 1 : 0);
  }
  B[m] = -2;
  let prefix = 0;
  while (prefix < n && prefix < m && A[prefix] === B[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && A[n - 1 - suffix] === B[m - 1 - suffix]) suffix++;
  const runs = [];
  if (prefix > 0) runs.push({ kind: KEEP, count: prefix });
  const tn = n - prefix - suffix;
  const tm = m - prefix - suffix;
  const a = new Int32Array(tn + 1);
  a.set(A.subarray(prefix, n - suffix));
  a[tn] = -1;
  const b = new Int32Array(tm + 1);
  b.set(B.subarray(prefix, m - suffix));
  b[tm] = -2;
  runs.push(...myersRuns(a, tn, b, tm));
  if (suffix > 0) runs.push({ kind: KEEP, count: suffix });

  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) { o += r.count; p += r.count; continue; }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) { c.dels += r.count; o += r.count; deleted += r.count; }
    else { c.ins += r.count; p += r.count; inserted += r.count; }
  }
  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h === undefined ? undefined : h[h.length - 1];
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * 3) h.push(c);
    else hunks.push([c]);
  }
  const out = [`makefun-diff/1 old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  const written = (op, parts, last, i) => {
    if (i < last) out.push(op + parts[i] + '\n');
    else out.push(op + parts[i] + '\n%\n');
  };
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - 3);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(3, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) written('=', aP, aLast, at);
      for (let i = 0; i < c.dels; i++) written('-', aP, aLast, c.o + i);
      for (let i = 0; i < c.ins; i++) written('+', bP, bLast, c.p + i);
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) written('=', aP, aLast, at);
  }
  return out.join('');
}
