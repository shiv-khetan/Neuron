import { useMemo, useState, useRef, useEffect } from 'react';
import { ChevronRight, Plus, X, MoreHorizontal, AlertTriangle, Code2, ListTree, Tag, Hash, Type, ToggleLeft, Calendar } from 'lucide-react';
import {
  parseFrontmatter,
  serializeFrontmatter,
  type DocumentProperty,
  type PropertyType,
  type FrontmatterEntry,
} from '../../lib/frontmatter';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '../ui/dropdown-menu';

export interface DocumentPropertiesProps {
  doc: string;
  onChangeDoc?: (next: string) => void; // omit for read-only (preview / reading)
  onViewRaw?: () => void;                // escape hatch to raw/source editing
  tagSuggestions?: string[];
  onTagClick?: (tag: string) => void;
  removeEmpty?: boolean;                 // setting: strip block when empty
  defaultCollapsed?: boolean;            // collapse state is editor UI state, not saved to the file
  hideWhenEmpty?: boolean;               // setting: no panel when no frontmatter
}

const TYPE_ICON: Record<PropertyType, typeof Type> = {
  text: Type, multiline: Type, number: Hash, boolean: ToggleLeft,
  date: Calendar, datetime: Calendar, tags: Tag, aliases: Tag,
  list: ListTree, link: Type, unknown: Code2,
};

// Suggested property names for the add control (users are not restricted to these).
const SUGGESTED = ['tags', 'aliases', 'status', 'due', 'priority', 'created', 'updated', 'completed'];

