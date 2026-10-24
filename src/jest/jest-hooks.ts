import { ApplicationRef } from '@angular/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { recordUserEvents } from './dom-recorder';
import { toSequenceDiagram } from '../core/mermaid';
import { TraceFile } from '../core/model';
import { tracer, tracingEnabled } from './tracer';

/** Where traces go; set PLOTLINE_DIR to keep two runs apart (e.g. base and PR). */
export const OUTPUT_DIR = resolve(process.cwd(), process.env['PLOTLINE_DIR'] ?? 'plotline');

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

  beforeAll(() => {
    restoreTick = attributeChangeDetectionToUi();
  });

  afterAll(() => restoreTick());

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
    const trace: TraceFile = { version: 1, spec: relative(process.cwd(), testPath), test: currentTestName, ui: tracer.uiName, participants: tracer.participants, events };
    const file = join(dir, slug(currentTestName));
    writeFileSync(`${file}.json`, JSON.stringify(trace, null, 2) + '\n');
    writeFileSync(
      `${file}.md`,
      [`# ${currentTestName}`, '', `Generated from \`${trace.spec}\` by plotline.`, '', '```mermaid', toSequenceDiagram(trace), '```', ''].join('\n'),
    );
  });
}

/**
 * Change detection belongs to the UI, whichever participant scheduled it. Patches
 * ApplicationRef while this file's tests run, and returns a function that undoes it.
 */
function attributeChangeDetectionToUi(): () => void {
  const appRef = ApplicationRef.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  const tickName = typeof appRef['_tick'] === 'function' ? '_tick' : 'tick';
  const tick = appRef[tickName]!;
  appRef[tickName] = function (this: unknown, ...args: unknown[]) {
    return tracer.runAs(tracer.uiName, () => tick.apply(this, args));
  };
  return () => {
    appRef[tickName] = tick;
  };
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
