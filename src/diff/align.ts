import { mergeRepeatedGestures, shape } from '../core/merge';
import { describeChange, TraceEvent, TraceFile, traceKey } from '../core/model';

export type DiffOp =
  | { op: 'same'; event: TraceEvent }
  | { op: 'added'; event: TraceEvent }
  | { op: 'removed'; event: TraceEvent }
  /** Same participants and method (or state keys) as before, different data. */
  | { op: 'changed'; event: TraceEvent; before: TraceEvent }
  /** Identical message that now happens at a different point within the same gesture. */
  | { op: 'moved'; event: TraceEvent };

export type TestStatus = 'added' | 'removed' | 'changed' | 'unchanged';

export interface TestDiff {
  key: string;
  spec: string;
  test: string;
  status: TestStatus;
  /** Set when a test with a different name in the base run had mostly the same steps. */
  renamedFrom?: string;
  base?: TraceFile;
  head?: TraceFile;
  ops: DiffOp[];
  counts: { added: number; removed: number; changed: number; moved: number };
  participants: { added: string[]; removed: string[] };
}

/**
 * Pairs tests across two runs by spec and name, and diffs each pair. A test that only
 * exists on one side is paired with a same-spec test from the other side when at least
 * `renameThreshold` of their steps line up, and reported as renamed.
 */
export function diffRuns(base: TraceFile[], head: TraceFile[], renameThreshold = 0.6): TestDiff[] {
  const baseByKey = new Map(base.map((t) => [traceKey(t), t]));
  const headByKey = new Map(head.map((t) => [traceKey(t), t]));
  const onlyBase = base.filter((t) => !headByKey.has(traceKey(t)));
  const onlyHead = head.filter((t) => !baseByKey.has(traceKey(t)));

  const renamedTo = new Map<TraceFile, TraceFile>();
  for (const h of onlyHead) {
    const candidates = onlyBase.filter((b) => b.spec === h.spec && ![...renamedTo.values()].includes(b));
    const scored = candidates.map((b) => ({ b, score: similarity(b, h) })).sort((x, y) => y.score - x.score);
    if (scored[0] && scored[0].score >= renameThreshold) renamedTo.set(h, scored[0].b);
  }
  const renamedBases = new Set(renamedTo.values());

  const diffs: TestDiff[] = [];
  for (const h of head) {
    const b = baseByKey.get(traceKey(h)) ?? renamedTo.get(h);
    const d = diffTest(b, h);
    if (b && b.test !== h.test) d.renamedFrom = b.test;
    diffs.push(d);
  }
  for (const b of onlyBase) if (!renamedBases.has(b)) diffs.push(diffTest(b, undefined));
  return diffs;
}

/** Share of steps (by shape) the two tests have in common, from 0 to 1. */
function similarity(a: TraceFile, b: TraceFile): number {
  const x = mergeRepeatedGestures(a.events);
  const y = mergeRepeatedGestures(b.events);
  const kept = diffEvents(x, y).filter((o) => o.op === 'same' || o.op === 'changed').length;
  return (2 * kept) / (x.length + y.length || 1);
}

export function diffTest(base: TraceFile | undefined, head: TraceFile | undefined): TestDiff {
  const either = (head ?? base)!;
  const ops = diffEvents(base ? mergeRepeatedGestures(base.events) : [], head ? mergeRepeatedGestures(head.events) : []);
  const counts = { added: 0, removed: 0, changed: 0, moved: 0 };
  for (const o of ops) if (o.op !== 'same') counts[o.op]++;

  const before = new Set(base ? namesIn(base) : []);
  const after = new Set(head ? namesIn(head) : []);
  const status: TestStatus = !base ? 'added' : !head ? 'removed' : ops.every((o) => o.op === 'same') ? 'unchanged' : 'changed';

  return {
    key: traceKey(either),
    spec: either.spec,
    test: either.test,
    status,
    base,
    head,
    ops,
    counts,
    participants: {
      added: base ? [...after].filter((n) => !before.has(n)) : [],
      removed: head ? [...before].filter((n) => !after.has(n)) : [],
    },
  };
}

/**
 * Aligns two event lists with a weighted longest common subsequence: an identical
 * message scores 2, a message of the same shape with different data scores 1, so exact
 * matches win and changed data shows as "changed" rather than removed + added.
 */
export function diffEvents(base: TraceEvent[], head: TraceEvent[]): DiffOp[] {
  const n = base.length;
  const m = head.length;
  const baseShapes = base.map(shape);
  const headShapes = head.map(shape);
  const baseText = base.map(textOf);
  const headText = head.map(textOf);
  const score = (i: number, j: number) =>
    baseShapes[i] !== headShapes[j] ? 0 : baseText[i] === headText[j] ? 2 : 1;

  // best[i][j] = best score aligning base[i..] with head[j..]
  const best = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const s = score(i, j);
      best[i][j] = Math.max(best[i + 1][j], best[i][j + 1], s ? s + best[i + 1][j + 1] : 0);
    }
  }

  let ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    const s = i < n && j < m ? score(i, j) : 0;
    if (s && best[i][j] === s + best[i + 1][j + 1]) {
      ops.push(s === 2 ? { op: 'same', event: head[j] } : { op: 'changed', event: head[j], before: base[i] });
      i++;
      j++;
    } else if (j < m && (i === n || best[i][j + 1] >= best[i + 1][j])) {
      ops.push({ op: 'added', event: head[j++] });
    } else {
      ops.push({ op: 'removed', event: base[i++] });
    }
  }
  return detectMoves(ops);
}

/**
 * An identical message removed in one place and added in another, with no unchanged
 * user gesture in between, is one message that moved: keep it once, where it is now.
 */
function detectMoves(ops: DiffOp[]): DiffOp[] {
  const gesture = (index: number) => ops.slice(0, index).filter((o) => o.op === 'same' && o.event.kind === 'user').length;
  const dropped = new Set<number>();
  const result = [...ops];
  ops.forEach((o, i) => {
    if (o.op !== 'added') return;
    const match = ops.findIndex(
      (r, j) => r.op === 'removed' && !dropped.has(j) && shape(r.event) === shape(o.event) && textOf(r.event) === textOf(o.event) && gesture(j) === gesture(i),
    );
    if (match < 0) return;
    dropped.add(match);
    result[i] = { op: 'moved', event: o.event };
  });
  return result.filter((_, i) => !dropped.has(i));
}

/** Everything a reader sees for an event, used to decide "same" vs "changed". */
export function textOf(e: TraceEvent): string {
  switch (e.kind) {
    case 'user':
      return e.text;
    case 'note':
      return e.changes.map(describeChange).join('\n');
    default:
      return e.label;
  }
}

function namesIn(trace: TraceFile): string[] {
  const names = new Set<string>();
  for (const e of trace.events) {
    if (e.kind === 'note') names.add(e.over);
    else if (e.kind === 'user') names.add(e.to);
    else {
      names.add(e.from);
      names.add(e.to);
    }
  }
  return [...names];
}
