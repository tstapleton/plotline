import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Injector, runInInjectionContext } from '@angular/core';
import { patchState, signalState } from '@ngrx/signals';
import { Tracer } from '../src/jest/tracer';

it('preserves the receiver when a traced store method calls a sibling method', () => {
  const tracer = new Tracer();
  tracer.start();
  const state = signalState({ canSave: true, saved: false });
  const innerStore = Object.assign(state, {
    props: {},
    methods: {
      canSaveRelatedEntity: () => state.canSave(),
      submitRelatedEntityEdit() {
        if (this.canSaveRelatedEntity()) patchState(state, { saved: true });
      },
    },
  });
  const injector = Injector.create({ providers: [] });

  try {
    const store = runInInjectionContext(injector, () => tracer.instrumentStore('Workspace', innerStore));
    store.methods.submitRelatedEntityEdit();
    assert.equal(state.saved(), true);
  } finally {
    injector.destroy();
    tracer.stop();
  }
});