export default function DocumentProperties(props: DocumentPropertiesProps) {
  const { doc, onChangeDoc, onViewRaw, tagSuggestions = [], onTagClick, removeEmpty = true, defaultCollapsed = false, hideWhenEmpty = false } = props;
  const parsed = useMemo(() => parseFrontmatter(doc), [doc]);
  const readOnly = !onChangeDoc;
  const [adding, setAdding] = useState(false);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const props_ = parsed.properties;

  const commit = (entries: FrontmatterEntry[]) => {
    if (!onChangeDoc) return;
    onChangeDoc(serializeFrontmatter(doc, entries, { removeEmpty }));
  };

  const asEntries = (): FrontmatterEntry[] => props_.map((p) => ({ key: p.key, value: p.value }));

  const setValue = (key: string, value: unknown) => commit(asEntries().map((e) => (e.key === key ? { ...e, value } : e)));
  const deleteKey = (key: string) => commit(asEntries().filter((e) => e.key !== key));
  const renameKey = (oldKey: string, newKey: string) => {
    if (!newKey || newKey === oldKey) return;
    if (props_.some((p) => p.key === newKey)) return; // reject duplicate
    commit(asEntries().map((e) => (e.key === oldKey ? { key: newKey, value: e.value } : e)));
  };
  const move = (key: string, dir: -1 | 1) => {
    const entries = asEntries();
    const i = entries.findIndex((e) => e.key === key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= entries.length) return;
    [entries[i], entries[j]] = [entries[j], entries[i]];
    commit(entries);
  };
  const addProperty = (key: string, type: PropertyType) => {
    if (!key || props_.some((p) => p.key === key)) { setAdding(false); return; }
    const initial = defaultValueForType(type);
    commit([...asEntries(), { key, value: initial }]);
    setAdding(false);
  };

  // --- Empty / invalid states ------------------------------------------------
  if (!parsed.hasFrontmatter && (hideWhenEmpty || readOnly)) {
    // Reading/preview with no frontmatter: render nothing. Live mode shows the
    // minimal "Add property" affordance below instead.
    if (readOnly || hideWhenEmpty) return null;
  }

  if (parsed.hasFrontmatter && !parsed.valid) {
    return (
      <section className="doc-props mx-auto mt-2 w-full rounded-md border border-[var(--danger)] bg-[var(--danger-surface)]" aria-label="Document properties (error)">
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-[var(--danger)]">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <span className="font-medium">Properties can’t be shown — the frontmatter YAML is invalid.</span>
          {onViewRaw && (
            <button className="interactive ml-auto rounded px-2 py-0.5 font-medium underline underline-offset-2 hover:bg-[var(--surface-hover)]" onClick={onViewRaw}>
              Edit as YAML
            </button>
          )}
        </div>
        {parsed.diagnostics[0] && <p className="px-3 pb-2 text-[11px] text-[var(--danger)]">{parsed.diagnostics[0].message}</p>}
      </section>
    );
  }

  const count = props_.length;
  const showCollapse = count > 0;

  return (
    <section className="doc-props mx-auto w-full rounded-md border border-[var(--divider)] bg-[var(--surface)]" aria-label="Document properties">
      <header className="flex items-center gap-1.5 px-2.5 py-1.5">
        <button
          type="button"
          className="interactive flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)] hover:text-[var(--ink)]"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((c) => !c)}
          disabled={!showCollapse}
        >
          {showCollapse && <ChevronRight className={`h-3.5 w-3.5 transition-transform ${collapsed ? '' : 'rotate-90'}`} aria-hidden />}
          <ListTree className="h-3.5 w-3.5" aria-hidden />
          <span>Properties{count ? ` · ${count}` : ''}</span>
        </button>
        {!readOnly && (
          <div className="ml-auto flex items-center gap-0.5">
            <button type="button" aria-label="Add property" title="Add property" className="interactive grid h-6 w-6 place-items-center rounded text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]" onClick={() => setAdding(true)}>
              <Plus className="h-3.5 w-3.5" />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="Properties actions" className="interactive grid h-6 w-6 place-items-center rounded text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setAdding(true)}><Plus className="mr-2 h-4 w-4" /> Add property</DropdownMenuItem>
                {onViewRaw && <><DropdownMenuSeparator /><DropdownMenuItem onSelect={onViewRaw}><Code2 className="mr-2 h-4 w-4" /> Edit as YAML</DropdownMenuItem></>}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </header>

      {!collapsed && (
        <div className="border-t border-[var(--divider)]">
          {props_.map((p, i) => (
            <PropertyRow
              key={p.key}
              property={p}
              readOnly={readOnly}
              isFirst={i === 0}
              isLast={i === count - 1}
              tagSuggestions={tagSuggestions}
              onTagClick={onTagClick}
              onValue={(v) => setValue(p.key, v)}
              onRename={(nk) => renameKey(p.key, nk)}
              onDelete={() => deleteKey(p.key)}
              onMove={(d) => move(p.key, d)}
              onViewRaw={onViewRaw}
            />
          ))}
          {!readOnly && (adding ? (
            <AddPropertyRow existing={props_.map((p) => p.key)} onAdd={addProperty} onCancel={() => setAdding(false)} />
          ) : count === 0 ? (
            <button type="button" className="interactive flex w-full items-center gap-2 px-3 py-2 text-xs text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]" onClick={() => setAdding(true)}>
              <Plus className="h-3.5 w-3.5" /> Add property
            </button>
          ) : null)}
        </div>
      )}
    </section>
  );
}

function defaultValueForType(type: PropertyType): unknown {
  switch (type) {
    case 'number': return 0;
    case 'boolean': return false;
    case 'tags': case 'aliases': case 'list': return [];
    case 'date': return new Date().toISOString().slice(0, 10);
    default: return '';
  }
}

// ---------------------------------------------------------------------------

interface RowProps {
  property: DocumentProperty;
  readOnly: boolean;
  isFirst: boolean;
  isLast: boolean;
  tagSuggestions: string[];
  onTagClick?: (tag: string) => void;
  onValue: (v: unknown) => void;
  onRename: (newKey: string) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  onViewRaw?: () => void;
}

function PropertyRow(p: RowProps) {
  const { property, readOnly } = p;
  const Icon = TYPE_ICON[property.type];
  const [editingKey, setEditingKey] = useState(false);
  const [draftKey, setDraftKey] = useState(property.key);
  useEffect(() => setDraftKey(property.key), [property.key]);
  const inputId = `prop-${property.key}`;

  return (
    <div className="group flex items-start gap-2 border-t border-[var(--divider)] px-3 py-1.5 first:border-t-0 hover:bg-[var(--surface-hover)]">
      <div className="flex w-40 shrink-0 items-center gap-1.5 pt-1.5 text-xs text-[var(--ink-secondary)]">
        <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--ink-muted)]" aria-hidden />
        {editingKey && !readOnly ? (
          <input
            autoFocus
            className="w-full rounded border border-[var(--accent)] bg-[var(--canvas)] px-1 py-0.5 text-xs text-[var(--ink)] outline-none"
            value={draftKey}
            aria-label="Property name"
            onChange={(e) => setDraftKey(e.target.value)}
            onBlur={() => { setEditingKey(false); p.onRename(draftKey.trim()); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setDraftKey(property.key); setEditingKey(false); } }}
          />
        ) : (
          <button
            type="button"
            className="interactive truncate text-left hover:text-[var(--ink)] disabled:cursor-default"
            title={readOnly ? property.label : 'Rename property'}
            disabled={readOnly}
            onClick={() => setEditingKey(true)}
          >
            {property.label}
          </button>
        )}
      </div>

      <div className="min-w-0 flex-1 py-0.5">
        <PropertyValueEditor property={property} readOnly={readOnly} inputId={inputId} tagSuggestions={p.tagSuggestions} onTagClick={p.onTagClick} onValue={p.onValue} onViewRaw={p.onViewRaw} />
      </div>

      {!readOnly && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={`Actions for ${property.label}`} className="interactive mt-1 grid h-6 w-6 shrink-0 place-items-center rounded text-[var(--ink-muted)] opacity-0 hover:bg-[var(--surface)] hover:text-[var(--ink)] focus-visible:opacity-100 group-hover:opacity-100">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={p.isFirst} onSelect={() => p.onMove(-1)}>Move up</DropdownMenuItem>
            <DropdownMenuItem disabled={p.isLast} onSelect={() => p.onMove(1)}>Move down</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setEditingKey(true)}>Rename</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={p.onDelete} className="text-[var(--danger)] focus:text-[var(--danger)]">Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface ValueProps {
  property: DocumentProperty;
  readOnly: boolean;
  inputId: string;
  tagSuggestions: string[];
  onTagClick?: (tag: string) => void;
  onValue: (v: unknown) => void;
  onViewRaw?: () => void;
}

