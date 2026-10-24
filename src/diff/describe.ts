import { describeChange, TraceEvent } from '../core/model';
import { DiffOp, TestDiff, textOf } from './align';

/**
 * One behaviour change as a sentence. `text` is Markdown: participants in **bold**,
 * calls and values in `code`.
 */
export interface Change {
  op: Exclude<DiffOp['op'], 'same'>;
  /** Changes with the same key are "the same change", even in different tests. */
  key: string;
  text: string;
  /** The same sentence without data, for when repeats or tests differ in their data. */
  generic: string;
  /** How much a reviewer cares: calls and test steps 3, state values 2, state keys 1, order 0. */
  weight: number;
}

export interface ChangeGroup {
  change: Change;
  tests: TestDiff[];
}

/**
 * The changes in one test, most important first. Repeats are counted rather than
 * listed, and steps that only moved are summed up in one line.
 */
export function describeTest(diff: TestDiff): Change[] {
  if (diff.status !== 'changed') return [];
  const ops = diff.ops;
  const counted = new Map<string, { change: Change; count: number; texts: Set<string> }>();
  let moved = 0;
  for (const o of ops) {
    if (o.op === 'same' || isEchoOfCall(o, ops)) continue;
    if (o.op === 'moved') {
      moved++;
      continue;
    }
    const change = describeOp(o);
    const seen = counted.get(change.key);
    if (seen) {
      seen.count++;
      seen.texts.add(change.text);
    } else counted.set(change.key, { change, count: 1, texts: new Set([change.text]) });
  }
  const changes = [...counted.values()].map(({ change, count, texts }) => {
    if (count === 1) return change;
    const text = texts.size > 1 ? change.generic : change.text;
    return { ...change, text: `${text} (${count} times)`, generic: `${change.generic} (${count} times)` };
  });
  if (moved) {
    const generic = 'Some steps happen in a different order';
    changes.push({ op: 'moved', key: 'moved', text: `${generic} (${moved})`, generic, weight: 0 });
  }
  // Stable sort keeps the order of the test within each weight.
  return changes.sort((a, b) => b.weight - a.weight);
}

/**
 * The same change across tests, most widespread first. A new call made in six tests is
 * one line, not six. Tests that are new or deleted as a whole aren't behaviour changes
 * of existing flows, so they're left out.
 */
export function groupChanges(diffs: TestDiff[]): ChangeGroup[] {
  const groups = new Map<string, ChangeGroup>();
  for (const diff of diffs) {
    for (const change of describeTest(diff)) {
      const group = groups.get(change.key);
      if (!group) {
        groups.set(change.key, { change, tests: [diff] });
        continue;
      }
      // Tests that differ in the details share the sentence without them.
      if (group.change.text !== change.text) group.change = { ...group.change, text: group.change.generic.replace(/ \(\d+ times\)$/, '') };
      if (!group.tests.includes(diff)) group.tests.push(diff);
    }
  }
  return [...groups.values()].sort((a, b) => b.change.weight - a.change.weight || b.tests.length - a.tests.length);
}

/** A response to a call that was itself added or removed says nothing new. */
function isEchoOfCall(o: DiffOp, ops: DiffOp[]): boolean {
  if ((o.op !== 'added' && o.op !== 'removed') || o.event.kind !== 'return') return false;
  const { from, to } = o.event;
  return ops.some((c) => c.op === o.op && c.event.kind === 'call' && c.event.from === to && c.event.to === from);
}

function describeOp(o: Exclude<DiffOp, { op: 'same' }>): Change {
  const e = o.event;
  const was = o.op === 'changed' ? o.before : undefined;
  const key = `${o.op}|${keyOf(e)}`;
  const text = sentence(o.op, e, was);
  const generic = e.kind === 'note' || e.kind === 'user' ? text : sentence(o.op, withoutData(e), undefined);
  const weight = e.kind === 'note' ? (o.op === 'changed' ? 2 : 1) : 3;
  return { op: o.op, key, text, generic, weight };
}

