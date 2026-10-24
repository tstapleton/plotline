/** A store state change, already summarized for display. */
export interface StateChange {
  path: string;
  /** Only kept when both sides are scalars, so the note can read `before → after`. */
  before?: string;
  /** Absent when the key was removed. */
  after?: string;
  added?: boolean;
}

export type TraceEvent =
  /** `key` identifies the control and gesture, so repeated keystrokes can be merged. */
  | { kind: 'user'; to: string; text: string; key: string }
  | { kind: 'call'; from: string; to: string; label: string }
  | { kind: 'return'; from: string; to: string; label: string }
  | { kind: 'throw'; from: string; to: string; label: string }
  | { kind: 'note'; over: string; changes: StateChange[] };

export interface Participant {
  name: string;
  /** Participants sharing a group are drawn inside one box, e.g. "Host app (mocked)". */
  group?: string;
}

/** What one test recorded. Written to `plotline/<spec>/<test>.json`. */
export interface TraceFile {
  version: 1;
  /** Spec file path relative to the project, e.g. `src/app/.../form.integration.spec.ts`. */
  spec: string;
  /** Full Jest test name, including describe blocks. */
  test: string;
  /** Participant that stands for the components. */
  ui: string;
  participants: Participant[];
  events: TraceEvent[];
}

export function describeChange({ path, before, after }: StateChange): string {
  if (after === undefined) return `${path}: removed`;
  return before === undefined ? `${path}: ${after}` : `${path}: ${before} → ${after}`;
}

/** Stable key for matching the same test across two runs. */
export function traceKey(trace: TraceFile): string {
  return `${trace.spec} › ${trace.test}`;
}
