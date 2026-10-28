import { AsyncLocalStorage } from 'node:async_hooks';
import { isSignal } from '@angular/core';
import { SIGNAL } from '@angular/core/primitives/signals';
import { getState, type StateSource, watchState } from '@ngrx/signals';
import type { Participant, TraceEvent } from '../core/model';
import type { TraceSink } from '../store/with-tracing';
import { classesOnStack, outputSource, renderedComponents } from './components';
import { baseObservable, isObservable } from './observable';
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
  /** Participants that are stores, whose async actions report back with their state. */
  private readonly stores = new Set<string>();
  /** Components seen rendered during the current test. */
  private readonly components = new Set<string>();
  /** Placeholder participants awaiting a component, with the classes on their stack. */
  private readonly pending = new Map<string, string[]>();
  private recording = false;
  private readonly context = new AsyncLocalStorage<string>();

  start(): void {
    this.events = [];
    this.uiName = 'UI';
    this.featureGroup = undefined;
    this.groups.clear();
    this.stores.clear();
    this.components.clear();
    this.pending.clear();
    this.recording = true;
  }

  stop(): TraceEvent[] {
    this.recording = false;
    for (const name of renderedComponents()) this.components.add(name);
    const resolved = new Map<string, string>();
    for (const [placeholder, classes] of this.pending) {
      const component = classes.find((c) => this.components.has(c));
      if (component) this.addComponent(component);
      resolved.set(placeholder, component ?? this.uiName);
    }
    const name = (n: string) => resolved.get(n) ?? n;
    this.events = this.events.map((e) => {
      if (e.kind === 'note') return { ...e, over: name(e.over) };
      if (e.kind === 'user') return { ...e, to: name(e.to) };
      return { ...e, from: name(e.from), to: name(e.to) };
    });
    return this.events;
  }

  get participants(): Participant[] {
    const groups = new Map([[this.uiName, this.featureGroup], ...this.groups]);
    return [...groups].map(([name, group]) => (group ? { name, group } : { name }));
  }

  get caller(): string {
    return zoneParticipant() ?? this.context.getStore() ?? this.uiName;
  }

  /**
   * The current participant or, when that's the UI, the component on the call stack. A
   * component still being constructed (say, creating its store) isn't on the page yet,
   * so the call gets a placeholder that `stop()` resolves once the test has rendered it.
   */
  callerOrComponent(): string {
    const caller = this.caller;
    if (caller !== this.uiName) return caller;
    const classes = classesOnStack();
    if (!classes.length) return caller;
    for (const name of renderedComponents()) this.components.add(name);
    const known = classes.find((c) => this.components.has(c));
    if (known) {
      this.addComponent(known);
      return known;
    }
    const placeholder = `\u0000component-${this.pending.size}`;
    this.pending.set(placeholder, classes);
    return placeholder;
  }

  /** Notes which components are on the page now, to resolve placeholders later. */
  observeComponents(): void {
    if (this.recording && this.pending.size) for (const name of renderedComponents()) this.components.add(name);
  }

  /** A component output, drawn from the emitting child to the parent listening. */
  recordOutput(emitter: object, value: unknown): void {
    if (!this.recording) return;
    const source = outputSource(emitter);
    if (!source || source.child === source.parent) return;
    this.addComponent(source.child);
    this.addComponent(source.parent);
    this.record({
      kind: 'call',
      from: source.child,
      to: source.parent,
      label: `${source.output}(${value === undefined ? '' : summarize(value)})`,
    });
  }

  /** Registers a component as a participant, in the same box as the UI. */
  addComponent(name: string): void {
    if (!this.groups.has(name)) this.groups.set(name, this.featureGroup);
  }

  /**
   * Runs `fn` as `participant`, so whatever it starts is attributed to it. Node's
   * AsyncLocalStorage follows native promises, timers and await; with zone.js loaded,
   * the participant is also kept in a Zone, which zone.js carries through its own
   * promises (whose callbacks it batches, losing Node's context).
   */
  runAs<T>(participant: string, fn: () => T): T {
    const run = () => (participant === this.uiName ? this.context.exit(fn) : this.context.run(participant, fn));
    const zone = currentZone();
    return zone ? zone.fork({ name: 'plotline', properties: { [ZONE_KEY]: participant } }).run(run) : run();
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
        if (!cache.has(key))
          cache.set(key, this.wrapFunction(name, key, value as (...args: unknown[]) => unknown, obj));
        return cache.get(key);
      },
    });
  }

  /** Called by `withTracing()` while a SignalStore is being constructed. */
  instrumentStore<T extends object>(name: string, innerStore: T): T {
    this.groups.set(name, this.featureGroup);
    this.stores.add(name);
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
      const node = isSignal(value) ? (value as unknown as Record<symbol, ComputedNode>)[SIGNAL] : undefined;
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
    const wrapped = function (this: unknown, ...args: unknown[]) {
      const receiver = thisArg === undefined ? this : thisArg;
      const from = tracer.callerOrComponent();
      // Calls inside a participant stay off the diagram; it shows boundaries only.
      if (from === name) return fn.apply(receiver, args);

      tracer.record({ kind: 'call', from, to: name, label: `${method}(${summarizeArgs(args)})` });
      let result: unknown;
      try {
        result = tracer.runAs(name, () => fn.apply(receiver, args));
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
      return new (baseObservable(result))((subscriber) =>
        this.runAs(name, () =>
          result.subscribe({
            next: (value: unknown) => {
              this.record({ kind: 'return', from: name, to: from, label: summarize(value) });
              this.runAs(from, () => subscriber.next(value));
            },
            error: (error: unknown) => {
              this.record({ kind: 'throw', from: name, to: from, label: summarize(error) });
              this.runAs(from, () => subscriber.error(error));
            },
            complete: () => this.runAs(from, () => subscriber.complete()),
          }),
        ),
      );
    }
    // Any thenable: with zone.js, `Promise` is ZoneAwarePromise while async functions
    // may still return native promises.
    if (isThenable(result)) {
      return result.then(
        (value) => {
          // A store action that resolves with nothing has said everything in its state
          // notes; a service call that does is reported as done.
          if (value !== undefined) this.record({ kind: 'return', from: name, to: from, label: summarize(value) });
          else if (!this.stores.has(name)) this.record({ kind: 'return', from: name, to: from, label: 'done' });
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

const ZONE_KEY = 'plotlineParticipant';

interface ZoneLike {
  get(key: string): unknown;
  fork(spec: { name: string; properties: Record<string, unknown> }): { run<T>(fn: () => T): T };
}

function currentZone(): ZoneLike | undefined {
  return (globalThis as { Zone?: { current: ZoneLike } }).Zone?.current;
}

/** The participant zone.js carried here, if zone.js is loaded and one was set. */
function zoneParticipant(): string | undefined {
  const value = currentZone()?.get(ZONE_KEY);
  return typeof value === 'string' ? value : undefined;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as PromiseLike<unknown>).then === 'function';
}

function isRxMethodRef(value: unknown): boolean {
  return typeof value === 'object' && value !== null && Object.keys(value).join() === 'destroy';
}

export const tracer = new Tracer();

/** Set PLOTLINE=1 to record. */
export const tracingEnabled = !!process.env.PLOTLINE;
