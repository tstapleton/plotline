import { describeChange, TraceEvent } from '../core/model';
import { DiffOp, TestDiff, TestStatus, textOf } from './align';
import { DIFF_MARKS } from './mermaid';

export interface RunSummary {
  total: number;
  byStatus: Record<TestStatus, number>;
  renamed: number;
}

export function summarizeRun(diffs: TestDiff[]): RunSummary {
  const byStatus: Record<TestStatus, number> = { added: 0, removed: 0, changed: 0, unchanged: 0 };
  for (const d of diffs) byStatus[d.status]++;
  return { total: diffs.length, byStatus, renamed: diffs.filter((d) => d.renamedFrom).length };
}

/** Changed tests first (biggest first), then added, removed and unchanged. */
export function reviewOrder(diffs: TestDiff[]): TestDiff[] {
  const rank: Record<TestStatus, number> = { changed: 0, added: 1, removed: 2, unchanged: 3 };
  const size = (d: TestDiff) => d.counts.added + d.counts.removed + d.counts.changed;
  return [...diffs].sort((a, b) => rank[a.status] - rank[b.status] || size(b) - size(a) || a.test.localeCompare(b.test));
}

/** e.g. `+7 −2 Δ1 ↕10`. */
export function countsText(d: TestDiff): string {
  if (d.status === 'added') return `${d.ops.length} steps`;
  if (d.status === 'removed') return `${d.ops.length} steps`;
  if (d.status === 'unchanged') return 'no changes';
  const parts: string[] = [];
  if (d.counts.added) parts.push(`${DIFF_MARKS.added}${d.counts.added}`);
  if (d.counts.removed) parts.push(`${DIFF_MARKS.removed}${d.counts.removed}`);
  if (d.counts.changed) parts.push(`${DIFF_MARKS.changed}${d.counts.changed}`);
  if (d.counts.moved) parts.push(`${DIFF_MARKS.moved}${d.counts.moved}`);
  return parts.join(' ');
}

export function statusLabel(d: TestDiff): string {
  if (d.renamedFrom) return 'renamed';
  return d.status;
}

export interface ChangeLine {
  op: Exclude<DiffOp['op'], 'same'>;
  who: string;
  what: string;
  was?: string;
}

/** The test's changes as sentences, for people who'd rather read than look. */
export function changeLines(d: TestDiff): ChangeLine[] {
  const lines: ChangeLine[] = [];
  for (const o of d.ops) {
    if (o.op === 'same') continue;
    lines.push({ op: o.op, who: whoOf(o.event), what: whatOf(o.event), ...(o.op === 'changed' ? { was: whatOf(o.before) } : {}) });
  }
  return lines;
}

function whoOf(e: TraceEvent): string {
  switch (e.kind) {
    case 'user':
      return `User → ${e.to}`;
    case 'note':
      return `${e.over} state`;
    case 'return':
      return `${e.from} ⇠ ${e.to}`;
    case 'throw':
      return `${e.from} ✕ ${e.to}`;
    default:
      return `${e.from} → ${e.to}`;
  }
}

function whatOf(e: TraceEvent): string {
  return e.kind === 'note' ? e.changes.map(describeChange).join(', ') : textOf(e);
}
