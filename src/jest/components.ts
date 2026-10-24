/**
 * Works out which Angular component is doing something, using the debugging helpers
 * Angular publishes on `globalThis.ng` in development mode (which TestBed runs in).
 * Without them, everything falls back to the generic UI participant.
 */

interface NgDebug {
  getComponent(element: Element): object | null;
  getOwningComponent(element: Element): object | null;
}

export interface OutputSource {
  /** The component emitting. */
  child: string;
  /** The component whose template listens. */
  parent: string;
  /** The output's property name, e.g. `servingsChange`. */
  output: string;
}

/**
 * Which rendered component an output belongs to, found by looking for the component
 * that holds this OutputEmitterRef, and which component's template uses it.
 */
export function outputSource(emitter: object): OutputSource | undefined {
  const debug = ng();
  if (!debug) return undefined;
  for (const element of Array.from(document.querySelectorAll('*'))) {
    const component = debug.getComponent(element) as Record<string, unknown> | null;
    if (!component) continue;
    const output = Object.keys(component).find((key) => component[key] === emitter);
    if (!output) continue;
    const child = nameOf(component);
    const parent = nameOf(debug.getOwningComponent(element));
    return child && parent ? { child, parent, output } : undefined;
  }
  return undefined;
}

function ng(): NgDebug | undefined {
  const candidate = (globalThis as { ng?: Partial<NgDebug> }).ng;
  return typeof candidate?.getComponent === 'function' && typeof candidate.getOwningComponent === 'function' ? (candidate as NgDebug) : undefined;
}

/** The component whose template contains `element`. */
export function owningComponent(element: Element): string | undefined {
  return nameOf(ng()?.getOwningComponent(element));
}

/**
 * Class names on the current call stack, innermost first: from template listeners such
 * as `RecipeDetailPage_Conditional_5_Template_button_click_51_listener`, methods such as
 * `RecipeDetailPage.ngOnInit`, and constructors (`new RecipeListPage`) creating a store.
 * Which of them are components is decided against `renderedComponents()`.
 */
export function classesOnStack(): string[] {
  const names: string[] = [];
  for (const line of (new Error().stack ?? '').split('\n').slice(2)) {
    const frame = /^\s*at (?:async )?(?:new )?([^\s(]+)/.exec(line)?.[1];
    const candidate = frame && /^_*([A-Z][\w$]*?)(?:_|\.|$)/.exec(frame)?.[1];
    if (candidate && !names.includes(candidate)) names.push(candidate);
  }
  return names;
}

/** Names of the components currently rendered on the page. */
export function renderedComponents(): Set<string> {
  const debug = ng();
  return debug ? componentsIn(debug) : new Set();
}

function componentsIn(debug: NgDebug): Set<string> {
  const names = new Set<string>();
  for (const element of Array.from(document.querySelectorAll('*'))) {
    const name = nameOf(debug.getComponent(element));
    if (name) names.add(name);
  }
  return names;
}

function nameOf(instance: object | null | undefined): string | undefined {
  const name = instance?.constructor?.name;
  // Strip the leading underscore some compilers add to class names.
  return name ? name.replace(/^_+/, '') : undefined;
}
