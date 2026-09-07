import { useState, useEffect, useMemo } from 'react';
import { AlertCircle, ArrowUpRight, Link2, FileWarning } from 'lucide-react';
import { Badge, Callout, parseSemanticType } from './mdx-components';
import { buildWikiIndex, resolveWikiLink } from '../lib/wikilinks';
import { Run } from './RunButton';
import DbView from './DbView';
import { Row, Col, Grid, Cell, Card, Stat, Divider } from './mdx-layout';
import DocumentProperties from './properties/DocumentProperties';
import { isFullWidth, parseFrontmatter } from '../lib/frontmatter';
import { sanitizeHtmlToReact } from '../lib/sanitize-html';
import MermaidDiagram from './MermaidDiagram';

// Links read as one object rather than as underlined text: an icon says where
// it goes before you read the label, and the pill gives it an edge to click.
const LINK_PILL =
  'inline-flex max-w-full items-baseline gap-1 rounded border border-[var(--divider)] bg-[var(--surface)] '
  + 'px-1.5 py-0.5 align-baseline font-[inherit] text-[0.95em] font-medium leading-tight text-[var(--md-link)] '
  + 'no-underline transition-colors hover:border-[var(--accent)] hover:bg-[var(--surface-hover)] '
  + 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] cursor-pointer';

// A link to a note that is not there. Same shape, so a broken link is obviously
// the same kind of thing as a working one, but muted and struck through.
const BROKEN_PILL =
  'inline-flex max-w-full items-baseline gap-1 rounded border border-dashed border-[var(--divider)] '
  + 'bg-transparent px-1.5 py-0.5 align-baseline text-[0.95em] font-medium leading-tight '
  + 'text-[var(--ink-muted)] line-through cursor-default';

interface MDXPreviewProps {
  mdxContent: string;
  colorScheme?: 'light' | 'dark';
  onLineClick?: (lineIndex: number) => void;
  showProperties?: boolean;
  tagSuggestions?: string[];
  onTagClick?: (tag: string) => void;
  notes?: string[];
  onWikiLinkClick?: (note: string) => void;
  defaultPropertiesCollapsed?: boolean;
  /**
   * Tick or untick the task on this source line. Without it the checkboxes
   * render read-only, which is what reading mode used to do -- a checkbox you
   * cannot click is a picture of a checkbox.
   */
  onToggleTask?: (lineIndex: number, checked: boolean) => void;
}

interface MDXParseError extends Error {
  block?: string;
  remediation?: string;
}

function normalizeError(error: unknown): MDXParseError {
  return error instanceof Error ? error as MDXParseError : new Error(String(error));
}

type TableAlignment = 'left' | 'center' | 'right';

function splitTableRow(row: string): string[] {
  const trimmed = row.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let cell = '';
  let escaped = false;

  for (const character of trimmed) {
    if (escaped) {
      cell += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += character;
    }
  }
  if (escaped) cell += '\\';
  cells.push(cell.trim());
  return cells;
}

function parseTableDivider(row: string): TableAlignment[] | null {
  if (!row.includes('|')) return null;
  const cells = splitTableRow(row);
  if (!cells.length || cells.some((cell) => !/^:?-+:?$/.test(cell))) return null;
  return cells.map((cell) => {
    if (cell.startsWith(':') && cell.endsWith(':')) return 'center';
    if (cell.endsWith(':')) return 'right';
    return 'left';
  });
}

// ==========================================
// 2. MDX RENDERER ENGINE WITH ERROR LEDGER
// ==========================================

