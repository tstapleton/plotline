import { ApplicationRef } from '@angular/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { recordUserEvents } from './dom-recorder';
import { toSequenceDiagram } from '../core/mermaid';
import { TraceFile } from '../core/model';
import { tracer, tracingEnabled } from './tracer';

/** Where traces go; set PLOTLINE_DIR to keep two runs apart (e.g. base and PR). */
export const OUTPUT_DIR = resolve(process.cwd(), process.env['PLOTLINE_DIR'] ?? 'plotline');

/**
 * With PLOTLINE=1, writes each test's trace to plotline/<spec>/<test>.json, plus a Mermaid
 * sequence diagram of it to <test>.md.
 */
export function installTraceHooks(): void {
  if (!tracingEnabled) return;

  // Change detection belongs to the UI, whichever participant scheduled it.
  const appRef = ApplicationRef.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  const tickName = typeof appRef['_tick'] === 'function' ? '_tick' : 'tick';
  const tick = appRef[tickName];
  appRef[tickName] = function (this: unknown, ...args: unknown[]) {
    return tracer.runAs(tracer.uiName, () => tick.apply(this, args));
  };

  let stopRecordingDom: () => void = () => undefined;

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

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
