import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { diffRuns } from './diff/align';
import { diffPage } from './diff/html';
import { diffComment } from './diff/markdown';
import { findUnstable } from './diff/stability';
import { loadTraces } from './report/load';
import { reportPage } from './report/report';

const USAGE = `Usage:
  plotline report <trace-dir> [--out <dir>]   Render every trace to <dir>/index.html
  plotline diff <base-dir> <head-dir> [--out <dir>] [--base-label <text>] [--head-label <text>] [--report-url <url>]
                                                  [--again <head-dir-2>]
                                                  Compare two runs; writes <dir>/comment.md and <dir>/index.html.
                                                  --again: a second run of the head, to flag tests that record differently
  plotline stable <run-dir> <run-dir>             Exit 1 if any test recorded differently on two runs of the same code`;

function main(argv: string[]): number {
  const [command, ...rest] = argv;
  const positional = rest.filter((a, i) => !a.startsWith('--') && !rest[i - 1]?.startsWith('--'));
  const flag = (name: string) => {
    const i = rest.indexOf(`--${name}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };

  if (command === 'report' && positional.length === 1) {
    const out = resolve(flag('out') ?? join(positional[0], 'report'));
    mkdirSync(out, { recursive: true });
    const traces = loadTraces(resolve(positional[0]));
    writeFileSync(join(out, 'index.html'), reportPage(traces));
    console.log(`Rendered ${traces.length} traces to ${join(out, 'index.html')}`);
    return 0;
  }

  if (command === 'diff' && positional.length === 2) {
    const [baseDir, headDir] = positional;
    const out = resolve(flag('out') ?? 'trace-diff');
    const labels = {
      base: flag('base-label') ?? baseDir,
      head: flag('head-label') ?? headDir,
      reportUrl: flag('report-url'),
    };
    const head = loadTraces(resolve(headDir));
    const diffs = diffRuns(loadTraces(resolve(baseDir)), head);
    const again = flag('again');
    const unstable = again ? findUnstable(head, loadTraces(resolve(again))) : [];
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'comment.md'), diffComment(diffs, labels, unstable));
    writeFileSync(join(out, 'index.html'), diffPage(diffs, labels, unstable));
    const changed = diffs.filter((d) => d.status !== 'unchanged').length;
    console.log(
      `${changed} of ${diffs.length} tests changed. Wrote ${join(out, 'comment.md')} and ${join(out, 'index.html')}`,
    );
    if (unstable.length) console.log(`${unstable.length} tests recorded differently on two runs of the same code.`);
    return 0;
  }

  if (command === 'stable' && positional.length === 2) {
    const unstable = findUnstable(loadTraces(resolve(positional[0])), loadTraces(resolve(positional[1])));
    for (const u of unstable) console.log(`✗ ${u.key}\n    ${u.example.replace(/\*\*/g, '')}`);
    console.log(
      unstable.length
        ? `${unstable.length} tests recorded differently on two runs.`
        : 'Every test recorded the same on both runs.',
    );
    return unstable.length ? 1 : 0;
  }

  console.error(USAGE);
  return 1;
}

process.exitCode = main(process.argv.slice(2));
