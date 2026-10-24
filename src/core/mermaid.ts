import { mergeRepeatedGestures } from './merge';
import { describeChange, Participant, TraceEvent, TraceFile } from './model';

/** Renders one recorded test as a Mermaid sequence diagram. */
export function toSequenceDiagram(trace: TraceFile): string {
  const events = mergeRepeatedGestures(trace.events);
  const cast = castOf(trace.ui, trace.participants, events);
  return ['sequenceDiagram', '  autonumber', ...cast.declarations, ...events.map((e) => `  ${cast.message(e)}`)].join('\n');
}

export interface Cast {
  /** `actor` / `participant` lines, with grouped participants inside `box … end`. */
  declarations: string[];
  /** Mermaid id for a participant name. */
  id(name: string): string;
  /** The Mermaid line for one event (without indentation). */
  message(event: TraceEvent, label?: string): string;
}

/**
 * Orders participants by first appearance, keeping each group contiguous so it can be
 * drawn as a box. The UI always comes first, after the user.
 */
export function castOf(ui: string, participants: Participant[], events: TraceEvent[], decorate: (name: string) => string = (n) => n): Cast {
  const seen: string[] = [ui];
  const add = (name: string) => !seen.includes(name) && seen.push(name);
  for (const e of events) {
    if (e.kind === 'note') add(e.over);
    else if (e.kind !== 'user') {
      add(e.from);
      add(e.to);
    }
  }

  const groupOf = (name: string) => participants.find((p) => p.name === name)?.group;
  const slots: string[] = [];
  for (const name of seen) {
    const slot = groupOf(name) ?? `\u0000${name}`;
    if (!slots.includes(slot)) slots.push(slot);
  }
  const ordered = [...seen].sort((a, b) => slots.indexOf(groupOf(a) ?? `\u0000${a}`) - slots.indexOf(groupOf(b) ?? `\u0000${b}`));

  const id = (name: string) => (name === 'User' ? 'U' : `P${ordered.indexOf(name)}`);

  const declarations: string[] = [];
  if (events.some((e) => e.kind === 'user')) declarations.push('  actor U as User');
  let openGroup: string | undefined;
  for (const name of ordered) {
    const group = groupOf(name);
    if (group !== openGroup) {
      if (openGroup) declarations.push('  end');
      if (group) declarations.push(`  box ${escape(group)}`);
      openGroup = group;
    }
    declarations.push(`  ${group ? '  ' : ''}participant ${id(name)} as ${escape(decorate(name))}`);
  }
  if (openGroup) declarations.push('  end');

  const message = (e: TraceEvent, label?: string): string => {
    switch (e.kind) {
      case 'user':
        return `U->>${id(e.to)}: ${escape(label ?? e.text)}`;
      case 'call':
        return `${id(e.from)}->>${id(e.to)}: ${escape(label ?? e.label)}`;
      case 'return':
        return `${id(e.from)}-->>${id(e.to)}: ${escape(label ?? e.label)}`;
      case 'throw':
        return `${id(e.from)}--x${id(e.to)}: ${escape(label ?? e.label)}`;
      case 'note':
        return `Note over ${id(e.over)}: ${label ?? noteText(e.changes.map(describeChange))}`;
    }
  };

  return { declarations, id, message };
}

/** Joins note lines, showing at most five. */
export function noteText(lines: string[]): string {
  const shown = lines.slice(0, 5).map(escape);
  if (lines.length > 5) shown.push(`…${lines.length - 5} more`);
  return shown.join('<br/>');
}

/** Mermaid treats `;` and `#` specially, `<`/`>` as HTML, and a newline ends the message. */
export function escape(text: string): string {
  return text
    .replace(/[#;<>]/g, (c) => ({ '#': '#35;', ';': '#59;', '<': '#lt;', '>': '#gt;' })[c]!)
    .replace(/\r?\n/g, ' ⏎ ');
}
