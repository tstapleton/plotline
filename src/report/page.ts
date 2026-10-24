import { render } from 'pele';

/** Renders Mermaid text to an inline SVG with Pele, or an error box if it can't. */
export function svgOf(mermaid: string): string {
  try {
    return render(mermaid).svg;
  } catch (error) {
    return `<pre class="render-error">Could not render diagram: ${html(String(error))}</pre>`;
  }
}

export function html(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Self-contained page: inline CSS and SVG, no scripts, light and dark themes. */
export function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${html(title)}</title>
<style>${CSS}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

const CSS = `
:root {
  color-scheme: light dark;
  --bg: #f6f6f4; --surface: #ffffff; --text: #1d1c1a; --muted: #6b6862; --border: #e3e1dc;
  --accent: #2f5bd3; --added: #1f8a3b; --removed: #c2362f; --changed: #a86b00;
  --added-bg: rgba(46, 160, 67, 0.16); --removed-bg: rgba(218, 54, 51, 0.14); --changed-bg: rgba(212, 167, 44, 0.24); --moved-bg: rgba(56, 132, 255, 0.14);
  --pele-bg: var(--surface); --pele-fg: var(--text); --pele-muted: var(--muted); --pele-line: #3a3936;
  --pele-surface: #f4f3ef; --pele-surface-alt: #ebe9e3; --pele-border: #cfccc4; --pele-accent: var(--accent);
  --pele-radius: 6px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #121211; --surface: #1b1b19; --text: #e9e7e2; --muted: #a19e96; --border: #2f2e2b;
    --accent: #7c9cff; --added: #5cc27a; --removed: #ff7b72; --changed: #e3b341;
    --pele-line: #c9c6be; --pele-surface: #252522; --pele-surface-alt: #2e2d2a; --pele-border: #4a4843;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1400px; margin: 0 auto; padding: 32px 16px 64px; }
header h1 { font-size: 24px; margin: 0 0 4px; letter-spacing: -0.01em; }
header p { margin: 0; color: var(--muted); }
code { font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
nav { margin: 24px 0 32px; padding: 16px 20px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; }
nav h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 0 0 8px; }
nav ol, nav ul { margin: 0; padding-left: 20px; }
nav li { margin: 2px 0; }
section.test { margin: 0 0 32px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
section.test > .head { padding: 16px 20px; border-bottom: 1px solid var(--border); }
section.test h2 { font-size: 17px; margin: 0; }
section.test .meta { color: var(--muted); font-size: 13px; margin-top: 2px; }
.diagram { padding: 16px; overflow-x: auto; }
.diagram svg { display: block; margin: 0 auto; }
details { border-top: 1px solid var(--border); }
details > summary { cursor: pointer; padding: 10px 20px; color: var(--muted); font-size: 13px; }
details pre { margin: 0; padding: 12px 20px 20px; overflow-x: auto; font-size: 12px; }
.render-error { color: var(--removed); padding: 16px 20px; white-space: pre-wrap; }
.badge { display: inline-block; font-size: 12px; font-weight: 600; padding: 1px 8px; border-radius: 999px; margin-right: 6px; vertical-align: 1px; }
.badge.added { color: var(--added); background: var(--added-bg); }
.badge.removed { color: var(--removed); background: var(--removed-bg); }
.badge.changed { color: var(--changed); background: var(--changed-bg); }
.badge.same { color: var(--muted); background: var(--pele-surface); }
.legend { display: flex; flex-wrap: wrap; gap: 8px 18px; margin: 16px 0 0; color: var(--muted); font-size: 13px; }
.legend i { display: inline-block; width: 12px; height: 12px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; }
ul.tests { list-style: none; padding: 0; }
ul.tests li { margin: 4px 0; }
.counts { color: var(--muted); font-size: 13px; margin-left: 4px; }
section.test h2 .badge { margin-right: 8px; }
ul.changes { margin: 0; padding: 12px 20px; list-style: none; font-size: 14px; border-bottom: 1px solid var(--border); }
.summary { margin: 24px 0; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; }
.unstable { border-color: var(--changed); }
.unstable p { margin: 8px 20px 0; color: var(--muted); }
.where { display: inline-block; margin-left: 6px; border: 0; color: var(--muted); font-size: 13px; }
.where > summary { padding: 0; display: inline; }
.where ul { margin: 4px 0 2px; padding-left: 18px; }
.summary h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 16px 20px 0; }
.summary ul.changes { border-bottom: 0; }
ul.changes li { padding: 3px 0; overflow-wrap: anywhere; }
ul.changes .mark { display: inline-block; width: 18px; font-weight: 700; }
ul.changes .added .mark { color: var(--added); }
ul.changes .removed .mark { color: var(--removed); }
ul.changes .changed .mark { color: var(--changed); }
ul.changes .moved .mark { color: var(--accent); }
ul.changes .who { color: var(--muted); }
ul.changes .was { color: var(--muted); }
.sides { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 520px), 1fr)); gap: 0; }
.sides > div + div { border-left: 1px solid var(--border); }
.sides h3 { margin: 12px 20px 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
`;
