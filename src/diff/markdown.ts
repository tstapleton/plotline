import { toSequenceDiagram } from '../core/mermaid';
import { TestDiff } from './align';
import { DIFF_MARKS, toDiffDiagram } from './mermaid';
import { changeLines, countsText, reviewOrder, statusLabel, summarizeRun } from './summary';

/** GitHub caps comments at 65,536 characters; leave room for the footer. */
const COMMENT_LIMIT = 60_000;

export interface DiffLabels {
  base: string;
  head: string;
  /** Link to the full HTML report, e.g. a workflow artifact. */
  reportUrl?: string;
}

/**
 * A pull-request comment: a summary table, then for each changed test a Mermaid diff
 * diagram (GitHub renders these) and the same changes as text.
 */
export function diffComment(diffs: TestDiff[], labels: DiffLabels): string {
  const summary = summarizeRun(diffs);
  const ordered = reviewOrder(diffs);
  const changed = ordered.filter((d) => d.status !== 'unchanged');
  const unchanged = ordered.filter((d) => d.status === 'unchanged');
  const counts = [
    `${summary.byStatus.changed} changed`,
    `${summary.byStatus.added} added`,
    `${summary.byStatus.removed} removed`,
    `${summary.byStatus.unchanged} unchanged`,
  ].join(', ');

  const head: string[] = [
    '## Plotline: behaviour diff',
    '',
    `\`${labels.base}\` → \`${labels.head}\` · **${summary.total} tests**: ${counts}${summary.renamed ? ` (${summary.renamed} renamed)` : ''}`,
    '',
    `<sub>Each diagram is one integration test, recorded on both sides. ${DIFF_MARKS.added} added · ${DIFF_MARKS.removed} removed · ${DIFF_MARKS.changed} changed · ${DIFF_MARKS.moved} moved. Unchanged stretches are collapsed.</sub>`,
    '',
    ...(changed.length
      ? [
          '| Test | | Steps | Participants |',
          '|---|---|---|---|',
          ...changed.map((d) => `| ${cell(d.test)}${d.renamedFrom ? `<br><sub>was: ${cell(d.renamedFrom)}</sub>` : ''} | ${statusLabel(d)} | ${countsText(d)} | ${participantsText(d)} |`),
          '',
        ]
      : ['No test behaves differently.', '']),
    ...(unchanged.length
      ? [`<details><summary>${unchanged.length} unchanged test${unchanged.length > 1 ? 's' : ''}</summary>`, '', ...unchanged.map((d) => `- ${d.test}`), '', '</details>', '']
      : []),
  ];
  if (labels.reportUrl) head.push(`[Open the full report](${labels.reportUrl}) for rendered diagrams with before and after side by side.`, '');

  const sections = ordered.filter((d) => d.status !== 'unchanged').map(section);
  const out = [...head];
  let omitted = 0;
  for (const s of sections) {
    if (out.join('\n').length + s.length > COMMENT_LIMIT) omitted++;
    else out.push(s);
  }
  if (omitted) out.push(`_${omitted} more test${omitted > 1 ? 's' : ''} left out to fit GitHub's comment size limit; see the full report._`, '');
  return out.join('\n');
}

function section(d: TestDiff): string {
  const title = d.status === 'added' ? 'New test' : d.status === 'removed' ? 'Removed test' : d.renamedFrom ? 'Renamed and changed' : 'Changed';
  const meta = [`\`${d.spec}\``, countsText(d)];
  if (d.renamedFrom) meta.push(`was “${d.renamedFrom}”`);
  if (d.participants.added.length) meta.push(`new participant: **${d.participants.added.join(', ')}**`);
  if (d.participants.removed.length) meta.push(`no longer calls: **${d.participants.removed.join(', ')}**`);

  // A brand new or deleted test reads better as a plain diagram than as all + or all −.
  const diagram = d.status === 'added' ? toSequenceDiagram(d.head!) : d.status === 'removed' ? toSequenceDiagram(d.base!) : toDiffDiagram(d);
  const lines = d.status === 'changed' ? changeLines(d) : [];
  const shown = lines.slice(0, 20);

  return [
    `### ${title}: ${d.test}`,
    '',
    meta.join(' · '),
    '',
    `<details${d.status === 'changed' ? ' open' : ''}><summary>Sequence ${d.status === 'changed' ? 'diff' : 'diagram'}</summary>`,
    '',
    '```mermaid',
    diagram,
    '```',
    '',
    '</details>',
    '',
    ...(lines.length
      ? [
          '<details><summary>Changes as text</summary>',
          '',
          ...shown.map((l) => `- ${DIFF_MARKS[l.op]} ${l.who}: \`${code(l.what)}\`${l.was ? ` (was \`${code(l.was)}\`)` : ''}`),
          ...(lines.length > shown.length ? [`- … and ${lines.length - shown.length} more`] : []),
          '',
          '</details>',
          '',
        ]
      : []),
  ].join('\n');
}

function participantsText(d: TestDiff): string {
  const parts = [...d.participants.added.map((p) => `+ ${p}`), ...d.participants.removed.map((p) => `− ${p}`)];
  return parts.join(', ');
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

function code(text: string): string {
  return text.replace(/`/g, "'");
}
