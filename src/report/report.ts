import { toSequenceDiagram } from '../core/mermaid';
import { TraceFile } from '../core/model';
import { html, page, slug, svgOf } from './page';

/** One page with every test's sequence diagram, rendered by Pele. */
export function reportPage(traces: TraceFile[], title = 'Plotline'): string {
  const toc = traces.map((t) => `<li><a href="#${slug(t.test)}">${html(t.test)}</a></li>`).join('\n');
  const sections = traces.map((t) => {
    const mermaid = toSequenceDiagram(t);
    return `<section class="test" id="${slug(t.test)}">
  <div class="head"><h2>${html(t.test)}</h2><div class="meta"><code>${html(t.spec)}</code></div></div>
  <div class="diagram">${svgOf(mermaid)}</div>
  <details><summary>Mermaid source</summary><pre><code>${html(mermaid)}</code></pre></details>
</section>`;
  });
  return page(
    title,
    `<main>
<header><h1>${html(title)}</h1><p>${traces.length} tests, one sequence diagram each, recorded from integration test runs.</p></header>
<nav><h2>Tests</h2><ol>${toc}</ol></nav>
${sections.join('\n')}
</main>`,
  );
}
