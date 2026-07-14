import * as React from 'react';
import { safeUrl } from './view-security';

// Safe HTML → React for the handful of raw HTML fragments a Markdown/MDX note
// may contain (tables, basic formatting). Note content is UNTRUSTED input —
// synced and shared workspaces mean another person may have authored it — so
// this must never reach the DOM as a raw string. Parsing is done with
// DOMParser (inert: scripts don't run, resources don't load) and only an
// allowlist of tags/attributes is re-emitted as React elements. This replaces
// a `dangerouslySetInnerHTML` path that executed event handlers and nested
// `<img onerror>` from note text (stored XSS in the privileged renderer).
//
// Same allowlist-walk pattern as src/renderer/canvas/markdown.tsx.

// Tags safe to render structurally. Deliberately excludes script, style,
// iframe, object, embed, link, meta, form controls, and anything that can
// execute or load remote content beyond an allowlisted <img>/<a>.
const ALLOWED_TAGS = new Set([
  'div', 'span', 'p', 'br', 'hr',
  'b', 'strong', 'i', 'em', 'u', 's', 'small', 'mark', 'sub', 'sup', 'del', 'ins',
  'code', 'pre', 'kbd', 'samp',
  'blockquote', 'q', 'cite',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'a', 'img', 'figure', 'figcaption', 'abbr', 'time',
]);

// Void elements take no children.
const VOID_TAGS = new Set(['br', 'hr', 'img', 'col']);

// Attributes carried through verbatim (never event handlers, never `style`,
// never `srcset`/`href`/`src` — those are handled explicitly below).
const SAFE_ATTRS = new Set(['class', 'title', 'alt', 'colspan', 'rowspan', 'scope', 'align', 'datetime', 'lang', 'dir']);

// Map HTML attribute names to their React prop names.
const PROP_NAME: Record<string, string> = { class: 'className', colspan: 'colSpan', rowspan: 'rowSpan' };

function attrsToProps(el: Element, key: string): Record<string, unknown> {
  const props: Record<string, unknown> = { key };
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    // Drop every on* handler, style, and anything not explicitly allowed.
    if (name.startsWith('on')) continue;
    if (SAFE_ATTRS.has(name)) {
      props[PROP_NAME[name] ?? name] = attr.value;
    }
  }
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') {
    props.href = safeUrl(el.getAttribute('href')) ?? undefined;
    props.target = '_blank';
    props.rel = 'noreferrer';
  }
  if (tag === 'img') {
    props.src = safeUrl(el.getAttribute('src')) ?? undefined;
    if (props.alt === undefined) props.alt = '';
  }
  return props;
}

// Hard ceilings so a pathological fragment can't hang or balloon the renderer.
const MAX_NODES = 5000;
const MAX_DEPTH = 50;

function walk(node: ChildNode, key: string, budget: { n: number }, depth: number): React.ReactNode {
  if (++budget.n > MAX_NODES || depth > MAX_DEPTH) return null;
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null; // comments, PIs → dropped

  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const children = Array.from(el.childNodes).map((c, i) => walk(c, `${key}.${i}`, budget, depth + 1));

  // Disallowed tag: drop the element but keep its (already-sanitized) children,
  // so `<script>`/`<style>` vanish while `<unknown>text</unknown>` keeps text.
  if (!ALLOWED_TAGS.has(tag)) {
    if (tag === 'script' || tag === 'style') return null;
    return React.createElement(React.Fragment, { key }, children);
  }

  const props = attrsToProps(el, key);
  if (VOID_TAGS.has(tag)) return React.createElement(tag, props);
  return React.createElement(tag, props, children.length ? children : undefined);
}

/**
 * Parse an untrusted HTML fragment and return sanitized React nodes. Never
 * produces executable markup: no scripts, no inline handlers, no unsafe URLs.
 */
export function sanitizeHtmlToReact(html: string, keyBase = 'h'): React.ReactNode {
  if (typeof html !== 'string' || html.length === 0) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const budget = { n: 0 };
  const nodes = Array.from(doc.body.childNodes).map((c, i) => walk(c, `${keyBase}.${i}`, budget, 0));
  return React.createElement(React.Fragment, null, ...nodes);
}
