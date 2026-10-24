import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { diffRuns } from './diff/align';
import { diffPage } from './diff/html';
import { diffComment } from './diff/markdown';
import { loadTraces } from './report/load';
import { reportPage } from './report/report';

const USAGE = `Usage:
  plotline report <trace-dir> [--out <dir>]   Render every trace to <dir>/index.html
  plotline diff <base-dir> <head-dir> [--out <dir>] [--base-label <text>] [--head-label <text>] [--report-url <url>]
                                                  Compare two runs; writes <dir>/comment.md and <dir>/index.html`;

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
    const labels = { base: flag('base-label') ?? baseDir, head: flag('head-label') ?? headDir, reportUrl: flag('report-url') };
    const diffs = diffRuns(loadTraces(resolve(baseDir)), loadTraces(resolve(headDir)));
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'comment.md'), diffComment(diffs, labels));
    writeFileSync(join(out, 'index.html'), diffPage(diffs, labels));
    const changed = diffs.filter((d) => d.status !== 'unchanged').length;
    console.log(`${changed} of ${diffs.length} tests changed. Wrote ${join(out, 'comment.md')} and ${join(out, 'index.html')}`);
    return 0;
  }

  console.error(USAGE);
  return 1;
}

process.exitCode = main(process.argv.slice(2));
