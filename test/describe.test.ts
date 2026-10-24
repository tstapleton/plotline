import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TraceEvent, TraceFile } from '../src/core/model';
import { diffRuns } from '../src/diff/align';
import { describeTest, groupChanges } from '../src/diff/describe';

const call = (from: string, to: string, label: string): TraceEvent => ({ kind: 'call', from, to, label });
const back = (from: string, to: string, label: string): TraceEvent => ({ kind: 'return', from, to, label });
const trace = (test: string, events: TraceEvent[]): TraceFile => ({ version: 1, spec: 'a.spec.ts', test, ui: 'UI', participants: [], events });

describe('describeTest', () => {
  it('says what changed in words, leaving out responses to new calls', () => {
    const [d] = diffRuns(
      [trace('t', [call('Page', 'Store', 'save()'), call('Store', 'Toaster', 'success("Made it")')])],
      [trace('t', [call('Page', 'Store', 'save()'), call('Store', 'API', 'lists()'), back('API', 'Store', '[2]'), call('Store', 'Toaster', 'success("Added it")')])],
    );
    assert.deepEqual(describeTest(d!).map((c) => c.text), [
      '**Store** now calls **API** `lists()`',
      '**Store** calls **Toaster** `success("Added it")` instead of `success("Made it")`',
    ]);
  });

  it('counts repeats and drops the data when the repeats differ', () => {
    const [d] = diffRuns(
      [trace('t', [call('Page', 'Store', 'load()')])],
      [trace('t', [call('Page', 'Store', 'load()'), call('Store', 'Analytics', 'track("viewed")'), call('Store', 'Analytics', 'track("saved")')])],
    );
    assert.deepEqual(describeTest(d!).map((c) => c.text), ['**Store** now calls **Analytics** `track(…)` (2 times)']);
  });
});

describe('groupChanges', () => {
  it('lists a change made in several tests once, with the tests', () => {
    const base = [trace('a', [call('Page', 'Store', 'load()')]), trace('b', [call('Page', 'Store', 'save()')])];
    const head = [
      trace('a', [call('Page', 'Store', 'load()'), call('Store', 'Analytics', 'track("a")')]),
      trace('b', [call('Page', 'Store', 'save()'), call('Store', 'Analytics', 'track("b")')]),
    ];
    const [group] = groupChanges(diffRuns(base, head));
    assert.equal(group!.change.text, '**Store** now calls **Analytics** `track(…)`');
    assert.deepEqual(group!.tests.map((t) => t.test), ['a', 'b']);
  });
});
