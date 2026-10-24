import { isSignal } from '@angular/core';
import { isObservable } from 'rxjs';
import { StateChange } from '../core/model';

/** One-line, size-capped description of a value for a diagram label. */
export function summarize(value: unknown, depth = 0, budget = 45): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(truncate(value, 40));
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'function') return isSignal(value) ? 'Signal' : 'fn';
  if (isObservable(value)) return 'Observable';
  if (value instanceof Error) return `${value.name}: ${truncate(value.message, 40)}`;
  if (Array.isArray(value)) {
    if (depth > 0 || value.length > 3) return `[${value.length}]`;
    return `[${value.map((v) => summarize(v, depth + 1)).join(', ')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (depth > 0) return entries.length ? `{…${entries.length}}` : '{}';
    // An entity is recognisable by its id alone.
    if ('id' in value && entries.length > 1) return `{id: ${summarize((value as { id: unknown }).id, 1)}, …}`;
    // Keep whole entries and stop once the label gets long.
    const shown: string[] = [];
    for (const [k, v] of entries) {
      if (shown.join(', ').length > budget) {
        shown.push('…');
        break;
      }
      shown.push(`${k}: ${summarize(v, depth + 1)}`);
    }
    return `{${shown.join(', ')}}`;
  }
  return String(value);
}

export function summarizeArgs(args: unknown[]): string {
  const budget = args.length > 1 ? 20 : 45;
  return truncate(args.map((a) => summarize(a, 0, budget)).join(', '), 90);
}

/** Changed keys, going one level into plain objects such as `values` or `touched`. */
export function diffState(prev: Record<string, unknown>, next: Record<string, unknown>): StateChange[] {
  const changes: StateChange[] = [];
  for (const key of Object.keys(next)) {
    const before = prev[key];
    const after = next[key];
    if (Object.is(before, after) || sameJson(before, after)) continue;
    if (isRecord(before) && Object.keys(before).length && isRecord(after) && !('id' in after)) {
      for (const sub of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (!Object.is(before[sub], after[sub])) changes.push(toChange(`${key}.${sub}`, before[sub], after[sub]));
      }
    } else {
      changes.push(toChange(key, before, after));
    }
  }
  return changes;
}

function toChange(path: string, before: unknown, after: unknown): StateChange {
  if (after === undefined) return { path };
  if (before === undefined) return { path, after: summarize(after), added: true };
  if (isScalar(before) && isScalar(after)) return { path, before: summarize(before), after: summarize(after) };
  return { path, after: summarize(after) };
}

/** A new but equal object (e.g. `{}` → `{}`) is not a change worth showing. */
function sameJson(a: unknown, b: unknown): boolean {
  return typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b);
}

function isScalar(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
