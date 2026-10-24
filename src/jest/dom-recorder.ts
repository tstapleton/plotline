import { owningComponent } from './components';
import { Tracer } from './tracer';

/**
 * Turns DOM events fired by Testing Library / user-event into "User → UI" messages.
 * Listens in the capture phase, so the gesture is recorded before the handlers it triggers.
 */
export function recordUserEvents(tracer: Tracer, root: Document = document): () => void {
  /** The component the user is interacting with, else the generic UI. */
  const target = (el: Element) => {
    tracer.observeComponents();
    const component = owningComponent(el);
    if (!component) return tracer.uiName;
    tracer.addComponent(component);
    return component;
  };

  const onInput = (event: Event) => {
    const el = event.target;
    if ((el instanceof HTMLInputElement && !isToggle(el)) || el instanceof HTMLTextAreaElement) {
      tracer.record({ kind: 'user', to: target(el), key: `type:${elementKey(el)}`, text: `types ${quote(el.value)} into ${quote(labelOf(el))}` });
    }
  };
  const onChange = (event: Event) => {
    const el = event.target;
    if (el instanceof HTMLSelectElement) {
      const text = el.selectedOptions[0]?.textContent?.trim() ?? el.value;
      tracer.record({ kind: 'user', to: target(el), key: `select:${elementKey(el)}`, text: `selects ${quote(text)} in ${quote(labelOf(el))}` });
    } else if (el instanceof HTMLInputElement && isToggle(el)) {
      tracer.record({ kind: 'user', to: target(el), key: `toggle:${elementKey(el)}`, text: `${el.checked ? 'checks' : 'unchecks'} ${quote(labelOf(el))}` });
    }
  };
  const onClick = (event: Event) => {
    const el = (event.target as Element | null)?.closest('button, a, [role="button"]');
    if (el) {
      const name = el.getAttribute('aria-label') || el.textContent?.trim().replace(/\s+/g, ' ') || el.tagName.toLowerCase();
      tracer.record({ kind: 'user', to: target(el), key: `click:${el.id || name}`, text: `clicks ${quote(name)}` });
    }
  };

  root.addEventListener('input', onInput, true);
  root.addEventListener('change', onChange, true);
  root.addEventListener('click', onClick, true);
  return () => {
    root.removeEventListener('input', onInput, true);
    root.removeEventListener('change', onChange, true);
    root.removeEventListener('click', onClick, true);
  };
}

function isToggle(el: HTMLInputElement): boolean {
  return el.type === 'checkbox' || el.type === 'radio';
}

function labelOf(el: HTMLElement): string {
  const labelled = el.getAttribute('aria-label');
  if (labelled) return labelled;
  const label = (el as HTMLInputElement).labels?.[0];
  return label?.textContent?.trim() || el.getAttribute('name') || el.id || el.tagName.toLowerCase();
}

function elementKey(el: Element): string {
  return el.id || labelOf(el as HTMLElement);
}

function quote(text: string): string {
  return `"${text.length > 40 ? text.slice(0, 39) + '…' : text}"`;
}
