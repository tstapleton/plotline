import { ClassProvider, FactoryProvider, Provider, Type, ValueProvider, inject } from '@angular/core';
import { TRACE_SINK } from '../store/with-tracing';
import { ParticipantOptions, tracer, tracingEnabled } from './tracer';

/**
 * Registers the trace sink so stores marked with `withTracing()` report to it.
 * Returns no providers unless the run was started with PLOTLINE=1.
 */
export function provideTracing(options: { ui?: string; group?: string } = {}): Provider[] {
  if (!tracingEnabled) return [];
  if (options.ui) tracer.uiName = options.ui;
  tracer.featureGroup = options.group;
  return [{ provide: TRACE_SINK, useValue: tracer }];
}

type TraceableProvider<T> = Type<T> | ValueProvider | ClassProvider | FactoryProvider;

/**
 * Marks a provider as a diagram participant, e.g. a mocked service from outside the feature:
 *
 *   traced('Form API (mock)', { provide: FormApiClient, useValue: apiMock })
 *   traced('Rules engine', RulesEngine, { methods: ['validate'] })
 */
export function traced<T extends object>(
  name: string,
  provider: TraceableProvider<T>,
  options: ParticipantOptions = {},
): Provider {
  if (!tracingEnabled) return provider;
  const wrap = (instance: T) => tracer.instrumentObject(name, instance, options);

  if (typeof provider === 'function') {
    return { provide: provider, useFactory: () => wrap(new provider()) };
  }
  if ('useValue' in provider) {
    return { provide: provider.provide, useValue: wrap(provider.useValue) };
  }
  if ('useClass' in provider) {
    const cls = provider.useClass as Type<T>;
    return { provide: provider.provide, useFactory: () => wrap(new cls()) };
  }
  const { provide, useFactory, deps = [] } = provider;
  return { provide, useFactory: () => wrap(useFactory(...deps.map((d) => inject(d)))) };
}
