// The stylesheet served to every HTMX view: Neuron design tokens as CSS
// variables plus a small namespaced class set. Embedded as a string so the
// packaged app needs no extra asset plumbing.

export const NEURON_VIEW_CSS = `
:root { color-scheme: light dark; }

body.neuron-view {
  --canvas: #f7f7f5;
  --surface: #efefec;
  --surface-hover: #e6e6e2;
  --divider: #dcdcd7;
  --ink: #1c1c1a;
  --ink-secondary: #4b4b47;
  --ink-muted: #8a8a83;
  --accent: #4f8f6f;
  --accent-strong: #35745a;
  --danger: #c25549;
  margin: 0;
  padding: 1.5rem;
  background: var(--canvas);
  color: var(--ink);
  font: 14px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
}

body.neuron-view.theme-dark {
  --canvas: #11181c;
  --surface: #182026;
  --surface-hover: #1f2930;
  --divider: #26313a;
  --ink: #e8ebed;
  --ink-secondary: #b3bcc2;
  --ink-muted: #7d8990;
  --accent: #5aa583;
  --accent-strong: #7dc4a3;
  --danger: #e07a6e;
}

.neuron-view h1 { font-size: 1.5rem; font-weight: 600; margin: 0 0 0.75rem; }
.neuron-view h2 { font-size: 1.2rem; font-weight: 600; margin: 1.25rem 0 0.5rem; }
.neuron-view h3 { font-size: 1rem; font-weight: 600; margin: 1rem 0 0.4rem; }
.neuron-view p { margin: 0.5rem 0; color: var(--ink-secondary); }
.neuron-view a { color: var(--accent-strong); }
.neuron-view code { font-family: ui-monospace, monospace; font-size: 0.85em; background: var(--surface); padding: 0.1rem 0.3rem; border-radius: 4px; }
.neuron-view label { display: block; font-size: 0.8rem; font-weight: 500; color: var(--ink-muted); margin-bottom: 0.3rem; }

.neuron-card { background: var(--surface); border-radius: 10px; padding: 1rem; }
.neuron-card + .neuron-card, section + section { margin-top: 1rem; }

.neuron-stack { display: flex; flex-direction: column; gap: 0.75rem; }
.neuron-grid { display: grid; gap: 1rem; grid-template-columns: 1fr; }
@media (min-width: 640px) {
  .neuron-grid.cols-2 { grid-template-columns: repeat(2, 1fr); }
  .neuron-grid.cols-3 { grid-template-columns: repeat(3, 1fr); }
  .neuron-grid.cols-4 { grid-template-columns: repeat(4, 1fr); }
}
.neuron-toolbar { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1rem; }

.neuron-button {
  display: inline-flex; align-items: center; gap: 0.4rem;
  background: var(--accent); color: var(--canvas); border: none; border-radius: 7px;
  padding: 0.45rem 0.9rem; font: inherit; font-size: 0.85rem; font-weight: 600; cursor: pointer;
}
.neuron-button:hover { background: var(--accent-strong); }
.neuron-button.secondary { background: var(--surface-hover); color: var(--ink); }

.neuron-input, .neuron-view select, .neuron-view textarea {
  width: 100%; box-sizing: border-box; background: var(--canvas); color: var(--ink);
  border: 1px solid var(--divider); border-radius: 7px; padding: 0.45rem 0.6rem; font: inherit;
}
.neuron-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 1.5px var(--accent); }

.neuron-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
.neuron-table th { text-align: left; font-weight: 500; color: var(--ink-muted); padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--divider); }
.neuron-table td { padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--divider); color: var(--ink-secondary); }
.neuron-table tr:last-child td { border-bottom: none; }

.neuron-badge { display: inline-block; font-size: 0.72rem; font-weight: 500; padding: 0.1rem 0.5rem; border-radius: 999px; background: var(--surface-hover); color: var(--ink-secondary); }
.neuron-metric { font-size: 2rem; font-weight: 600; letter-spacing: -0.02em; }
.neuron-metric-label { font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-muted); }

.neuron-list { list-style: none; margin: 0.5rem 0 0; padding: 0; }
.neuron-list-row { display: flex; gap: 0.75rem; align-items: baseline; padding: 0.35rem 0.25rem; border-bottom: 1px solid var(--divider); font-size: 0.85rem; flex-wrap: wrap; }
.neuron-list-row:last-child { border-bottom: none; }
.neuron-file-name { font-weight: 500; color: var(--ink); }
.neuron-file-path { margin-left: auto; font-family: ui-monospace, monospace; font-size: 0.72rem; color: var(--ink-muted); }
.neuron-snippet { flex-basis: 100%; color: var(--ink-secondary); font-size: 0.8rem; }

.neuron-alert { background: color-mix(in srgb, var(--danger) 12%, var(--surface)); border: 1px solid var(--danger); color: var(--ink); border-radius: 8px; padding: 0.6rem 0.9rem; font-size: 0.85rem; margin: 0.5rem 0; }
.neuron-empty { color: var(--ink-muted); font-size: 0.85rem; padding: 0.75rem 0.25rem; }

.htmx-indicator { opacity: 0; transition: opacity 150ms ease-in; }
.htmx-request .htmx-indicator, .htmx-request.htmx-indicator { opacity: 1; }
`;
