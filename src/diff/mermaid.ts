import { castOf, escape, noteText } from '../core/mermaid';
import { describeChange, Participant, TraceEvent } from '../core/model';
import { DiffOp, TestDiff, textOf } from './align';

/** Translucent fills, so the highlights read on light and dark themes alike. */
export const DIFF_FILLS = {
  added: 'rgba(46, 160, 67, 0.16)',
  removed: 'rgba(218, 54, 51, 0.14)',
  changed: 'rgba(212, 167, 44, 0.24)',
  moved: 'rgba(56, 132, 255, 0.14)',
};

export const DIFF_MARKS = { added: '+', removed: '−', changed: 'Δ', moved: '↕' } as const;

/**
 * One sequence diagram for a test's base and head runs: unchanged steps as usual,
 * added, removed and changed steps inside coloured blocks, and unchanged stretches
 * longer than `context` steps either side of a change collapsed into a note.
 */
export function toDiffDiagram(diff: TestDiff, context = 2): string {
  const participants = uniqueParticipants([...(diff.head?.participants ?? []), ...(diff.base?.participants ?? [])]);
  const ui = (diff.head ?? diff.base)!.ui;
  const everyEvent = diff.ops.flatMap((o) => (o.op === 'changed' ? [o.event, o.before] : [o.event]));
  const added = new Set(diff.participants.added);
  const removed = new Set(diff.participants.removed);
  const cast = castOf(ui, participants, everyEvent, (name) =>
    added.has(name) ? `${name} (new)` : removed.has(name) ? `${name} (removed)` : name,
  );
  const span = spanOf(cast.declarations);

  const shown = visibleOps(diff.ops, diff.status === 'changed' ? context : Infinity);
  const lines = ['sequenceDiagram', ...cast.declarations];
  let block: DiffOp['op'] | undefined;
  const closeBlock = () => {
    if (block && block !== 'same') lines.push('  end');
    block = undefined;
  };

  for (let i = 0; i < diff.ops.length; i++) {
    if (!shown[i]) {
      let hidden = 0;
      while (i < diff.ops.length && !shown[i]) {
        hidden++;
        i++;
      }
      i--;
      closeBlock();
      lines.push(`  Note over ${span}: ⋯ ${hidden} unchanged step${hidden > 1 ? 's' : ''} ⋯`);
      continue;
    }

    const o = diff.ops[i];
    if (o.op !== block) {
      closeBlock();
      if (o.op !== 'same') lines.push(`  rect ${DIFF_FILLS[o.op]}`);
      block = o.op;
    }
    const indent = o.op === 'same' ? '  ' : '    ';
    for (const line of linesFor(o, cast.message, cast.id)) lines.push(indent + line);
  }
  closeBlock();
  return lines.join('\n');
}

function linesFor(o: DiffOp, message: (e: TraceEvent, label?: string) => string, id: (name: string) => string): string[] {
  if (o.op === 'same') return [message(o.event)];
  if (o.op === 'changed') {
    const was = o.event.kind === 'note' ? changedNoteLines(o.before, o.event) : textOf(o.before);
    const [a, b] = endsOf(o.event);
    return [message(o.event, prefixed(DIFF_MARKS.changed, o.event)), `Note over ${id(a)}${a === b ? '' : `,${id(b)}`}: was ${escape(was)}`];
  }
  return [message(o.event, prefixed(DIFF_MARKS[o.op], o.event))];
}

/** Label with a diff mark in front; notes keep their line breaks. */
function prefixed(mark: string, e: TraceEvent): string {
  if (e.kind === 'note') return `${mark} ${noteText(e.changes.map(describeChange))}`;
  return `${mark} ${textOf(e)}`;
}

/** For a changed state note, the old values of the paths that differ. */
function changedNoteLines(before: TraceEvent, after: TraceEvent): string {
  if (before.kind !== 'note' || after.kind !== 'note') return textOf(before);
  const now = new Set(after.changes.map(describeChange));
  const differing = before.changes.map(describeChange).filter((line) => !now.has(line));
  return differing.join(', ') || textOf(before);
}

function endsOf(e: TraceEvent): [string, string] {
  if (e.kind === 'note') return [e.over, e.over];
  if (e.kind === 'user') return ['User', e.to];
  return [e.from, e.to];
}

/** Which ops to draw: every change plus `context` unchanged steps either side. */
function visibleOps(ops: DiffOp[], context: number): boolean[] {
  if (context === Infinity) return ops.map(() => true);
  const shown = ops.map(() => false);
  ops.forEach((o, i) => {
    if (o.op === 'same') return;
    for (let j = Math.max(0, i - context); j <= Math.min(ops.length - 1, i + context); j++) shown[j] = true;
  });
  // Hiding a single step saves nothing over showing it.
  for (let i = 0; i < ops.length; i++) {
    if (!shown[i] && (i === 0 || shown[i - 1]) && (i === ops.length - 1 || shown[i + 1])) shown[i] = true;
  }
  return shown;
}

/** `first,last` participant ids, for notes spanning the whole diagram. */
function spanOf(declarations: string[]): string {
  const ids = declarations.map((d) => /(?:participant|actor) (\S+) as/.exec(d)?.[1]).filter((x): x is string => !!x);
  return ids.length > 1 ? `${ids[0]},${ids[ids.length - 1]}` : ids[0];
}

function uniqueParticipants(list: Participant[]): Participant[] {
  const seen = new Map<string, Participant>();
  for (const p of list) if (!seen.has(p.name)) seen.set(p.name, p);
  return [...seen.values()];
}
