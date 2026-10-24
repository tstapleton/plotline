interface Subscriber {
  next(value: unknown): void;
  error(error: unknown): void;
  complete(): void;
}

interface ObservableLike {
  subscribe(observer: Partial<Subscriber>): unknown;
  pipe(...operators: unknown[]): unknown;
}

type ObservableConstructor = new (subscribe: (subscriber: Subscriber) => unknown) => ObservableLike;

/** An RxJS Observable (or Subject, or any look-alike), recognised without importing RxJS. */
export function isObservable(value: unknown): value is ObservableLike {
  return typeof value === 'object' && value !== null && typeof (value as ObservableLike).subscribe === 'function' && typeof (value as ObservableLike).pipe === 'function';
}

/**
 * The plain Observable class the value comes from: the root of its prototype chain, so
 * a Subject yields Observable, whose constructor takes a subscribe function.
 */
export function baseObservable(value: ObservableLike): ObservableConstructor {
  let proto = Object.getPrototypeOf(value) as { constructor: ObservableConstructor } | null;
  while (proto && Object.getPrototypeOf(proto) !== Object.prototype) proto = Object.getPrototypeOf(proto);
  return proto!.constructor;
}
