// Jest globalTeardown: lists every generated diagram in <PLOTLINE_DIR>/README.md.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export default function writeIndex(): void {
  const root = resolve(process.cwd(), process.env['PLOTLINE_DIR'] || 'plotline');
  if (!process.env['PLOTLINE'] || !existsSync(root)) return;

  const lines = ['# Traced behaviour', '', 'One sequence diagram per integration test.', ''];
  for (const spec of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    lines.push(`## ${spec.name}`, '');
    for (const file of readdirSync(join(root, spec.name)).filter((f) => f.endsWith('.md')).sort()) {
      const title = readFileSync(join(root, spec.name, file), 'utf8').split('\n')[0]!.replace(/^# /, '');
      lines.push(`- [${title}](${spec.name}/${file})`);
    }
    lines.push('');
  }
  writeFileSync(join(root, 'README.md'), lines.join('\n'));
}
