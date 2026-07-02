import { useState, useEffect } from 'react';
import { AlertCircle } from 'lucide-react';
import { Badge, Callout, parseSemanticType } from './mdx-components';

interface MDXPreviewProps {
  mdxContent: string;
  onLineClick?: (lineIndex: number) => void;
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

export default function MDXPreview({ mdxContent, onLineClick }: MDXPreviewProps) {
  const [renderedContent, setRenderedContent] = useState<React.ReactNode[]>([]);
  const [compilationError, setCompilationError] = useState<{
    message: string;
    block: string;
    remediation: string;
  } | null>(null);

  useEffect(() => {
    setCompilationError(null);
    try {
      const parsedBlocks = parseMDX(mdxContent);
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

      // Log to .agents/errors.json via IPC
      if (window.electronAPI && window.electronAPI.logError) {
        window.electronAPI.logError({
          phase: 'COMPILATION',
          error_message: `${errorMessage} inside block: "${errorBlock}"`,
          stack_trace: error.stack || 'No stack trace available',
          remediation_step: remediation,
        });
      }
    }
  }, [mdxContent]);

  // Parsing helper to split and evaluate markdown vs custom components
  function parseMDX(content: string): React.ReactNode[] {
    const lines = content.split('\n');
    const nodes: React.ReactNode[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Code Block parser (markdown)
      if (line.trim().startsWith('```')) {
        const lang = line.trim().slice(3);
        const codeLines: string[] = [];
        const startLine = i;
        i++;
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        const codeText = codeLines.join('\n');
        nodes.push(
          <pre
            key={`code-${i}`}
            onClick={() => onLineClick?.(startLine)}
            className="work-surface my-5 overflow-x-auto rounded-md border p-4 font-mono text-sm text-[var(--md-text)] cursor-pointer hover:border-[var(--accent)] transition-colors duration-150"
          >
            {lang && <div className="mb-2 text-[10px] font-medium text-muted">{lang}</div>}
            <code>{codeText}</code>
          </pre>
        );
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
            onClick={() => onLineClick?.(startLine)}
            className="my-5 overflow-x-auto rounded-md border border-[var(--divider)] cursor-pointer hover:border-[var(--accent)] transition-colors duration-150"
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
                onLineClick?.(startLine);
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
          while (i < lines.length) {
            fullJSXLines.push(lines[i]);
            if (lines[i].includes(`</${tagName}>`)) {
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
              onLineClick?.(startLine);
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

        // Extract children content
        const childrenMatch = jsxStr.match(/>([\s\S]*?)<\/Callout>/);
        const content = childrenMatch ? childrenMatch[1].trim() : '';
        return (
          <Callout key={`callout-${index}`} type={type} title={title}>
            {content}
          </Callout>
        );
      }

      // If unrecognized component tag
      const tagName = (jsxStr.match(/<([A-Za-z0-9]+)/) || [])[1] || 'Unknown';
      const standardHtmlTags = [
        'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'br', 'hr',
        'div', 'span', 'p', 'b', 'i', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote'
      ];
      if (standardHtmlTags.includes(tagName.toLowerCase())) {
        return (
          <div
            key={`html-${index}`}
            dangerouslySetInnerHTML={{ __html: jsxStr }}
          />
        );
      }

      const err = new Error(`Component "<${tagName} />" is not registered in Neuron.`) as MDXParseError;
      err.block = jsxStr;
      err.remediation = `Register component "${tagName}" in src/renderer/components/MDXPreview.tsx or use supported components: <Badge /> and <Callout />.`;
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
          onClick={() => onLineClick?.(index)}
          className="mt-7 mb-3 border-b divider-color pb-3 font-sans text-2xl font-semibold text-[var(--md-heading)] cursor-pointer hover:bg-[rgba(255,255,255,0.015)] rounded px-1 -mx-1 transition-colors duration-150"
        >
          {text.slice(2)}
        </h1>
      );
    }
    if (text.startsWith('## ')) {
      return (
        <h2
          key={index}
          onClick={() => onLineClick?.(index)}
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
          onClick={() => onLineClick?.(index)}
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
            onClick={() => onLineClick?.(index)}
            className="my-2 list-none font-sans text-sm leading-6 text-[var(--md-text)] cursor-pointer hover:bg-[rgba(255,255,255,0.015)] rounded px-1 -mx-1 transition-colors duration-150"
          >
            <li className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={checked}
                readOnly
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
          onClick={() => onLineClick?.(index)}
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
          onClick={() => onLineClick?.(index)}
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
          onClick={() => onLineClick?.(index)}
          className="my-2 flex items-start gap-2 font-sans text-sm leading-6 text-[var(--md-text)] cursor-pointer hover:bg-[rgba(255,255,255,0.015)] rounded px-1 -mx-1 transition-colors duration-150"
        >
          <input
            type="checkbox"
            checked={checked}
            readOnly
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
        onClick={() => onLineClick?.(index)}
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
    const regex = /(\*\*.*?\*\*|\*.*?\*|`.*?`|\[\[.*?\]\]|<[bB][rR]\s*\/?>)/g;
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
        parts.push(
          <span key={key++} className="font-medium text-[var(--md-link)] underline decoration-dotted underline-offset-4">
            {linkTarget}
          </span>
        );
      } else if (/<[bB][rR]\s*\/?>/.test(item)) {
        parts.push(<br key={key++} />);
      } else {
        parts.push(item);
      }
    }

    return parts;
  }

  return (
    <div className="canvas-surface h-full w-full overflow-y-auto p-7 font-sans select-text">
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
