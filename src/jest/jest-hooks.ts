import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { ApplicationRef, OutputEmitterRef } from '@angular/core';
import { ComponentFixture } from '@angular/core/testing';
import { toSequenceDiagram } from '../core/mermaid';
import type { TraceFile } from '../core/model';
import { recordUserEvents } from './dom-recorder';
import { tracer, tracingEnabled } from './tracer';

/** Where traces go; set PLOTLINE_DIR to keep two runs apart (e.g. base and PR). */
export const OUTPUT_DIR = resolve(process.cwd(), process.env.PLOTLINE_DIR ?? 'plotline');

// Module state is per test file, because Jest gives each file its own module registry.
let registered = false;

/**
 * Records the tests in the calling spec file, one diagram each, when the run sets
 * PLOTLINE=1. Call it at the top level of a spec file, or of a test helper that spec
 * files import; other test files in the repo are untouched. Calling it more than once
 * in a file is harmless.
 *
 * Writes plotline/<spec>/<test>.json, plus a Mermaid diagram of it in <test>.md.
 */
export function recordPlotline(): void {
  if (!tracingEnabled || registered) return;
  registered = true;

  let restoreTick: () => void = () => undefined;
  let stopRecordingDom: () => void = () => undefined;

  let restoreOutputs: () => void = () => undefined;

  beforeAll(() => {
    restoreTick = attributeChangeDetectionToUi();
    restoreOutputs = recordOutputs();
  });

  afterAll(() => {
    restoreTick();
    restoreOutputs();
  });

  beforeEach(() => {
    tracer.start();
    stopRecordingDom = recordUserEvents(tracer);
  });

  afterEach(() => {
    stopRecordingDom();
    const events = tracer.stop();
    if (!events.length) return;

    const { testPath = '', currentTestName = 'test' } = expect.getState();
    const spec = basename(testPath).replace(/\.spec\.ts$/, '');
    const dir = join(OUTPUT_DIR, spec);
    mkdirSync(dir, { recursive: true });
    const trace: TraceFile = {
      version: 1,
      spec: relative(process.cwd(), testPath),
      test: currentTestName,
      ui: tracer.uiName,
      participants: tracer.participants,
      events,
    };
    const file = join(dir, slug(currentTestName));
    writeFileSync(`${file}.json`, `${JSON.stringify(trace, null, 2)}\n`);
    writeFileSync(
      `${file}.md`,
      [
        `# ${currentTestName}`,
        '',
        `Generated from \`${trace.spec}\` by plotline.`,
        '',
        '```mermaid',
        toSequenceDiagram(trace),
        '```',
        '',
      ].join('\n'),
    );
  });
}

/**
 * Change detection belongs to the UI, whichever participant scheduled it: through
 * ApplicationRef (the app, zoneless tests) or a test fixture (Testing Library, zone.js
 * tests). Patches both while this file's tests run, and returns a function that undoes it.
 */
function attributeChangeDetectionToUi(): () => void {
  const appRef = ApplicationRef.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  const fixture = ComponentFixture.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  const targets: [Record<string, (...args: unknown[]) => unknown>, string][] = [
    [appRef, typeof appRef._tick === 'function' ? '_tick' : 'tick'],
    [fixture, 'detectChanges'],
  ];
  const originals = targets.map(([target, name]) => {
    const original = target[name];
    target[name] = function (this: unknown, ...args: unknown[]) {
      const result = tracer.runAs(tracer.uiName, () => original.apply(this, args));
      tracer.observeComponents();
      return result;
    };
    return original;
  });
  return () => {
    for (const [i, [target, name]] of targets.entries()) target[name] = originals[i];
  };
}

/**
 * Draws a component's output as a message to the parent listening to it, so a click in
 * a child reads: User ->> Stepper, Stepper ->> Page: changed(4), Page ->> Store.
 */
function recordOutputs(): () => void {
  const proto = OutputEmitterRef.prototype as unknown as { emit(value: unknown): void };
  const emit = proto.emit;
  proto.emit = function (this: object, value: unknown) {
    tracer.recordOutput(this, value);
    return emit.call(this, value);
  };
  return () => {
    proto.emit = emit;
  };
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