const INPUT_CLS = 'w-full rounded border border-[var(--divider)] bg-[var(--canvas)] px-2 py-1 text-xs text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:shadow-[0_0_0_1px_var(--accent)]';

function PropertyValueEditor({ property, readOnly, inputId, tagSuggestions, onTagClick, onValue, onViewRaw }: ValueProps) {
  const { type, value } = property;

  if (type === 'unknown' || !property.editable) {
    return (
      <div className="flex items-start gap-2">
        <pre className="min-w-0 flex-1 overflow-x-auto rounded border border-[var(--divider)] bg-[var(--canvas)] px-2 py-1 font-mono text-[11px] text-[var(--ink-secondary)]">{formatUnknown(value)}</pre>
        {!readOnly && onViewRaw && <button type="button" className="interactive shrink-0 rounded px-1.5 py-1 text-[11px] text-[var(--ink-muted)] hover:text-[var(--ink)]" onClick={onViewRaw}>Edit as YAML</button>}
      </div>
    );
  }

  if (type === 'boolean') {
    return (
      <label className="flex items-center gap-2 py-1 text-xs text-[var(--ink-secondary)]">
        <input id={inputId} type="checkbox" className="task-checkbox" checked={!!value} disabled={readOnly} onChange={(e) => onValue(e.target.checked)} aria-label={property.label} />
        <span>{value ? 'Yes' : 'No'}</span>
      </label>
    );
  }

  if (type === 'tags' || type === 'aliases' || type === 'list') {
    return <ChipEditor id={inputId} values={Array.isArray(value) ? (value as string[]) : []} readOnly={readOnly} suggestions={type === 'tags' ? tagSuggestions : []} onTagClick={type === 'tags' ? onTagClick : undefined} onChange={onValue} label={property.label} />;
  }

  if (type === 'number') {
    return <NumberEditor id={inputId} value={typeof value === 'number' ? value : Number(value) || 0} readOnly={readOnly} onChange={onValue} label={property.label} />;
  }

  if (type === 'date') {
    const dateStr = typeof value === 'string' ? value : '';
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
    if (valid || !dateStr) {
      return <input id={inputId} type="date" className={INPUT_CLS} value={dateStr} disabled={readOnly} aria-label={property.label} onChange={(e) => onValue(e.target.value)} />;
    }
    // Non-ISO date value: fall back to text so we never mangle it.
    return <TextEditor id={inputId} value={dateStr} readOnly={readOnly} onChange={onValue} label={property.label} />;
  }

  if (type === 'multiline') {
    return <MultilineEditor id={inputId} value={String(value ?? '')} readOnly={readOnly} onChange={onValue} label={property.label} />;
  }

  // text + link
  return <TextEditor id={inputId} value={String(value ?? '')} readOnly={readOnly} onChange={onValue} label={property.label} />;
}

