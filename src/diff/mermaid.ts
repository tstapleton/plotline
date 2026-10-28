import { castOf, escapeText, noteText } from '../core/mermaid';
import { describeChange, type Participant, type TraceEvent } from '../core/model';
import { sectionMark, splitSections } from '../core/sections';
import { type DiffOp, latestTrace, type TestDiff, textOf } from './align';

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
 * added, removed and changed steps inside coloured blocks. A user action whose steps
 * didn't change collapses to one line naming it; within a changed one, unchanged
 * stretches longer than `context` steps either side of a change collapse too.
 */
export function toDiffDiagram(diff: TestDiff, context = 2): string {
  const participants = uniqueParticipants([...(diff.head?.participants ?? []), ...(diff.base?.participants ?? [])]);
  const ui = latestTrace(diff).ui;
  const everyEvent = diff.ops.flatMap((o) => (o.op === 'changed' ? [o.event, o.before] : [o.event]));
  const added = new Set(diff.participants.added);
  const removed = new Set(diff.participants.removed);
  const cast = castOf(ui, participants, everyEvent, (name) =>
    added.has(name) ? `${name} (new)` : removed.has(name) ? `${name} (removed)` : name,
  );
  const collapse = diff.status === 'changed';

  const lines = ['sequenceDiagram', ...cast.declarations];
  let block: DiffOp['op'] | undefined;
  const closeBlock = () => {
    if (block && block !== 'same') lines.push('  end');
    block = undefined;
  };
  const collapsed = (title: string, steps: number) => {
    closeBlock();
    lines.push(`  Note over ${cast.span}: ⋯ ${escapeText(title)} · ${steps} unchanged step${steps === 1 ? '' : 's'} ⋯`);
  };

  const sections = splitSections(diff.ops, (o) => o.event.kind === 'user');
  for (const section of sections) {
    const action = section.number ? section.items[0].event : undefined;
    const title = action?.kind === 'user' ? `${sectionMark(section.number)} ${action.text}` : 'Setup';

    if (collapse && section.items.every((o) => o.op === 'same')) {
      collapsed(title, section.items.length - (action ? 1 : 0));
      continue;
    }
    if (!action && sections.length > 1) {
      closeBlock();
      lines.push(`  Note over ${cast.span}: Setup`);
    }

    // The user action itself always shows, so the section keeps its heading.
    const shown = visibleOps(section.items, collapse ? context : Infinity);
    if (action) shown[0] = true;
    for (let i = 0; i < section.items.length; i++) {
      if (!shown[i]) {
        let hidden = 0;
        while (i < section.items.length && !shown[i]) {
          hidden++;
          i++;
        }
        i--;
        closeBlock();
        lines.push(`  Note over ${cast.span}: ⋯ ${hidden} unchanged step${hidden > 1 ? 's' : ''} ⋯`);
        continue;
      }
      const o = section.items[i];
      if (o.op !== block) {
        closeBlock();
        if (o.op !== 'same') lines.push(`  rect ${DIFF_FILLS[o.op]}`);
        block = o.op;
      }
      const indent = o.op === 'same' ? '  ' : '    ';
      const mark = o.event.kind === 'user' ? sectionMark(section.number) : undefined;
      for (const line of linesFor(o, cast.message, cast.id, mark)) lines.push(indent + line);
    }
  }
  closeBlock();
  return lines.join('\n');
}

function linesFor(
  o: DiffOp,
  message: (e: TraceEvent, label?: string) => string,
  id: (name: string) => string,
  sectionMark?: string,
): string[] {
  const numbered = (e: TraceEvent, label: string) =>
    sectionMark && e.kind === 'user' ? label.replace(e.text, `${sectionMark} ${e.text}`) : label;
  if (o.op === 'same')
    return [o.event.kind === 'user' ? message(o.event, numbered(o.event, o.event.text)) : message(o.event)];
  if (o.op === 'changed') {
    const was = o.event.kind === 'note' ? changedNoteLines(o.before, o.event) : textOf(o.before);
    const [a, b] = endsOf(o.event);
    return [
      message(o.event, numbered(o.event, prefixed(DIFF_MARKS.changed, o.event))),
      `Note over ${id(a)}${a === b ? '' : `,${id(b)}`}: was ${escapeText(was)}`,
    ];
  }
  return [message(o.event, numbered(o.event, prefixed(DIFF_MARKS[o.op], o.event)))];
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

function uniqueParticipants(list: Participant[]): Participant[] {
  const seen = new Map<string, Participant>();
  for (const p of list) if (!seen.has(p.name)) seen.set(p.name, p);
  return [...seen.values()];
}
