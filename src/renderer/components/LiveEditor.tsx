import { useMemo, useRef, useEffect } from 'react';
import type { ReactNode } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { StateField } from '@codemirror/state';
import type { EditorState, Range } from '@codemirror/state';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { Badge, Callout, parseSemanticType, MarkdownTable, parseMarkdownTable } from './mdx-components';
import DocumentProperties from './properties/DocumentProperties';
import { parseFrontmatter } from '../lib/frontmatter';

interface LiveEditorProps {
  value: string;
  onChange: (value: string) => void;
  colorScheme?: 'dark' | 'light';
  tagSuggestions?: string[];
  onTagClick?: (tag: string) => void;
  onRequestRawMode?: () => void; // escape hatch: edit frontmatter as YAML
  removeEmptyFrontmatter?: boolean;
  defaultPropertiesCollapsed?: boolean;
}

// Config the frontmatter widget reads at render time. The live editor is a
// singleton in this app (only mounted for editorMode === 'live'), so a module
// holder is enough.
// ponytail: single-instance holder; move to a CM Facet if a second LiveEditor
// is ever mounted concurrently.
interface FmConfig {
  tagSuggestions: string[];
  onTagClick?: (tag: string) => void;
  onRequestRawMode?: () => void;
  removeEmpty: boolean;
  defaultCollapsed: boolean;
}
let fmConfig: FmConfig = { tagSuggestions: [], removeEmpty: true, defaultCollapsed: false };

// Replace ONLY the frontmatter block, leaving the body untouched so caret,
// selection and undo history in the body survive. `next` is the full document
// produced by the serializer (block + identical body).
function applyFrontmatter(view: EditorView, next: string) {
  const cur = view.state.doc.toString();
  if (next === cur) return;
  const parsed = parseFrontmatter(cur);
  const body = parsed.body;
  const newBlock = next.length >= body.length ? next.slice(0, next.length - body.length) : next;
  view.dispatch({ changes: { from: 0, to: parsed.bodyStart, insert: newBlock } });
}

class FrontmatterWidget extends WidgetType {
  private root: Root | null = null;
  private observer: ResizeObserver | null = null;
  constructor(private readonly raw: string) { super(); }
  // Re-render only when the frontmatter text changes; body edits (and collapse
  // toggles, which are React-internal) reuse the existing DOM so the panel
  // never remounts nor steals focus.
  eq(other: FrontmatterWidget) { return other.raw === this.raw; }
  toDOM(view: EditorView) {
    const wrap = document.createElement('div');
    wrap.className = 'cm-fm-widget';
    wrap.setAttribute('contenteditable', 'false');
    this.root = createRoot(wrap);
    this.root.render(
      <DocumentProperties
        doc={view.state.doc.toString()}
        onChangeDoc={(nextDoc) => applyFrontmatter(view, nextDoc)}
        onViewRaw={fmConfig.onRequestRawMode}
        tagSuggestions={fmConfig.tagSuggestions}
        onTagClick={fmConfig.onTagClick}
        removeEmpty={fmConfig.removeEmpty}
        defaultCollapsed={fmConfig.defaultCollapsed}
      />,
    );
    this.observer = new ResizeObserver(() => view.requestMeasure());
    this.observer.observe(wrap);
    queueMicrotask(() => view.requestMeasure());
    return wrap;
  }
  destroy() {
    this.observer?.disconnect();
    this.observer = null;
    const root = this.root;
    this.root = null;
    if (root) queueMicrotask(() => root.unmount());
  }
  ignoreEvent() { return true; } // form inputs handle their own events
}