function formatUnknown(value: unknown): string {
  if (value === null) return 'null';
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

// Text: local draft, commit on blur / Enter (avoids caret jumps + churn).
function TextEditor({ id, value, readOnly, onChange, label }: { id: string; value: string; readOnly: boolean; onChange: (v: string) => void; label: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      id={id}
      className={INPUT_CLS}
      value={draft}
      disabled={readOnly}
      aria-label={label}
      placeholder="Empty"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onChange(draft)}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}

function MultilineEditor({ id, value, readOnly, onChange, label }: { id: string; value: string; readOnly: boolean; onChange: (v: string) => void; label: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <textarea
      id={id}
      rows={Math.min(8, Math.max(2, draft.split('\n').length))}
      className={`${INPUT_CLS} resize-y font-sans leading-5`}
      value={draft}
      disabled={readOnly}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onChange(draft)}
    />
  );
}

function NumberEditor({ id, value, readOnly, onChange, label }: { id: string; value: number; readOnly: boolean; onChange: (v: number) => void; label: string }) {
  // Keep a string draft so partial input ("1.", "-") doesn't get coerced away.
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      className={INPUT_CLS}
      value={draft}
      disabled={readOnly}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { const n = Number(draft); if (draft.trim() !== '' && Number.isFinite(n) && n !== value) onChange(n); else setDraft(String(value)); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}

function ChipEditor({ id, values, readOnly, suggestions, onTagClick, onChange, label }: { id: string; values: string[]; readOnly: boolean; suggestions: string[]; onTagClick?: (t: string) => void; onChange: (v: string[]) => void; label: string }) {
  const [draft, setDraft] = useState('');
  const listId = `${id}-suggest`;
  const add = (raw: string) => {
    const v = raw.trim();
    if (!v || values.includes(v)) { setDraft(''); return; }
    onChange([...values, v]);
    setDraft('');
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {values.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded border border-[var(--divider)] bg-[var(--canvas)] px-1.5 py-0.5 text-[11px] text-[var(--ink-secondary)]">
          {onTagClick ? (
            <button type="button" className="interactive hover:text-[var(--accent-strong)]" onClick={() => onTagClick(v)} title={`Search #${v}`}>{v}</button>
          ) : <span>{v}</span>}
          {!readOnly && (
            <button type="button" aria-label={`Remove ${v}`} className="interactive text-[var(--ink-muted)] hover:text-[var(--danger)]" onClick={() => onChange(values.filter((x) => x !== v))}>
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}
      {!readOnly && (
        <>
          <input
            id={id}
            list={suggestions.length ? listId : undefined}
            className="min-w-[6rem] flex-1 bg-transparent px-1 py-0.5 text-xs text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)]"
            value={draft}
            aria-label={`Add to ${label}`}
            placeholder={values.length ? 'Add…' : 'Add value…'}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(draft); }
              else if (e.key === 'Backspace' && !draft && values.length) onChange(values.slice(0, -1));
            }}
            onBlur={() => add(draft)}
          />
          {suggestions.length > 0 && (
            <datalist id={listId}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
          )}
        </>
      )}
    </div>
  );
}

function AddPropertyRow({ existing, onAdd, onCancel }: { existing: string[]; onAdd: (key: string, type: PropertyType) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<PropertyType>('text');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const duplicate = existing.includes(name.trim());
  const invalid = name.trim() === '' || duplicate;
  const submit = () => { if (!invalid) onAdd(name.trim(), type); };
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-[var(--divider)] bg-[var(--surface-hover)] px-3 py-2">
      <input
        ref={ref}
        list="prop-name-suggest"
        className={`${INPUT_CLS} w-40`}
        placeholder="Property name"
        aria-label="New property name"
        aria-invalid={duplicate}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel(); }}
      />
      <datalist id="prop-name-suggest">{SUGGESTED.filter((s) => !existing.includes(s)).map((s) => <option key={s} value={s} />)}</datalist>
      <select className={`${INPUT_CLS} w-32`} aria-label="Property type" value={type} onChange={(e) => setType(e.target.value as PropertyType)}>
        <option value="text">Text</option>
        <option value="multiline">Long text</option>
        <option value="number">Number</option>
        <option value="boolean">Checkbox</option>
        <option value="date">Date</option>
        <option value="tags">Tags</option>
        <option value="list">List</option>
      </select>
      <button type="button" className="interactive rounded bg-[var(--accent)] px-2.5 py-1 text-xs font-semibold text-[var(--canvas)] disabled:opacity-50" disabled={invalid} onClick={submit}>Add</button>
      <button type="button" className="interactive rounded px-2 py-1 text-xs text-[var(--ink-muted)] hover:text-[var(--ink)]" onClick={onCancel}>Cancel</button>
      {duplicate && <span role="alert" className="w-full text-[11px] text-[var(--danger)]">A property named “{name.trim()}” already exists.</span>}
    </div>
  );
}
