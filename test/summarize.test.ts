import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeChange } from '../src/core/model';
import { diffState, summarize } from '../src/jest/summarize';

const lines = (prev: object, next: object) => diffState(prev as never, next as never).map(describeChange);

describe('diffState', () => {
  it('diffs lists of entities item by item', () => {
    const a = { id: 'a', title: 'A', favorite: false };
    const b = { id: 'b', title: 'B', favorite: false };
    assert.deepEqual(lines({ recipes: [a, b] }, { recipes: [{ ...a, favorite: true }, b] }), [
      'recipes[a].favorite: false → true',
    ]);
    assert.deepEqual(lines({ recipes: [a, b] }, { recipes: [a] }), ['recipes[b]: removed']);
    assert.deepEqual(lines({ recipes: [a] }, { recipes: [a, b] }), ['recipes[b]: {id: "b", …}']);
  });

  it('describes a first load as one change', () => {
    assert.deepEqual(lines({ recipes: [] }, { recipes: [{ id: 'a' }, { id: 'b' }] }), ['recipes: [{…1}, {…1}]']);
  });
});

describe('summarize', () => {
  it('shows HTTP errors by status', () => {
    assert.equal(summarize({ status: 503, statusText: 'Service Unavailable', headers: {} }), 'HTTP 503');
  });
});

describe('escapeText', () => {
  it('keeps typed newlines from breaking a Mermaid message', async () => {
    const { escapeText } = await import('../src/core/mermaid');
    assert.equal(escapeText('2 eggs\n300 ml milk; #1'), '2 eggs ⏎ 300 ml milk#59; #35;1');
  });
});