// A CodeMirror widget that mounts a React component. The component is rendered
// purely as a decoration over the real document — the source text is untouched,
// so saving can never lose or rewrite the original Markdown/MDX.
class ReactWidget extends WidgetType {
  private root: Root | null = null;
  private observer: ResizeObserver | null = null;
  constructor(
    private readonly key: string,
    private readonly node: ReactNode,
    private readonly block: boolean,
    private readonly from: number,
    private readonly to: number,
  ) {
    super();
  }
  eq(other: ReactWidget) {
    return other.key === this.key && other.block === this.block && other.from === this.from && other.to === this.to;
  }
  toDOM(view: EditorView) {
    if (!this.block) {
      const span = document.createElement('span');
      span.className = 'cm-lp-widget cm-lp-widget-inline';
      span.setAttribute('contenteditable', 'false');
      this.root = createRoot(span);
      this.root.render(this.node);
      return span;
    }

    // Block widget: Notion-style wrapper. The left handle and the floating
    // toolbar are absolutely positioned so they don't change the measured
    // height, and the whole block is contenteditable=false so clicks on it
    // never steal the editor's text caret.
    const wrap = document.createElement('div');
    wrap.className = 'cm-lp-block';
    wrap.setAttribute('contenteditable', 'false');

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'cm-lp-block-handle';
    handle.title = 'Edit source';
    handle.setAttribute('aria-label', 'Edit block source');
    handle.textContent = '⋮⋮';
    handle.addEventListener('mousedown', (e) => { e.preventDefault(); this.editSource(view); });

    const toolbar = document.createElement('div');
    toolbar.className = 'cm-lp-block-toolbar';
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'cm-lp-block-action';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('mousedown', (e) => { e.preventDefault(); this.editSource(view); });
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'cm-lp-block-action danger';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('mousedown', (e) => { e.preventDefault(); this.deleteSource(view); });
    toolbar.append(editBtn, delBtn);

    const body = document.createElement('div');
    body.className = 'cm-lp-block-body';
    this.root = createRoot(body);
    this.root.render(this.node);

    wrap.append(handle, toolbar, body);

    // React content (and web-font loads) settle after toDOM returns, which
    // would otherwise leave CodeMirror's height map stale and offset every
    // click below the widget. Re-measure when the block's box actually changes.
    this.observer = new ResizeObserver(() => view.requestMeasure());
    this.observer.observe(wrap);
    queueMicrotask(() => view.requestMeasure());

    return wrap;
  }
  private editSource(view: EditorView) {
    view.dispatch({ selection: { anchor: this.from }, scrollIntoView: true });
    view.focus();
  }
  private deleteSource(view: EditorView) {
    const end = Math.min(view.state.doc.length, this.to + 1);
    view.dispatch({ changes: { from: this.from, to: end } });
    view.focus();
  }
  destroy() {
    this.observer?.disconnect();
    this.observer = null;
    const root = this.root;
    this.root = null;
    if (root) queueMicrotask(() => root.unmount());
  }
  ignoreEvent() {
    return true; // block handles its own clicks; editor caret is untouched
  }
}

class TaskCheckboxWidget extends WidgetType {
  constructor(
    private readonly from: number,
    private readonly to: number,
    private readonly checked: boolean,
  ) {
    super();
  }

  eq(other: TaskCheckboxWidget) {
    return other.from === this.from && other.to === this.to && other.checked === this.checked;
  }

  toDOM(view: EditorView) {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = this.checked;
    checkbox.className = 'task-checkbox cm-lp-task-checkbox';
    checkbox.setAttribute('aria-label', this.checked ? 'Mark task incomplete' : 'Mark task complete');
    checkbox.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({
        changes: {
          from: this.from,
          to: this.to,
          insert: this.checked ? '[ ]' : '[x]',
        },
      });
      view.focus();
    });
    return checkbox;
  }

  ignoreEvent() {
    return true;
  }
}

interface Occupied { from: number; to: number }

function overlaps(a: number, b: number, c: number, d: number) {
  return a <= d && c <= b;
}

