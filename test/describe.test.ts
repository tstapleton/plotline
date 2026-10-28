import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TraceEvent, TraceFile } from '../src/core/model';
import { diffRuns } from '../src/diff/align';
import { describeTest, groupChanges } from '../src/diff/describe';

const call = (from: string, to: string, label: string): TraceEvent => ({ kind: 'call', from, to, label });
const back = (from: string, to: string, label: string): TraceEvent => ({ kind: 'return', from, to, label });
const trace = (test: string, events: TraceEvent[]): TraceFile => ({
  version: 1,
  spec: 'a.spec.ts',
  test,
  ui: 'UI',
  participants: [],
  events,
});

describe('describeTest', () => {
  it('says what changed in words, leaving out responses to new calls', () => {
    const [d] = diffRuns(
      [trace('t', [call('Page', 'Store', 'save()'), call('Store', 'Toaster', 'success("Made it")')])],
      [
        trace('t', [
          call('Page', 'Store', 'save()'),
          call('Store', 'API', 'lists()'),
          back('API', 'Store', '[2]'),
          call('Store', 'Toaster', 'success("Added it")'),
        ]),
      ],
    );
    assert.deepEqual(
      describeTest(d).map((c) => c.text),
      [
        '**Store** now calls **API** `lists()`',
        '**Store** calls **Toaster** `success("Added it")` instead of `success("Made it")`',
      ],
    );
  });

  it('counts repeats and drops the data when the repeats differ', () => {
    const [d] = diffRuns(
      [trace('t', [call('Page', 'Store', 'load()')])],
      [
        trace('t', [
          call('Page', 'Store', 'load()'),
          call('Store', 'Analytics', 'track("viewed")'),
          call('Store', 'Analytics', 'track("saved")'),
        ]),
      ],
    );
    assert.deepEqual(
      describeTest(d).map((c) => c.text),
      ['**Store** now calls **Analytics** `track(…)` (2 times)'],
    );
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
    assert.equal(group.change.text, '**Store** now calls **Analytics** `track(…)`');
    assert.deepEqual(
      group.tests.map((t) => t.test),
      ['a', 'b'],
    );
  });
});

describe('findUnstable', () => {
  it('flags tests that recorded differently on two runs of the same code', async () => {
    const { findUnstable } = await import('../src/diff/stability');
    const run = (id: string) => [
      trace('creates', [call('Page', 'API', 'create()'), back('API', 'Page', `{id: "${id}", …}`)]),
      trace('lists', [call('Page', 'API', 'list()')]),
    ];
    const unstable = findUnstable(run('g-1a'), run('g-9z'));
    assert.deepEqual(
      unstable.map((u) => u.test),
      ['creates'],
    );
    assert.match(unstable[0].example, /g-1a/);
  });
});

describe('observables', () => {
  it('recognises RxJS values without importing RxJS, including subjects', async () => {
    const { isObservable } = await import('../src/jest/observable');
    const { BehaviorSubject, of } = await import('rxjs');
    assert.equal(isObservable(of(1)), true);
    assert.equal(isObservable(new BehaviorSubject(1)), true);
    assert.equal(isObservable(Promise.resolve(1)), false);
  });
});

describe('toSequenceDiagram', () => {
  it('declares a component that only receives user actions', async () => {
    const { toSequenceDiagram } = await import('../src/core/mermaid');
    const diagram = toSequenceDiagram(
      trace('t', [
        { kind: 'user', to: 'Stepper', text: 'clicks "More"', key: 'click:More' },
        call('Page', 'Store', 'setServings(4)'),
      ]),
    );
    assert.match(diagram, /participant P\d as Stepper/);
    assert.doesNotMatch(diagram, /P-1/);
  });
});
