import { type TraceFile, traceKey } from '../core/model';
import { diffRuns } from './align';
import { describeTest } from './describe';

export interface Unstable {
  /** `spec › test`, as used to pair tests. */
  key: string;
  test: string;
  /** One thing that differed between the two runs, as a hint to the cause. */
  example: string;
}

/**
 * Tests that recorded differently on two runs of the same code. Their diffs against
 * the base aren't trustworthy; the usual causes are random ids, real timestamps or
 * async work that isn't awaited in the test.
 */
export function findUnstable(first: TraceFile[], second: TraceFile[]): Unstable[] {
  const firstKeys = new Set(first.map(traceKey));
  return diffRuns(first, second, 1.1)
    .filter((d) => d.status !== 'unchanged' && firstKeys.has(d.key))
    .map((d) => ({ key: d.key, test: d.test, example: describeTest(d)[0]?.text ?? 'only recorded on one run' }));
}