// Computed from the full document + selection. Block decorations (the Callout /
// table widgets) MUST be provided from a StateField, not a ViewPlugin —
// CodeMirror forbids plugins from emitting decorations that change block layout.
function buildDecorations(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const occupied: Occupied[] = [];
  const doc = state.doc;
  const sel = state.selection.main;
  const text = doc.toString();
  const caretInside = (from: number, to: number) => sel.from <= to && sel.to >= from;
  const isOccupied = (from: number, to: number) => occupied.some((o) => overlaps(from, to, o.from, o.to));

  // --- Frontmatter: hide the raw YAML + delimiters, mount the properties panel.
  // Only when valid — invalid YAML stays visible so the user can fix it inline.
  const fm = parseFrontmatter(text);
  if (fm.hasFrontmatter && fm.valid && fm.bodyStart > 0) {
    occupied.push({ from: 0, to: fm.bodyStart });
    ranges.push(
      Decoration.replace({ widget: new FrontmatterWidget(fm.raw), block: true }).range(0, fm.bodyStart),
    );
  }

  // --- Fenced code blocks: treat as occupied (no live styling inside) ---------
  let inFence = false;
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    if (/^\s*```/.test(line.text)) {
      occupied.push({ from: line.from, to: line.to });
      inFence = !inFence;
    } else if (inFence) {
      occupied.push({ from: line.from, to: line.to });
    }
  }

  // --- Block component widgets (whole-doc scan) -------------------------------
  const blockComponent = (re: RegExp, make: (m: string) => ReactNode | null) => {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      const node = make(match[0]);
      const fromLine = doc.lineAt(start);
      const toLine = doc.lineAt(end);
      occupied.push({ from: fromLine.from, to: toLine.to });
      if (node && !caretInside(fromLine.from, toLine.to)) {
        ranges.push(
          Decoration.replace({ widget: new ReactWidget(match[0], node, true, fromLine.from, toLine.to), block: true }).range(fromLine.from, toLine.to),
        );
      }
    }
  };

  blockComponent(/<Callout\b[^>]*>[\s\S]*?<\/Callout>/g, (m) => {
    const type = parseSemanticType(m.match(/type="([^"]*)"/)?.[1]);
    const title = m.match(/title="([^"]*)"/)?.[1];
    const children = m.match(/>([\s\S]*?)<\/Callout>/)?.[1]?.trim() ?? '';
    return <Callout type={type} title={title}>{children}</Callout>;
  });

  // Inline Badge: replace just the tag span (single line → inline is fine).
  const badgeRe = /<Badge\b[^>]*\/>/g;
  let bm: RegExpExecArray | null;
  while ((bm = badgeRe.exec(text)) !== null) {
    const start = bm.index;
    const end = start + bm[0].length;
    if (isOccupied(start, end)) continue;
    occupied.push({ from: start, to: end });
    const t = bm[0].match(/text="([^"]*)"/);
    if (!t) continue;
    const node = <Badge text={t[1]} type={parseSemanticType(bm[0].match(/type="([^"]*)"/)?.[1])} />;
    if (!caretInside(start, end)) {
      ranges.push(Decoration.replace({ widget: new ReactWidget(bm[0], node, false, start, end) }).range(start, end));
    }
  }

  // --- Tables (block widget) --------------------------------------------------
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    if (isOccupied(line.from, line.to) || !line.text.includes('|')) continue;
    if (i + 1 > doc.lines) break;
    const region: string[] = [line.text];
    let last = i;
    for (let j = i + 1; j <= doc.lines; j++) {
      const l = doc.line(j);
      if (l.text.trim() === '' || !l.text.includes('|')) break;
      region.push(l.text);
      last = j;
    }
    const parsed = parseMarkdownTable(region);
    if (!parsed) continue;
    const fromPos = line.from;
    const toPos = doc.line(last).to;
    occupied.push({ from: fromPos, to: toPos });
    if (!caretInside(fromPos, toPos)) {
      ranges.push(
        Decoration.replace({
          widget: new ReactWidget(`table:${region.join('|')}`, <MarkdownTable {...parsed} />, true, fromPos, toPos),
          block: true,
        }).range(fromPos, toPos),
      );
    }
    i = last;
  }

  // --- Per-line live styling (whole doc) --------------------------------------
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    if (isOccupied(line.from, line.to)) continue;
    const caretOnLine = sel.from <= line.to && sel.to >= line.from;

    // CodeMirror's language theme colors nested syntax spans independently.
    // Mark prose lines so CSS can neutralize those colors while fenced code
    // keeps normal syntax highlighting.
    ranges.push(Decoration.line({ class: 'cm-lp-prose' }).range(line.from));

    // Task syntax supports standard `- [ ]` / `- [x]` plus the compact
    // `[]` form. Only the visible decoration changes; the document keeps
    // the original Markdown token until the user clicks the checkbox.
    const task = /^(\s*)(?:[-+*]\s+)?(\[(?: |x|X)?\])(?=\s|$)/.exec(line.text);
    if (task) {
      const from = line.from + task[1].length;
      const tokenOffset = task[0].lastIndexOf(task[2]);
      const tokenFrom = line.from + tokenOffset;
      const to = tokenFrom + task[2].length;
      const checked = /x/i.test(task[2]);
      if (!caretInside(from, to)) {
        ranges.push(
          Decoration.replace({ widget: new TaskCheckboxWidget(tokenFrom, to, checked) }).range(from, to),
        );
        occupied.push({ from, to });
      }
      if (checked && to < line.to) {
        ranges.push(Decoration.mark({ class: 'cm-lp-task-completed' }).range(to, line.to));
      }
    }

    const heading = /^(#{1,6})(\s+)(\S.*)$/.exec(line.text);
    if (heading) {
      ranges.push(Decoration.line({ class: `cm-lp-h${heading[1].length}` }).range(line.from));
      if (!caretOnLine) {
        ranges.push(Decoration.replace({}).range(line.from, line.from + heading[1].length + heading[2].length));
      }
      continue;
    }

    const quote = /^(>\s?)/.exec(line.text);
    if (quote) {
      ranges.push(Decoration.line({ class: 'cm-lp-quote' }).range(line.from));
      if (!caretOnLine) ranges.push(Decoration.replace({}).range(line.from, line.from + quote[1].length));
    }

    const inline = /(\*\*([^*\n]+)\*\*)|(__([^_\n]+)__)|(\*([^*\n]+)\*)|(`([^`\n]+)`)/g;
    let im: RegExpExecArray | null;
    while ((im = inline.exec(line.text)) !== null) {
      const mFrom = line.from + im.index;
      const mTo = mFrom + im[0].length;
      if (isOccupied(mFrom, mTo)) continue;
      const isBold = im[1] !== undefined || im[3] !== undefined;
      const isCode = im[7] !== undefined;
      const markerLen = isBold ? 2 : 1;
      const innerFrom = mFrom + markerLen;
      const innerTo = mTo - markerLen;
      const cls = isCode ? 'cm-lp-code' : isBold ? 'cm-lp-strong' : 'cm-lp-em';
      ranges.push(Decoration.mark({ class: cls }).range(innerFrom, innerTo));
      if (!caretInside(mFrom, mTo)) {
        ranges.push(Decoration.replace({}).range(mFrom, innerFrom));
        ranges.push(Decoration.replace({}).range(innerTo, mTo));
      }
    }

    const wikilink = /\[\[([^\]\n]+)\]\]/g;
    let wm: RegExpExecArray | null;
    while ((wm = wikilink.exec(line.text)) !== null) {
      const from = line.from + wm.index;
      const to = from + wm[0].length;
      if (isOccupied(from, to)) continue;
      ranges.push(Decoration.mark({ class: 'cm-lp-link' }).range(from + 2, to - 2));
      if (!caretInside(from, to)) {
        ranges.push(Decoration.replace({}).range(from, from + 2));
        ranges.push(Decoration.replace({}).range(to - 2, to));
      }
    }
  }

  return Decoration.set(ranges, true);
}

