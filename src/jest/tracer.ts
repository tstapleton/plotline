import { isSignal } from '@angular/core';
import { SIGNAL } from '@angular/core/primitives/signals';
import { getState, StateSource, watchState } from '@ngrx/signals';
import { AsyncLocalStorage } from 'node:async_hooks';
import { isObservable, Observable } from 'rxjs';
import { TraceSink } from '../store/with-tracing';
import { Participant, TraceEvent } from '../core/model';
import { diffState, summarize, summarizeArgs } from './summarize';

export interface ParticipantOptions {
  /** Draw it inside a box with this title, e.g. "Host app (mocked)". */
  group?: string;
  /** Only trace these methods. Defaults to every function member. */
  methods?: string[];
}

/**
 * Records calls between participants while a test runs.
 *
 * The "current participant" lives in AsyncLocalStorage, so code that continues after
 * an `await`, a timer or an observable emission is still attributed to whoever started it.
 * Anything running outside a participant (DOM event handlers, change detection) is the UI.
 */
export class Tracer implements TraceSink {
  uiName = 'UI';
  /** Box for the UI and stores; set with `provideTracing({ group })`. */
  featureGroup: string | undefined;
  events: TraceEvent[] = [];
  private readonly groups = new Map<string, string | undefined>();
  private recording = false;
  private readonly context = new AsyncLocalStorage<string>();

  start(): void {
    this.events = [];
    this.uiName = 'UI';
    this.featureGroup = undefined;
    this.groups.clear();
    this.recording = true;
  }

  stop(): TraceEvent[] {
    this.recording = false;
    return this.events;
  }

  get participants(): Participant[] {
    const groups = new Map([[this.uiName, this.featureGroup], ...this.groups]);
    return [...groups].map(([name, group]) => (group ? { name, group } : { name }));
  }

  get caller(): string {
    return this.context.getStore() ?? this.uiName;
  }

  runAs<T>(participant: string, fn: () => T): T {
    return participant === this.uiName ? this.context.exit(fn) : this.context.run(participant, fn);
  }

  record(event: TraceEvent): void {
    if (this.recording) this.events.push(event);
  }

  /** Wraps a service instance or mock so calls to its methods are recorded. */
  instrumentObject<T extends object>(name: string, target: T, options: ParticipantOptions = {}): T {
    this.groups.set(name, options.group);
    const cache = new Map<PropertyKey, unknown>();
    return new Proxy(target, {
      get: (obj, key, receiver) => {
        const value = Reflect.get(obj, key, receiver);
        if (typeof value !== 'function' || typeof key !== 'string') return value;
        if (options.methods && !options.methods.includes(key)) return value;
        if (!cache.has(key)) cache.set(key, this.wrapFunction(name, key, value as (...args: unknown[]) => unknown, obj));
        return cache.get(key);
      },
    });
  }

  /** Called by `withTracing()` while a SignalStore is being constructed. */
  instrumentStore<T extends object>(name: string, innerStore: T): T {
    this.groups.set(name, this.featureGroup);
    const inner = innerStore as T & {
      methods: Record<string, (...args: unknown[]) => unknown>;
      props: Record<string, unknown>;
    };
    type ComputedNode = { computation?: (previous: unknown) => unknown };

    const methods: Record<string, unknown> = {};
    for (const [key, fn] of Object.entries(inner.methods)) {
      methods[key] = this.wrapFunction(name, key, fn, undefined);
    }

    // Computeds are re-evaluated lazily by whoever reads them, usually change detection.
    // Run their computation as the store so the calls they make are attributed to it.
    // This patches Angular's signal node, so only computeds exposed on the store are covered.
    for (const value of Object.values(inner.props)) {
      const node = isSignal(value) ? ((value as unknown as Record<symbol, ComputedNode>)[SIGNAL]) : undefined;
      const computation = node?.computation;
      if (node && computation) node.computation = (previous) => this.runAs(name, () => computation(previous));
    }

    const stateSource = inner as unknown as StateSource<Record<string, unknown>>;
    let previous = getState(stateSource);
    watchState(stateSource, (state) => {
      const changes = diffState(previous, state);
      previous = state;
      if (changes.length) this.record({ kind: 'note', over: name, changes });
    });

    return { ...inner, methods };
  }

  private wrapFunction(
    name: string,
    method: string,
    fn: (...args: unknown[]) => unknown,
    thisArg: unknown,
  ): (...args: unknown[]) => unknown {
    const tracer = this;
    const wrapped = function (...args: unknown[]) {
      const from = tracer.caller;
      // Calls inside a participant stay off the diagram; it shows boundaries only.
      if (from === name) return fn.apply(thisArg, args);

      tracer.record({ kind: 'call', from, to: name, label: `${method}(${summarizeArgs(args)})` });
      let result: unknown;
      try {
        result = tracer.runAs(name, () => fn.apply(thisArg, args));
      } catch (error) {
        tracer.record({ kind: 'throw', from: name, to: from, label: summarize(error) });
        throw error;
      }
      return tracer.traceResult(name, from, result);
    };
    // Keep extra members such as an rxMethod's `destroy`.
    return Object.assign(wrapped, fn);
  }

  private traceResult(name: string, from: string, result: unknown): unknown {
    if (isObservable(result)) {
      // Emissions are the "response"; subscribers run as the caller again.
      return new Observable((subscriber) =>
        this.runAs(name, () =>
          result.subscribe({
            next: (value) => {
              this.record({ kind: 'return', from: name, to: from, label: summarize(value) });
              this.runAs(from, () => subscriber.next(value));
            },
            error: (error) => {
              this.record({ kind: 'throw', from: name, to: from, label: summarize(error) });
              this.runAs(from, () => subscriber.error(error));
            },
            complete: () => this.runAs(from, () => subscriber.complete()),
          }),
        ),
      );
    }
    if (result instanceof Promise) {
      return result.then(
        (value) => {
          this.record({ kind: 'return', from: name, to: from, label: summarize(value) });
          return value;
        },
        (error) => {
          this.record({ kind: 'throw', from: name, to: from, label: summarize(error) });
          throw error;
        },
      );
    }
    if (result !== undefined && !isRxMethodRef(result)) {
      this.record({ kind: 'return', from: name, to: from, label: summarize(result) });
    }
    return result;
  }
}

function isRxMethodRef(value: unknown): boolean {
  return typeof value === 'object' && value !== null && Object.keys(value).join() === 'destroy';
}

export const tracer = new Tracer();

/** Set PLOTLINE=1 to record. */
export const tracingEnabled = !!process.env['PLOTLINE'];