function keyOf(e: TraceEvent): string {
  switch (e.kind) {
    case 'user':
      return `user|${e.text}`;
    case 'note':
      return `note|${e.over}|${stateKeys(e).join(',')}`;
    case 'call':
      return `call|${e.from}|${e.to}|${method(e.label)}`;
    default:
      return `${e.kind}|${e.from}|${e.to}`;
  }
}

function sentence(op: Change['op'], e: TraceEvent, was: TraceEvent | undefined): string {
  switch (e.kind) {
    case 'user':
      return {
        added: `New step in the test: ${e.text}`,
        removed: `Step no longer in the test: ${e.text}`,
        changed: `Test step changed: ${e.text}${was ? ` (was ${textOf(was)})` : ''}`,
        moved: `Test step moved: ${e.text}`,
      }[op];

    case 'call': {
      const who = `**${e.from}**`;
      const whom = `**${e.to}**`;
      return {
        added: `${who} now calls ${whom} ${code(e.label)}`,
        removed: `${who} no longer calls ${whom} ${code(e.label)}`,
        changed: `${who} calls ${whom} ${code(e.label)}${was ? ` instead of ${code(textOf(was))}` : ' with different arguments'}`,
        moved: `${who} calls ${whom} ${code(e.label)} at a different point`,
      }[op];
    }

    case 'return':
      return {
        added: `**${e.from}** now answers **${e.to}** with ${code(e.label)}`,
        removed: `**${e.from}** no longer answers **${e.to}** with ${code(e.label)}`,
        changed: was ? `**${e.from}** answers **${e.to}** with ${code(e.label)} instead of ${code(textOf(was))}` : `**${e.from}** answers **${e.to}** differently`,
        moved: `**${e.from}** answers **${e.to}** at a different point`,
      }[op];

    case 'throw':
      return {
        added: `**${e.from}** now fails with ${code(e.label)}`,
        removed: `**${e.from}** no longer fails with ${code(e.label)}`,
        changed: was ? `**${e.from}** fails with ${code(e.label)} instead of ${code(textOf(was))}` : `**${e.from}** fails differently`,
        moved: `**${e.from}** fails at a different point`,
      }[op];

    case 'note': {
      const lines = e.changes.map(describeChange);
      const shown = lines.slice(0, 2).map(code).join(', ') + (lines.length > 2 ? ` and ${lines.length - 2} more` : '');
      const paths = e.changes.map((c) => c.path);
      const pathList = paths.slice(0, 3).map(code).join(', ') + (paths.length > 3 ? '…' : '');
      if (op === 'changed' && was?.kind === 'note') {
        const before = new Map(was.changes.map((c) => [c.path, describeChange(c)]));
        const differing = e.changes.filter((c) => before.get(c.path) !== describeChange(c));
        const first = differing[0] ?? e.changes[0]!;
        const old = before.get(first.path);
        return `**${e.over}** state: ${code(describeChange(first))}${old ? ` instead of ${code(old)}` : ''}`;
      }
      const keys = stateKeys(e).map(code).join(', ');
      return {
        added: `**${e.over}** now also updates ${keys}`,
        removed: `**${e.over}** no longer updates ${keys}`,
        changed: `**${e.over}** state changes differently: ${shown}`,
        moved: `**${e.over}** updates ${pathList} at a different point`,
      }[op];
    }
  }
}

/** A call as `track(…)`, a response or failure as `…`. */
function withoutData(e: Extract<TraceEvent, { kind: 'call' | 'return' | 'throw' }>): TraceEvent {
  return { ...e, label: e.kind === 'call' ? `${method(e.label)}(…)` : '…' };
}

/** Top-level state keys a note touches: `values.title` and `values.tags` are `values`. */
function stateKeys(e: Extract<TraceEvent, { kind: 'note' }>): string[] {
  return [...new Set(e.changes.map((c) => c.path.split(/[.[]/)[0]!))];
}

function method(label: string): string {
  return label.split('(')[0]!;
}

/** Inline code that survives backticks in the value. */
function code(text: string): string {
  const clipped = text.length > 80 ? `${text.slice(0, 79)}…` : text;
  return '`' + clipped.replace(/`/g, "'").replace(/\n/g, ' ⏎ ') + '`';
}
