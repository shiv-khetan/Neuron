import * as React from 'react';
import { safeUrl } from '@/lib/view-security';

// Minimal, safe Markdown renderer for canvas text cards. The JSON Canvas spec
// says text nodes contain Markdown; canvas documents are untrusted input
// (synced/shared workspaces), so this renderer emits React elements only —
// there is no HTML string path, no dangerouslySetInnerHTML, and links pass
// through safeUrl. Raw HTML in the source renders as literal text.
//
// Supported: # headings, **bold**, *italic*, `code`, fenced code blocks,
// - / 1. lists, - [ ] tasks (read-only), > quotes, [text](url) links, ---.
// ponytail: line-based subset, not a full CommonMark parser — swap in the
// app's MDX pipeline only if canvases ever need components (they shouldn't).

const INLINE_TOKEN = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)\s]+\))/g;

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let i = 0;
  for (const [index, part] of text.split(INLINE_TOKEN).entries()) {
    if (!part) continue;
    const key = `${keyBase}.${index}`;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      out.push(<code key={key} className="cnv-md-code">{part.slice(1, -1)}</code>);
    } else if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      out.push(<strong key={key}>{renderInline(part.slice(2, -2), key)}</strong>);
    } else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      out.push(<em key={key}>{renderInline(part.slice(1, -1), key)}</em>);
    } else if (part.startsWith('[')) {
      const m = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      const href = m ? safeUrl(m[2]) : null;
      if (m && href) {
        out.push(
          <a key={key} href={href} target="_blank" rel="noreferrer" className="text-[var(--accent-strong)] underline" onPointerDown={(e) => e.stopPropagation()}>
            {m[1]}
          </a>,
        );
      } else {
        out.push(part); // unsafe or malformed link → literal text
      }
    } else {
      out.push(part);
    }
    i++;
  }
  return i === 0 ? [text] : out;
}

interface Block { key: string; el: React.ReactNode }

export function renderMarkdown(source: string): React.ReactNode {
  const lines = source.split('\n');
  const blocks: Block[] = [];
  let list: { ordered: boolean; items: React.ReactNode[] } | null = null;
  let code: string[] | null = null;

  const flushList = (key: string) => {
    if (!list) return;
    const items = list.items;
    blocks.push({
      key,
      el: list.ordered
        ? <ol key={key} className="cnv-md-list list-decimal">{items}</ol>
        : <ul key={key} className="cnv-md-list list-disc">{items}</ul>,
    });
    list = null;
  };

  for (const [i, line] of lines.entries()) {
    const key = `b${i}`;

    if (code !== null) {
      if (line.trim().startsWith('```')) {
        blocks.push({ key, el: <pre key={key} className="cnv-md-pre"><code>{code.join('\n')}</code></pre> });
        code = null;
      } else {
        code.push(line);
      }
      continue;
    }
    if (line.trim().startsWith('```')) { flushList(`${key}l`); code = []; continue; }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushList(`${key}l`);
      const level = Math.min(heading[1].length, 3); // clamp: cards are small
      const cls = level === 1 ? 'cnv-md-h1' : level === 2 ? 'cnv-md-h2' : 'cnv-md-h3';
      blocks.push({ key, el: React.createElement(`h${level}`, { key, className: cls }, renderInline(heading[2], key)) });
      continue;
    }

    const task = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
    if (task) {
      if (!list || list.ordered) { flushList(`${key}l`); list = { ordered: false, items: [] }; }
      list.items.push(
        <li key={key} className="list-none -ml-4 flex items-start gap-1.5">
          <input type="checkbox" checked={task[1] !== ' '} readOnly tabIndex={-1} className="mt-1 h-3 w-3 accent-[var(--accent)]" aria-label="Task" />
          <span className={task[1] !== ' ' ? 'text-[var(--ink-muted)] line-through' : undefined}>{renderInline(task[2], key)}</span>
        </li>,
      );
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+\.\s+(.*)$/);
    if (bullet || numbered) {
      const ordered = !!numbered;
      if (!list || list.ordered !== ordered) { flushList(`${key}l`); list = { ordered, items: [] }; }
      list.items.push(<li key={key}>{renderInline((bullet ?? numbered)![1], key)}</li>);
      continue;
    }
    flushList(`${key}l`);

    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) { blocks.push({ key, el: <hr key={key} className="my-1.5 border-[var(--divider)]" /> }); continue; }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) { blocks.push({ key, el: <blockquote key={key} className="cnv-md-quote">{renderInline(quote[1], key)}</blockquote> }); continue; }

    if (line.trim() === '') continue;
    blocks.push({ key, el: <p key={key} className="cnv-md-p">{renderInline(line, key)}</p> });
  }
  flushList('tail');
  if (code !== null) blocks.push({ key: 'tailcode', el: <pre key="tailcode" className="cnv-md-pre"><code>{code.join('\n')}</code></pre> });

  return <>{blocks.map((b) => b.el)}</>;
}
