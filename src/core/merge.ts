import type { TraceEvent } from './model';

/**
 * Repeated gestures on the same control (one `setValue` per keystroke) are merged:
 * only the last gesture is kept, plus any earlier message that the last one lacks.
 */
export function mergeRepeatedGestures(events: TraceEvent[]): TraceEvent[] {
  // Split into segments that each start with a user gesture.
  const segments: TraceEvent[][] = [[]];
  for (const e of events) {
    if (e.kind === 'user') segments.push([e]);
    else segments[segments.length - 1].push(e);
  }

  const out: TraceEvent[] = [];
  for (let i = 0; i < segments.length; i++) {
    const run = [segments[i]];
    while (i + 1 < segments.length && sameGesture(segments[i][0], segments[i + 1][0])) run.push(segments[++i]);
    if (run.length === 1) {
      out.push(...run[0]);
      continue;
    }
    const last = run[run.length - 1];
    const earlier = run.slice(0, -1).flatMap((s) => s.slice(1));
    const lastShapes = new Set(last.map(shape));
    const extras = earlier.filter((e) => !lastShapes.has(shape(e)) && lastShapes.add(shape(e)));
    out.push(last[0], ...extras, ...last.slice(1).map((e) => sinceStartOfRun(e, earlier)));
  }
  return out;
}

/** Shows a merged state change from its value before the first keystroke. */
function sinceStartOfRun(e: TraceEvent, earlier: TraceEvent[]): TraceEvent {
  if (e.kind !== 'note') return e;
  const first = earlier.find((x) => x.kind === 'note' && shape(x) === shape(e));
  if (first?.kind !== 'note') return e;
  return {
    ...e,
    changes: e.changes.map((c) => {
      const start = first.changes.find((f) => f.path === c.path);
      return start ? { ...c, before: start.before, added: start.added } : c;
    }),
  };
}

function sameGesture(a: TraceEvent | undefined, b: TraceEvent | undefined): boolean {
  return a?.kind === 'user' && b?.kind === 'user' && a.key === b.key;
}

/** What a message is, ignoring the data it carried. */
export function shape(e: TraceEvent): string {
  switch (e.kind) {
    case 'user':
      return `user:${e.key}`;
    case 'note':
      return `note:${e.over}:${e.changes.map((c) => c.path).join(',')}`;
    case 'call':
      return `${e.kind}:${e.from}:${e.to}:${e.label.split('(')[0]}`;
    default:
      return `${e.kind}:${e.from}:${e.to}`;
  }
}
