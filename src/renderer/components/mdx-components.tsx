import { AlertCircle, Info, CheckCircle, AlertTriangle } from 'lucide-react';

export type SemanticType = 'success' | 'warning' | 'error' | 'info';

export function parseSemanticType(value: string | undefined): SemanticType {
  return value === 'success' || value === 'warning' || value === 'error' ? value : 'info';
}

interface BadgeProps {
  type?: SemanticType;
  text: string;
}

export function Badge({ type = 'info', text }: BadgeProps) {
  const styles = {
    success: 'surface-success text-accent',
    warning: 'surface-warning text-warning',
    error: 'surface-danger text-danger',
    info: 'surface-info text-info',
  };
  return <span className={`inline-block rounded font-mono text-xs px-2 py-0.5 border ${styles[type]}`}>{text}</span>;
}

interface CalloutProps {
  type?: SemanticType;
  title?: string;
  children: React.ReactNode;
}

export function Callout({ type = 'info', title, children }: CalloutProps) {
  const config = {
    info: { border: 'surface-info', text: 'text-info', icon: Info },
    success: { border: 'surface-success', text: 'text-accent', icon: CheckCircle },
    warning: { border: 'surface-warning', text: 'text-warning', icon: AlertTriangle },
    error: { border: 'surface-danger', text: 'text-danger', icon: AlertCircle },
  };
  const active = config[type];
  const Icon = active.icon;
  return (
    <div className={`callout ${active.border} p-4 my-4 font-sans`}>
      <div className="flex items-start space-x-3">
        <Icon className={`h-5 w-5 shrink-0 ${active.text} mt-0.5`} />
        <div>
          {title && <h5 className={`font-semibold text-sm ${active.text} mb-1`}>{title}</h5>}
          <div className="text-secondary text-sm leading-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

// ---- GitHub-flavoured Markdown tables --------------------------------------

export type TableAlign = 'left' | 'center' | 'right';

export interface ParsedTable {
  headers: string[];
  aligns: TableAlign[];
  rows: string[][];
}

function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((cell) => cell.trim());
}

export function isTableDivider(line: string): boolean {
  if (!line.includes('-')) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c.replace(/\s/g, '')));
}

/** Parse a contiguous block of lines as a GFM table, or return null. */
export function parseMarkdownTable(lines: string[]): ParsedTable | null {
  if (lines.length < 2 || !lines[0].includes('|') || !isTableDivider(lines[1])) return null;
  const headers = splitTableRow(lines[0]);
  const aligns: TableAlign[] = splitTableRow(lines[1]).map((cell) => {
    const t = cell.replace(/\s/g, '');
    const left = t.startsWith(':');
    const right = t.endsWith(':');
    return left && right ? 'center' : right ? 'right' : left ? 'left' : 'left';
  });
  const rows = lines.slice(2).filter((l) => l.includes('|')).map(splitTableRow);
  return { headers, aligns, rows };
}

export function MarkdownTable({ headers, aligns, rows }: ParsedTable) {
  const columns = Math.max(headers.length, aligns.length);
  const align = (i: number): TableAlign => aligns[i] ?? 'left';
  return (
    <div className="my-4 overflow-x-auto rounded-md border border-[var(--divider)] font-sans">
      <table className="w-full min-w-[24rem] border-collapse text-sm">
        <thead className="bg-[var(--surface)]">
          <tr>
            {Array.from({ length: columns }, (_, i) => (
              <th key={i} scope="col" style={{ textAlign: align(i) }} className="border-b border-[var(--divider)] px-3 py-2 text-xs font-semibold text-[var(--md-heading)]">
                {headers[i] ?? ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-[var(--divider)] last:border-b-0">
              {Array.from({ length: columns }, (_, ci) => (
                <td key={ci} style={{ textAlign: align(ci) }} className="px-3 py-2 align-top text-xs leading-5 text-[var(--md-text)]">
                  {row[ci] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
