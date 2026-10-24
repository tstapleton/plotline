import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { TraceFile } from '../core/model';

/** Reads every `*.json` trace under a directory written by `npm run test:trace`. */
export function loadTraces(dir: string): TraceFile[] {
  const traces: TraceFile[] = [];
  const walk = (path: string) => {
    for (const entry of readdirSync(path)) {
      const full = join(path, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.json')) traces.push(JSON.parse(readFileSync(full, 'utf8')) as TraceFile);
    }
  };
  walk(dir);
  return traces.sort((a, b) => a.spec.localeCompare(b.spec) || a.test.localeCompare(b.test));
}
