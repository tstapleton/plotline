import { InjectionToken, inject } from '@angular/core';
import type { EmptyFeatureResult, SignalStoreFeature, SignalStoreFeatureResult } from '@ngrx/signals';

/**
 * Receives a store's internals while it is being built. Only provided by the test
 * harness (see src/testing/trace), so in the app `withTracing` is a no-op.
 */
export interface TraceSink {
  instrumentStore<T extends object>(name: string, innerStore: T): T;
}

// Keyed globally so the ESM build (used by the app) and the CommonJS build (used by
// Jest) share one token even when both end up loaded.
const TOKEN_KEY = Symbol.for('@tsociety/plotline/TRACE_SINK');
const registry = globalThis as unknown as Record<symbol, InjectionToken<TraceSink> | undefined>;

registry[TOKEN_KEY] ??= new InjectionToken<TraceSink>('TRACE_SINK');
export const TRACE_SINK: InjectionToken<TraceSink> = registry[TOKEN_KEY];

/**
 * Marks a SignalStore as a participant in generated sequence diagrams.
 *
 * Place it after the features whose methods should be traced and before `withHooks`,
 * so that hooks call the traced methods.
 */
export function withTracing<Input extends SignalStoreFeatureResult>(
  name: string,
): SignalStoreFeature<Input, EmptyFeatureResult> {
  return (store) => {
    const sink = inject(TRACE_SINK, { optional: true });
    return sink ? sink.instrumentStore(name, store) : store;
  };
}
