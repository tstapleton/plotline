/**
 * Works out which Angular component is doing something, using the debugging helpers
 * Angular publishes on `globalThis.ng` in development mode (which TestBed runs in).
 * Without them, everything falls back to the generic UI participant.
 */

interface NgDebug {
  getComponent(element: Element): object | null;
  getOwningComponent(element: Element): object | null;
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