const liveEditorField = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(state);
  },
  update(deco, tr) {
    if (tr.docChanged || tr.selection) return buildDecorations(tr.state);
    return deco.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

export default function LiveEditor({ value, onChange, colorScheme = 'dark', tagSuggestions = [], onTagClick, onRequestRawMode, removeEmptyFrontmatter = true, defaultPropertiesCollapsed = false }: LiveEditorProps) {
  const editorRef = useRef<any>(null);

  // Keep the frontmatter widget's config current without re-creating editor
  // extensions (which would reset editor state).
  fmConfig = { tagSuggestions, onTagClick, onRequestRawMode, removeEmpty: removeEmptyFrontmatter, defaultCollapsed: defaultPropertiesCollapsed };

  const extensions = useMemo(
    () => [
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      EditorView.lineWrapping,
      liveEditorField,
    ],
    [],
  );

  useEffect(() => {
    const handleResize = () => {
      if (editorRef.current?.view) {
        try {
          editorRef.current.view.requestMeasure();
        } catch (e) {
          // view might be destroyed or not ready
        }
      }
    };
    window.addEventListener('resize', handleResize);

    // The Geist web font loads asynchronously and swaps in after CodeMirror's
    // first measure, changing line metrics that CM does not otherwise re-measure
    // — a small cumulative downward drift on regular text lines. Re-measure once
    // fonts are ready and whenever a font finishes loading.
    document.fonts?.ready.then(handleResize).catch(() => {});
    const onFontsDone = () => handleResize();
    document.fonts?.addEventListener('loadingdone', onFontsDone);

    let cleanup: (() => void) | undefined;
    if (window.electronAPI?.windowControls?.onMaximizedChanged) {
      cleanup = window.electronAPI.windowControls.onMaximizedChanged(() => {
        setTimeout(handleResize, 120); // wait for CSS transitions to settle
      });
    }
    return () => {
      window.removeEventListener('resize', handleResize);
      document.fonts?.removeEventListener('loadingdone', onFontsDone);
      if (cleanup) cleanup();
    };
  }, []);

  return (
    <div className="cm-live-editor h-full w-full overflow-hidden">
      <CodeMirror
        ref={editorRef}
        aria-label="Live editor"
        value={value}
        height="100%"
        theme={colorScheme}
        extensions={extensions}
        onChange={onChange}
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          history: true,
          drawSelection: true,
          bracketMatching: true,
          closeBrackets: true,
          indentOnInput: true,
          autocompletion: false,
          searchKeymap: true,
        }}
        className="h-full select-text"
      />
    </div>
  );
}
