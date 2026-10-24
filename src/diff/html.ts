import { toSequenceDiagram } from '../core/mermaid';
import { html, page, slug, svgOf } from '../report/page';
import { TestDiff } from './align';
import { DiffLabels } from './markdown';
import { DIFF_MARKS, toDiffDiagram } from './mermaid';
import { describeTest, groupChanges } from './describe';
import { Unstable } from './stability';
import { countsText, reviewOrder, statusLabel, summarizeRun } from './summary';

/** The full review page: every changed test's diff, plus before and after diagrams. */
export function diffPage(diffs: TestDiff[], labels: DiffLabels, unstable: Unstable[] = []): string {
  const summary = summarizeRun(diffs);
  const ordered = reviewOrder(diffs);
  const title = `Behaviour diff: ${labels.base} → ${labels.head}`;

  const chips = (['changed', 'added', 'removed', 'unchanged'] as const)
    .map((s) => `<span class="badge ${badgeClass(s)}">${summary.byStatus[s]} ${s}</span>`)
    .join('');
  const toc = ordered
    .map((d) => `<li><span class="badge ${badgeClass(d.status)}">${statusLabel(d)}</span><a href="#${slug(d.test)}">${html(d.test)}</a> <span class="counts">${html(countsText(d))}</span></li>`)
    .join('\n');

  return page(
    title,
    `<main>
<header>
  <h1>Plotline: behaviour diff</h1>
  <p><code>${html(labels.base)}</code> → <code>${html(labels.head)}</code> · ${summary.total} tests ${chips}</p>
</header>
<div class="legend">
  <span><i style="background:var(--added-bg)"></i>${DIFF_MARKS.added} added</span>
  <span><i style="background:var(--removed-bg)"></i>${DIFF_MARKS.removed} removed</span>
  <span><i style="background:var(--changed-bg)"></i>${DIFF_MARKS.changed} changed</span>
  <span><i style="background:var(--moved-bg)"></i>${DIFF_MARKS.moved} moved</span>
  <span>Unchanged stretches are collapsed; open “Before and after” for the full runs.</span>
</div>
${unstableWarning(unstable)}
${whatChanged(ordered.filter((d) => !unstable.some((u) => u.key === d.key)))}
<nav><h2>Tests</h2><ul class="tests">${toc}</ul></nav>
${ordered.map(section).join('\n')}
</main>`,
  );
}

function section(d: TestDiff): string {
  const meta = [`<code>${html(d.spec)}</code>`, html(countsText(d))];
  if (d.renamedFrom) meta.push(`was “${html(d.renamedFrom)}”`);
  if (d.participants.added.length) meta.push(`new participant: <b>${html(d.participants.added.join(', '))}</b>`);
  if (d.participants.removed.length) meta.push(`no longer calls: <b>${html(d.participants.removed.join(', '))}</b>`);

  const head = `<div class="head"><h2><span class="badge ${badgeClass(d.status)}">${statusLabel(d)}</span>${html(d.test)}</h2><div class="meta">${meta.join(' · ')}</div></div>`;

  if (d.status === 'unchanged') {
    return `<section class="test" id="${slug(d.test)}">${head}
  <details><summary>Diagram</summary><div class="diagram">${svgOf(toSequenceDiagram(d.head!))}</div></details>
</section>`;
  }
  if (d.status !== 'changed') {
    const trace = (d.head ?? d.base)!;
    return `<section class="test" id="${slug(d.test)}">${head}<div class="diagram">${svgOf(toSequenceDiagram(trace))}</div></section>`;
  }

  const lines = describeTest(d)
    .map((c) => `<li class="${c.op}"><span class="mark">${DIFF_MARKS[c.op]}</span>${inline(c.text)}</li>`)
    .join('\n');
  return `<section class="test" id="${slug(d.test)}">${head}
  <ul class="changes">${lines}</ul>
  <div class="diagram">${svgOf(toDiffDiagram(d))}</div>
  <details><summary>Before and after</summary>
    <div class="sides">
      <div><h3>Before</h3><div class="diagram">${svgOf(toSequenceDiagram(d.base!))}</div></div>
      <div><h3>After</h3><div class="diagram">${svgOf(toSequenceDiagram(d.head!))}</div></div>
    </div>
  </details>
</section>`;
}

function unstableWarning(unstable: Unstable[]): string {
  if (!unstable.length) return '';
  const items = unstable.map((u) => `<li><a href="#${slug(u.test)}">${html(u.test)}</a>: ${inline(u.example)}</li>`).join('');
  return `<section class="summary unstable"><h2>Recorded differently on two runs</h2>
  <p>These tests changed between two runs of the same code, so their diffs may show changes this PR didn't make. The usual causes are random ids, real timestamps or async work the test doesn't wait for.</p>
  <ul class="changes">${items}</ul></section>`;
}

function whatChanged(diffs: TestDiff[]): string {
  const groups = groupChanges(diffs);
  if (!groups.length) return '';
  const items = groups
    .map(({ change, tests }) => {
      const links = tests.map((t) => `<li><a href="#${slug(t.test)}">${html(t.test)}</a></li>`).join('');
      return `<li class="${change.op}"><span class="mark">${DIFF_MARKS[change.op]}</span>${inline(change.text)}
        <details class="where"><summary>${tests.length === 1 ? '1 test' : `${tests.length} tests`}</summary><ul>${links}</ul></details></li>`;
    })
    .join('\n');
  return `<section class="summary"><h2>What changed</h2><ul class="changes">${items}</ul></section>`;
}

/** The Markdown subset change sentences use: **bold** and `code`. */
function inline(text: string): string {
  return html(text)
    .replace(/`([^`]*)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
}

function badgeClass(status: string): string {
  return status === 'unchanged' ? 'same' : status;
}