export default function MDXPreview({ mdxContent, colorScheme = 'dark', onLineClick, showProperties = true, tagSuggestions = [], onTagClick, notes = [], onWikiLinkClick, onToggleTask, defaultPropertiesCollapsed = false }: MDXPreviewProps) {
  const [renderedContent, setRenderedContent] = useState<React.ReactNode[]>([]);
  const [compilationError, setCompilationError] = useState<{
    message: string;
    block: string;
    remediation: string;
  } | null>(null);

  // Strip the leading frontmatter block so it never renders as stray text or a
  // horizontal rule. Line clicks are offset back to the original document.
  const fm = useMemo(() => parseFrontmatter(mdxContent), [mdxContent]);
  const fmLineOffset = fm.hasFrontmatter ? (mdxContent.slice(0, fm.bodyStart).match(/\n/g)?.length ?? 0) : 0;
  const lineClick = (index: number) => onLineClick?.(index + fmLineOffset);
  const wikiNotes = useMemo(() => buildWikiIndex(notes), [notes]);

  useEffect(() => {
    setCompilationError(null);
    try {
      const parsedBlocks = parseMDX(fm.body);
      setRenderedContent(parsedBlocks);
    } catch (caughtError: unknown) {
      const error = normalizeError(caughtError);
      const errorMessage = error.message || 'Unknown parsing error';
      const errorBlock = error.block || '';
      const remediation = error.remediation || 'Check syntax format and balance JSX tags.';

      setCompilationError({
        message: errorMessage,
        block: errorBlock,
        remediation: remediation,
      });

      // To the diagnostic log under the app's logs directory, via IPC. This
      // used to name .agents/errors.json, which was gitignored tooling that
      // never shipped and was resolved against the process working directory.
      // The message embeds the offending block, so the main side redacts style
      // and code content before it reaches disk.
      if (window.electronAPI && window.electronAPI.logError) {
        window.electronAPI.logError({
          phase: 'COMPILATION',
          error_message: `${errorMessage} inside block: "${errorBlock}"`,
          stack_trace: error.stack || 'No stack trace available',
          remediation_step: remediation,
        });
      }
    }
  }, [colorScheme, fm.body, wikiNotes, onWikiLinkClick]);

  // Parsing helper to split and evaluate markdown vs custom components
  function parseMDX(content: string): React.ReactNode[] {
    const lines = content.split('\n');
    const nodes: React.ReactNode[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // MDX ESM: `import ... from '...'` / `export ...` are module syntax, not
      // prose. Neuron's renderer is a line parser, not a real MDX compiler, so
      // these fell through and rendered as literal text -- a note that declares
      // its components showed the declaration to the reader. Skip the statement,
      // including the multi-line brace form, and skip the blank line after it so
      // the removal does not leave a hole in the document.
      if (/^\s*(import|export)\s/.test(line)) {
        let open = (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
        i++;
        while (i < lines.length && open > 0) {
          open += (lines[i].match(/\{/g) ?? []).length - (lines[i].match(/\}/g) ?? []).length;
          i++;
        }
        if (i < lines.length && lines[i].trim() === '') i++;
        continue;
      }

      // Code Block parser (markdown)
      if (line.trim().startsWith('```')) {
        const lang = line.trim().slice(3).trim();
        const codeLines: string[] = [];
        const startLine = i;
        i++;
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        const codeText = codeLines.join('\n');
        nodes.push(lang.toLowerCase() === 'mermaid' ? (
          <div
            key={`mermaid-${i}`}
            onClick={() => lineClick(startLine)}
            className="work-surface my-5 min-h-32 overflow-auto rounded-md border cursor-pointer hover:border-[var(--accent)] transition-colors duration-150"
          >
            <MermaidDiagram source={codeText} colorScheme={colorScheme} />
          </div>
        ) : (
          <pre
            key={`code-${i}`}
            onClick={() => lineClick(startLine)}
            className="work-surface my-5 cursor-pointer overflow-x-auto rounded-md border p-4 font-mono text-sm text-[var(--md-text)] transition-colors duration-150 hover:border-[var(--ink-muted)]"
          >
            {lang && <div className="mb-2 text-[10px] font-medium text-muted">{lang}</div>}
            <code>{codeText}</code>
          </pre>
        ));
        i++;
        continue;
      }

      // GitHub-flavoured Markdown table. The divider row makes this
      // unambiguous, so ordinary prose containing a pipe is left untouched.
      const tableAlignments = i + 1 < lines.length ? parseTableDivider(lines[i + 1]) : null;
      if (line.includes('|') && tableAlignments) {
        const startLine = i;
        const headers = splitTableRow(line);
        const rows: string[][] = [];
        i += 2;
        while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
          rows.push(splitTableRow(lines[i]));
          i++;
        }
        const columnCount = Math.max(headers.length, tableAlignments.length);
        nodes.push(
          <div
            key={`table-${i}`}
            onClick={() => lineClick(startLine)}
            // Hovering a block to jump to its source is not selection, focus or
            // a primary action, so it does not get the accent. It lights the
            // frame one step, the way every other row in the app does.
            className="my-5 cursor-pointer overflow-x-auto rounded-md border border-[var(--divider)] transition-colors duration-150 hover:border-[var(--ink-muted)]"
          >
            <table className="w-full min-w-[32rem] border-collapse font-sans text-sm text-[var(--md-text)]">
              <thead className="bg-[var(--surface)] text-[var(--md-heading)]">
                <tr>
                  {Array.from({ length: columnCount }, (_, columnIndex) => (
                    <th
                      key={columnIndex}
                      scope="col"
                      style={{ textAlign: tableAlignments[columnIndex] ?? 'left' }}
                      className="border-b border-[var(--divider)] px-3 py-2 text-xs font-semibold"
                    >
                      {parseInlineFormatting(headers[columnIndex] ?? '')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-b border-[var(--divider)] last:border-b-0 hover:bg-[var(--surface-hover)]">
                    {Array.from({ length: columnCount }, (_, columnIndex) => (
                      <td
                        key={columnIndex}
                        style={{ textAlign: tableAlignments[columnIndex] ?? 'left' }}
                        className="px-3 py-2 align-top text-xs leading-5"
                      >
                        {parseInlineFormatting(row[columnIndex] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
        continue;
      }

      // Check if line contains custom JSX tag blocks
      const isJSXBlock = line.trim().startsWith('<') && (line.trim().endsWith('/>') || line.trim().includes('</') || line.trim().includes('>') || line.trim().startsWith('<Badge') || line.trim().startsWith('<Callout'));

      if (isJSXBlock) {
        const startLine = i;
        // A self-closing component (optionally followed by inline text on the same
        // line): render the component, then any trailing text as a markdown line.
        const selfClose = line.trim().match(/^(<[A-Za-z0-9]+\b[^>]*\/>)\s*(.*)$/);
        if (selfClose) {
          nodes.push(
            <div
              key={`jsx-${i}`}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('button')) return;
                lineClick(startLine);
              }}
              className="cursor-pointer hover:bg-[rgba(255,255,255,0.01)] rounded transition-colors duration-150"
            >
              {evaluateJSX(selfClose[1], i)}
            </div>
          );
          const remainder = selfClose[2].trim();
          if (remainder) nodes.push(renderMarkdownLine(remainder, i));
          i++;
          continue;
        }

        const fullJSXLines: string[] = [line];
        // If it is an opening tag but not self-closing, fetch lines until closing tag is found
        let isSelfClosing = line.trim().endsWith('/>');
        let tagNameMatch = line.match(/<([A-Za-z0-9]+)/);
        let tagName = tagNameMatch ? tagNameMatch[1] : '';

        if (!isSelfClosing && tagName && !line.includes(`</${tagName}>`)) {
          i++;
          let foundClosing = false;
          // Track depth: stopping at the first `</Tag>` would truncate
          // `<Grid>…<Grid>…</Grid>…</Grid>` at the inner close and leave the
          // outer one stranded as literal text.
          let depth = 1;
          const openRe = new RegExp(`<${tagName}\\b(?![^>]*/>)`, 'g');
          const closeRe = new RegExp(`</${tagName}>`, 'g');
          while (i < lines.length) {
            fullJSXLines.push(lines[i]);
            depth += (lines[i].match(openRe) ?? []).length;
            depth -= (lines[i].match(closeRe) ?? []).length;
            if (depth <= 0) {
              foundClosing = true;
              break;
            }
            i++;
          }
          if (!foundClosing) {
            const malformedBlock = fullJSXLines.join('\n');
            const error = new Error(`Unclosed MDX tag: </${tagName}> is missing.`) as MDXParseError;
            error.block = malformedBlock;
            error.remediation = `Close your tag with </${tagName}>. Make sure you don't have overlapping tags.`;
            throw error;
          }
        }

        const jsxString = fullJSXLines.join('\n').trim();
        nodes.push(
          <div
            key={`jsx-${startLine}`}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('button')) return;
              lineClick(startLine);
            }}
            className="cursor-pointer hover:bg-[rgba(255,255,255,0.01)] rounded transition-colors duration-150"
          >
            {evaluateJSX(jsxString, startLine)}
          </div>
        );
        i++;
        continue;
      }

      // Markdown line renderings
      if (line.trim() !== '') {
        nodes.push(renderMarkdownLine(line, i));
      }
      i++;
    }

    return nodes;
  }

  // Evaluates string to map dynamically into custom React elements
  function evaluateJSX(jsxStr: string, index: number): React.ReactNode {
    try {
      // 1. Match Badge
      if (jsxStr.startsWith('<Badge')) {
        const textMatch = jsxStr.match(/text="([^"]+)"/);
        const typeMatch = jsxStr.match(/type="([^"]+)"/);
        const text = textMatch ? textMatch[1] : 'badge';
        const type = parseSemanticType(typeMatch?.[1]);
        return <Badge key={`badge-${index}`} text={text} type={type} />;
      }

      // 2. Match Callout
      if (jsxStr.startsWith('<Callout')) {
        const typeMatch = jsxStr.match(/type="([^"]+)"/);
        const titleMatch = jsxStr.match(/title="([^"]+)"/);
        const type = parseSemanticType(typeMatch?.[1]);
        const title = titleMatch ? titleMatch[1] : undefined;

        // Children go back through parseMDX, exactly like the layout
        // primitives below. Rendered as a raw string a callout could only hold
        // one unformatted paragraph -- a list came out as literal dashes and
        // `code` as literal backticks, which is what a callout is most often
        // used for.
        const childrenMatch = jsxStr.match(/>([\s\S]*)<\/Callout>/);
        const content = childrenMatch ? childrenMatch[1].trim() : '';
        return (
          <Callout key={`callout-${index}`} type={type} title={title}>
            {content ? parseMDX(content) : null}
          </Callout>
        );
      }

      // 3. Layout primitives. Children are re-parsed through parseMDX so a Card
      // can hold markdown, another Card, or a DbView -- without that they would
      // arrive as raw text and the components would be decorative boxes.
      //
      // Attribute values are looked up in tables inside mdx-layout, never
      // interpolated into a class string: a note is untrusted content and
      // arbitrary CSS over the app chrome is UI spoofing.
      const layout: Record<string, (props: Record<string, string>, kids: React.ReactNode) => React.ReactNode> = {
        Row: (a, k) => <Row {...a}>{k}</Row>,
        Col: (a, k) => <Col {...a}>{k}</Col>,
        Grid: (a, k) => <Grid {...a}>{k}</Grid>,
        Cell: (a, k) => <Cell {...a}>{k}</Cell>,
        Card: (a, k) => <Card {...a}>{k}</Card>,
        Stat: (a) => <Stat {...a} />,
        Run: (a) => <Run {...a} />,
        Divider: (a) => <Divider {...a} />,
      };
      const layoutMatch = jsxStr.match(/^<([A-Z][A-Za-z0-9]*)\b/);
      if (layoutMatch && layout[layoutMatch[1]]) {
        const tag = layoutMatch[1];
        const openTag = jsxStr.slice(0, jsxStr.indexOf('>') + 1);
        const attrs: Record<string, string> = {};
        for (const m of openTag.matchAll(/([a-zA-Z][\w-]*)="([^"]*)"/g)) attrs[m[1]] = m[2];

        // Children are everything between the open tag and the LAST matching
        // close, so a nested tag of the same name does not truncate the block.
        const close = `</${tag}>`;
        const end = jsxStr.lastIndexOf(close);
        const inner = end > -1 ? jsxStr.slice(jsxStr.indexOf('>') + 1, end) : '';
        const kids = inner.trim() ? parseMDX(inner) : null;
        return <div key={`${tag}-${index}`}>{layout[tag](attrs, kids)}</div>;
      }

      // 3. Match DbView — embeds a .db database (table/board/card) by @path.
      if (jsxStr.startsWith('<DbView')) {
        const path = jsxStr.match(/path="([^"]+)"/)?.[1];
        const view = jsxStr.match(/view="([^"]+)"/)?.[1];
        const table = jsxStr.match(/table="([^"]+)"/)?.[1];
        if (!path) {
          const err = new Error('<DbView /> needs a path, e.g. <DbView path="@Planner.db" />.') as MDXParseError;
          err.block = jsxStr;
          err.remediation = 'Add a path attribute pointing at a .db file relative to the workspace root, prefixed with @.';
          throw err;
        }
        return <DbView key={`dbview-${index}`} path={path} view={view} table={table} />;
      }

      // If unrecognized component tag
      const tagName = (jsxStr.match(/<([A-Za-z0-9]+)/) || [])[1] || 'Unknown';
      const standardHtmlTags = [
        'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'br', 'hr',
        'div', 'span', 'p', 'b', 'i', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote'
      ];
      if (standardHtmlTags.includes(tagName.toLowerCase())) {
        // Note content is untrusted — sanitize instead of injecting raw HTML.
        // (Raw injection here was a stored-XSS path into the privileged renderer.)
        return <div key={`html-${index}`}>{sanitizeHtmlToReact(jsxStr, `html-${index}`)}</div>;
      }

      const err = new Error(`Component "<${tagName} />" is not registered in Neuron.`) as MDXParseError;
      err.block = jsxStr;
      err.remediation = `Register component "${tagName}" in src/renderer/components/MDXPreview.tsx or use supported components: <Badge />, <Callout />, <Run />, and <DbView />.`;
      throw err;

    } catch (caughtError: unknown) {
      const err = normalizeError(caughtError);
      // Inject block if not present
      if (!err.block) err.block = jsxStr;
      throw err;
    }
  }

  // Simple Markdown inline style renderer
  function renderMarkdownLine(text: string, index: number): React.ReactNode {
    // 1. Headings
    if (text.startsWith('# ')) {
      return (
        <h1
          key={index}
          onClick={() => lineClick(index)}
          // No rule under the heading. Size and weight already separate an h1
          // from the paragraph below it; the border added a second, louder
          // signal saying the same thing, and every document opened with a line
          // across it.
          className="-mx-1 mb-3 mt-7 cursor-pointer rounded px-1 font-sans text-2xl font-semibold text-[var(--md-heading)] transition-colors duration-150 hover:bg-[var(--surface)]"
        >
          {text.slice(2)}
        </h1>
      );
    }
    if (text.startsWith('## ')) {
      return (
        <h2
          key={index}
          onClick={() => lineClick(index)}
          className="mt-6 mb-2 font-sans text-xl font-semibold text-[var(--md-heading)] cursor-pointer hover:bg-[rgba(255,255,255,0.015)] rounded px-1 -mx-1 transition-colors duration-150"
        >
          {text.slice(3)}
        </h2>
      );
    }
    if (text.startsWith('### ')) {
      return (
        <h3
          key={index}
          onClick={() => lineClick(index)}
          className="mt-5 mb-2 font-sans text-base font-semibold text-[var(--md-heading)] cursor-pointer hover:bg-[rgba(255,255,255,0.015)] rounded px-1 -mx-1 transition-colors duration-150"
        >
          {text.slice(4)}
        </h3>
      );
    }

    // 2. Unordered lists
    if (text.startsWith('- ') || text.startsWith('* ')) {
      const item = text.slice(2);
      const task = /^\[( |x|X)?\]\s*(.*)$/.exec(item);
      if (task) {
        const checked = task[1]?.toLowerCase() === 'x';
        return (
          <ul
            key={index}
            onClick={() => lineClick(index)}
            className="my-2 list-none font-sans text-sm leading-6 text-[var(--md-text)] cursor-pointer hover:bg-[rgba(255,255,255,0.015)] rounded px-1 -mx-1 transition-colors duration-150"
          >
            <li className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={checked}
                readOnly={!onToggleTask}
                onChange={(event) => onToggleTask?.(index + fmLineOffset, event.target.checked)}
                onClick={(event) => event.stopPropagation()}
                aria-label={checked ? 'Completed task' : 'Incomplete task'}
                className="task-checkbox mt-1"
              />
              <span className={checked ? 'text-[var(--ink-muted)] line-through' : undefined}>{parseInlineFormatting(task[2])}</span>
            </li>
          </ul>
        );
      }
      return (
        <ul
          key={index}
          onClick={() => lineClick(index)}
          className="my-2 list-disc space-y-1 pl-6 font-sans text-sm leading-6 text-[var(--md-text)] cursor-pointer hover:bg-[rgba(255,255,255,0.015)] rounded px-1 -mx-1 transition-colors duration-150"
        >
          <li>{parseInlineFormatting(item)}</li>
        </ul>
      );
    }

    // 3. Blockquotes
    if (text.startsWith('> ')) {
      return (
        <blockquote
          key={index}
          onClick={() => lineClick(index)}
          className="my-4 rounded-md border border-[var(--md-quote-border)] bg-[var(--surface)] px-4 py-3 font-sans text-sm italic text-[var(--md-quote)] cursor-pointer hover:border-[var(--accent)] transition-colors duration-150"
        >
          {parseInlineFormatting(text.slice(2))}
        </blockquote>
      );
    }

    const standaloneTask = /^\[( |x|X)?\]\s*(.*)$/.exec(text);
    if (standaloneTask) {
      const checked = standaloneTask[1]?.toLowerCase() === 'x';
      return (
        <div
          key={index}
          onClick={() => lineClick(index)}
          className="my-2 flex items-start gap-2 font-sans text-sm leading-6 text-[var(--md-text)] cursor-pointer hover:bg-[rgba(255,255,255,0.015)] rounded px-1 -mx-1 transition-colors duration-150"
        >
          <input
            type="checkbox"
            checked={checked}
            readOnly={!onToggleTask}
            onChange={(event) => onToggleTask?.(index + fmLineOffset, event.target.checked)}
            onClick={(event) => event.stopPropagation()}
            aria-label={checked ? 'Completed task' : 'Incomplete task'}
            className="task-checkbox mt-1"
          />
          {standaloneTask[2] && <span className={checked ? 'text-[var(--ink-muted)] line-through' : undefined}>{parseInlineFormatting(standaloneTask[2])}</span>}
        </div>
      );
    }

    // Standard paragraph
    return (
      <p
        key={index}
        onClick={() => lineClick(index)}
        className="my-2 font-sans text-sm leading-7 text-[var(--md-text)] cursor-pointer hover:bg-[rgba(255,255,255,0.015)] rounded px-1 -mx-1 transition-colors duration-150"
      >
        {parseInlineFormatting(text)}
      </p>
    );
  }

  // Replaces inline styling: bold, italics, inline code, wikilinks
  function parseInlineFormatting(text: string): React.ReactNode[] {
    const parts: React.ReactNode[] = [];
    let currentText = text;
    let key = 0;

    // Matches bold, italic, code, and wikilinks [[Note Name]]
    // [[wikilink]] must come before [text](url) or the wikilink's own
    // brackets match the inline-link pattern first.
    const regex = /(\*\*.*?\*\*|\*.*?\*|`.*?`|\[\[.*?\]\]|\[[^\]]*\]\([^)\s]+\)|<[bB][rR]\s*\/?>)/g;
    const items = currentText.split(regex);

    for (const item of items) {
      if (item.startsWith('**') && item.endsWith('**')) {
        parts.push(<strong key={key++} className="font-semibold text-[var(--md-bold)]">{item.slice(2, -2)}</strong>);
      } else if (item.startsWith('*') && item.endsWith('*')) {
        parts.push(<em key={key++} className="italic text-[var(--md-text)]">{item.slice(1, -1)}</em>);
      } else if (item.startsWith('`') && item.endsWith('`')) {
        parts.push(<code key={key++} className="rounded border border-[var(--divider)] bg-[var(--md-code-bg)] px-1.5 py-0.5 font-mono text-xs text-[var(--md-code)]">{item.slice(1, -1)}</code>);
      } else if (item.startsWith('[[') && item.endsWith(']]')) {
        const linkTarget = item.slice(2, -2);
        const resolved = resolveWikiLink(wikiNotes, linkTarget);
        parts.push(
          resolved ? (
            <button
              key={key++}
              type="button"
              aria-label={`Open note ${resolved}`}
              title={`Open ${resolved}`}
              className={LINK_PILL}
              onClick={(event) => {
                event.stopPropagation();
                onWikiLinkClick?.(resolved);
              }}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              <Link2 className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
              {linkTarget}
            </button>
          ) : (
            <span
              key={key++}
              title={`No note found for "${linkTarget}"`}
              className={BROKEN_PILL}
            >
              <FileWarning className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
              {linkTarget}<span className="sr-only"> (missing note)</span>
            </span>
          )
        );
      } else if (/^\[[^\]]*\]\([^)\s]+\)$/.test(item)) {
        // A standard Markdown link. These used to fall through to the plain-text
        // branch and render as literal `[label](url)` -- the syntax on screen
        // rather than the link it describes.
        const split = /^\[([^\]]*)\]\(([^)\s]+)\)$/.exec(item)!;
        const label = split[1] || split[2];
        const href = split[2];
        const external = /^[a-z][a-z0-9+.-]*:/i.test(href);

        if (external) {
          parts.push(
            // A real anchor: main already routes http(s) navigation to the
            // system browser through its own guard, so this needs no bridge of
            // its own and cannot move the app frame.
            <a
              key={key++}
              href={href}
              title={href}
              className={LINK_PILL}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              <ArrowUpRight className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
              {label}
            </a>,
          );
        } else {
          const resolved = resolveWikiLink(wikiNotes, href.replace(/\.(md|mdx)$/i, ''));
          parts.push(
            resolved ? (
              <button
                key={key++}
                type="button"
                aria-label={`Open note ${resolved}`}
                title={`Open ${resolved}`}
                className={LINK_PILL}
                onClick={(event) => { event.stopPropagation(); onWikiLinkClick?.(resolved); }}
                onDoubleClick={(event) => event.stopPropagation()}
              >
                <Link2 className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                {label}
              </button>
            ) : (
              <span key={key++} title={`No note found for "${href}"`} className={BROKEN_PILL}>
                <FileWarning className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                {label}<span className="sr-only"> (missing note)</span>
              </span>
            ),
          );
        }
      } else if (/<[bB][rR]\s*\/?>/.test(item)) {
        parts.push(<br key={key++} />);
      } else {
        parts.push(item);
      }
    }

    return parts;
  }

  return (
    // The flag goes on the scroll container rather than on each block inside
    // it, so the properties panel and the article widen together and a future
    // block cannot forget to opt in.
    <div
      className="canvas-surface h-full w-full overflow-y-auto p-7 font-sans select-text"
      data-full-width={isFullWidth(fm.data) || undefined}
    >
      {showProperties && fm.hasFrontmatter && (
        <div className="preview-prose mx-auto mb-4">
          <DocumentProperties doc={mdxContent} tagSuggestions={tagSuggestions} onTagClick={onTagClick} defaultCollapsed={defaultPropertiesCollapsed} hideWhenEmpty />
        </div>
      )}
      {compilationError ? (
        <div role="alert" className="surface-danger rounded-md border p-5 font-sans">
          <div className="mb-3 flex items-center space-x-2 font-semibold text-danger">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span className="text-sm font-semibold">MDX compilation error</span>
          </div>
          <p className="mb-2 text-sm font-semibold text-primary">{compilationError.message}</p>
          {compilationError.block && (
            <pre className="canvas-surface my-3 overflow-x-auto rounded-md border p-3 font-mono text-xs text-danger">
              <code>{compilationError.block}</code>
            </pre>
          )}
          <div className="mt-2 text-xs leading-5 text-secondary">
            <span className="font-semibold text-primary">How to fix it:</span> {compilationError.remediation}
          </div>
        </div>
      ) : (
        <article className="preview-prose mx-auto space-y-3 text-[var(--md-text)]">
          {renderedContent.length > 0 ? renderedContent : (
            <div className="py-16 text-center font-mono text-sm text-muted">Nothing to preview yet.</div>
          )}
        </article>
      )}
    </div>
  );
}
