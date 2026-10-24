import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { diffEvents, diffRuns } from '../src/diff/align';
import { TraceEvent, TraceFile } from '../src/core/model';

const call = (from: string, to: string, label: string): TraceEvent => ({ kind: 'call', from, to, label });
const note = (over: string, path: string, before: string, after: string): TraceEvent => ({ kind: 'note', over, changes: [{ path, before, after }] });
const trace = (test: string, events: TraceEvent[]): TraceFile => ({ version: 1, spec: 'a.spec.ts', test, ui: 'UI', participants: [], events });

describe('diffEvents', () => {
  it('marks identical runs as unchanged', () => {
    const events = [call('UI', 'Store', 'load("x")'), note('Store', 'status', '"idle"', '"ready"')];
    assert.deepEqual(diffEvents(events, events).map((o) => o.op), ['same', 'same']);
  });

  it('reports a call with different arguments as changed, not removed and added', () => {
    const ops = diffEvents([call('Store', 'API', 'getOptions("GB")')], [call('Store', 'API', 'getOptions({country: "GB"})')]);
    assert.equal(ops.length, 1);
    assert.equal(ops[0].op, 'changed');
  });

  it('finds inserted and removed messages around unchanged ones', () => {
    const base = [call('UI', 'Store', 'submit()'), call('Store', 'Rules', 'validate()'), call('Store', 'API', 'submit()')];
    const head = [call('UI', 'Store', 'submit()'), call('Store', 'API', 'verifyVat("GB1")'), call('Store', 'API', 'submit()'), call('Store', 'Analytics', 'track("submitted")')];
    assert.deepEqual(diffEvents(base, head).map((o) => o.op), ['same', 'added', 'removed', 'same', 'added']);
  });

  it('reports a message that happens earlier within the same gesture as moved', () => {
    const base = [call('UI', 'Store', 'setValue("a")'), call('Store', 'Rules', 'validate()'), call('UI', 'Store', 'markTouched("a")')];
    const head = [call('UI', 'Store', 'setValue("a")'), call('UI', 'Store', 'markTouched("a")'), call('Store', 'Rules', 'validate()')];
    assert.deepEqual(diffEvents(base, head).map((o) => o.op), ['same', 'moved', 'same']);
  });

  it('prefers exact matches over same-shaped ones', () => {
    const base = [call('UI', 'Store', 'setValue("a")'), call('UI', 'Store', 'setValue("b")')];
    const head = [call('UI', 'Store', 'setValue("b")')];
    assert.deepEqual(diffEvents(base, head).map((o) => o.op), ['removed', 'same']);
  });
});

describe('diffRuns', () => {
  it('pairs tests by name and reports added, removed and changed tests', () => {
    const base = [trace('kept', [call('UI', 'Store', 'a()')]), trace('dropped', [call('UI', 'Store', 'a()')])];
    const head = [trace('kept', [call('UI', 'Store', 'a()'), call('Store', 'Analytics', 'track()')]), trace('new', [call('UI', 'Store', 'b()')])];
    const byTest = Object.fromEntries(diffRuns(base, head).map((d) => [d.test, d]));
    assert.equal(byTest['kept'].status, 'changed');
    assert.deepEqual(byTest['kept'].participants.added, ['Analytics']);
    assert.equal(byTest['new'].status, 'added');
    assert.equal(byTest['dropped'].status, 'removed');
  });

  it('reports a test whose name changed but steps mostly did not as renamed', () => {
    const steps = [call('UI', 'Store', 'submit()'), call('Store', 'Rules', 'validate()'), call('Store', 'Notifier', 'error("4 fields")')];
    const renamed = [...steps.slice(0, 2), call('Store', 'Notifier', 'error("4 fields need attention")')];
    const [d] = diffRuns([trace('blocks submission', steps)], [trace('lists what is missing', renamed)]);
    assert.equal(d.status, 'changed');
    assert.equal(d.renamedFrom, 'blocks submission');
    assert.deepEqual(d.counts, { added: 0, removed: 0, changed: 1, moved: 0 });
  });
});
