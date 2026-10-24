import { isSignal } from '@angular/core';
import { StateChange } from '../core/model';
import { isObservable } from './observable';

/** One-line, size-capped description of a value for a diagram label. */
export function summarize(value: unknown, depth = 0, budget = 45): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(truncate(value, 40));
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'function') return isSignal(value) ? 'Signal' : 'fn';
  if (isObservable(value)) return 'Observable';
  if (value instanceof Error) return `${value.name}: ${truncate(value.message, 40)}`;
  if (isHttpError(value)) return `HTTP ${value.status}`;
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
    if (isEntityList(before) && isEntityList(after)) {
      changes.push(...diffEntities(key, before, after));
    } else if (isRecord(before) && Object.keys(before).length && isRecord(after) && !('id' in after)) {
      for (const sub of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (!Object.is(before[sub], after[sub])) changes.push(toChange(`${key}.${sub}`, before[sub], after[sub]));
      }
    } else {
      changes.push(toChange(key, before, after));
    }
  }
  return changes;
}

type Entity = Record<string, unknown> & { id: string | number };

/** Lists of objects with ids are compared item by item: `recipes[r-1].favorite: false → true`. */
function diffEntities(key: string, before: Entity[], after: Entity[]): StateChange[] {
  const old = new Map(before.map((e) => [e.id, e]));
  const now = new Map(after.map((e) => [e.id, e]));
  const changes: StateChange[] = [];
  for (const [id, entity] of now) {
    const previous = old.get(id);
    if (!previous) {
      changes.push({ path: `${key}[${id}]`, after: summarize(entity), added: true });
      continue;
    }
    if (previous === entity || sameJson(previous, entity)) continue;
    for (const field of new Set([...Object.keys(previous), ...Object.keys(entity)])) {
      if (!sameJson(previous[field], entity[field]) && !Object.is(previous[field], entity[field])) {
        changes.push(toChange(`${key}[${id}].${field}`, previous[field], entity[field]));
      }
    }
  }
  for (const id of old.keys()) if (!now.has(id)) changes.push({ path: `${key}[${id}]` });
  // A list replaced wholesale (say, first load) reads better as one line.
  return changes.length > 6 || before.length === 0 ? [toChange(key, before, after)] : changes;
}

function isEntityList(value: unknown): value is Entity[] {
  return Array.isArray(value) && value.length > 0 && value.every((v) => isRecord(v) && (typeof v['id'] === 'string' || typeof v['id'] === 'number'));
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

/** Angular's HttpErrorResponse and look-alikes, which aren't Error instances. */
function isHttpError(value: unknown): value is { status: number } {
  return typeof value === 'object' && value !== null && typeof (value as { status?: unknown }).status === 'number' && 'statusText' in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
