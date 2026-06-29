import { useEffect, useRef, useState } from 'react';
import { Play, Plus, Trash2, Zap } from 'lucide-react';

interface Automation {
  id: string;
  name: string;
  commands: string[];
}

interface LogLine {
  type: 'cmd' | 'out' | 'err';
  text: string;
}

const STORE_KEY = 'automations';

/**
 * Named command sequences run one-shot in the active repo (via terminal:run).
 * For interactive work use the PTY terminal; automations are for scripted steps.
 */
export default function Automations() {
  const [items, setItems] = useState<Automation[]>([]);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [log, setLog] = useState<LogLine[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void window.electronAPI?.settings.get<Automation[]>(STORE_KEY).then((saved) => {
      if (Array.isArray(saved)) setItems(saved);
    });
  }, []);

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [log]);

  const persist = async (next: Automation[]) => {
    setItems(next);
    await window.electronAPI?.settings.set(STORE_KEY, next);
  };

  const add = () => {
    const commands = body.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!name.trim() || commands.length === 0) return;
    void persist([...items, { id: `${Date.now()}`, name: name.trim(), commands }]);
    setName('');
    setBody('');
  };

  const remove = (id: string) => void persist(items.filter((a) => a.id !== id));

  const run = async (automation: Automation) => {
    if (running || !window.electronAPI) return;
    setRunning(automation.id);
    setLog([{ type: 'cmd', text: `▶ ${automation.name}` }]);
    for (const cmd of automation.commands) {
      setLog((prev) => [...prev, { type: 'cmd', text: `$ ${cmd}` }]);
      const result = await window.electronAPI.terminal.run(cmd);
      if (result.stdout) setLog((prev) => [...prev, { type: 'out', text: result.stdout.trimEnd() }]);
      if (result.stderr) setLog((prev) => [...prev, { type: 'err', text: result.stderr.trimEnd() }]);
      if (!result.success && !result.stderr) setLog((prev) => [...prev, { type: 'err', text: `exit code ${result.code}` }]);
    }
    setLog((prev) => [...prev, { type: 'cmd', text: '✓ done' }]);
    setRunning(null);
  };

  return (
    <div className="nav-surface flex h-full flex-col font-sans">
      <header className="pane-header flex items-center gap-2 border-b px-3 text-accent">
        <Zap className="h-4 w-4" />
        <span className="text-xs font-medium text-primary">Automations</span>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* List + editor */}
        <div className="flex w-1/2 flex-col border-r divider-color">
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {items.length === 0 && <p className="px-2 py-4 text-center text-xs text-[var(--ink-muted)]">No automations yet. Add one below.</p>}
            {items.map((a) => (
              <div key={a.id} className="note-row group mb-1 flex items-center gap-2 rounded-md px-2 py-1.5">
                <button disabled={!!running} onClick={() => run(a)} className="interactive grid h-7 w-7 place-items-center rounded text-[var(--accent-strong)] hover:bg-[var(--surface-hover)] disabled:opacity-40" title={`Run ${a.name}`} aria-label={`Run ${a.name}`}>
                  <Play className="h-3.5 w-3.5" />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-[var(--ink)]">{a.name}</div>
                  <div className="truncate font-mono text-[10px] text-[var(--ink-muted)]">{a.commands.join(' · ')}</div>
                </div>
                <button onClick={() => remove(a.id)} className="interactive grid h-7 w-7 place-items-center rounded text-[var(--ink-muted)] opacity-0 hover:text-[var(--danger)] group-hover:opacity-100" title="Delete" aria-label={`Delete ${a.name}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="border-t divider-color p-2">
            <input className="field mb-1.5 py-1.5 text-xs" placeholder="Automation name" value={name} onChange={(e) => setName(e.target.value)} />
            <textarea className="field mb-1.5 h-20 resize-none py-1.5 font-mono text-[11px]" placeholder="One command per line, e.g.&#10;npm run build&#10;git status" value={body} onChange={(e) => setBody(e.target.value)} />
            <button onClick={add} className="interactive flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] py-1.5 text-xs font-semibold text-[var(--canvas)]">
              <Plus className="h-3.5 w-3.5" /> Add automation
            </button>
          </div>
        </div>

        {/* Output log */}
        <div ref={logRef} className="w-1/2 overflow-y-auto bg-[var(--canvas)] p-2 font-mono text-[11px]">
          {log.length === 0 && <p className="px-2 py-4 text-center text-[var(--ink-muted)]">Run an automation to see output.</p>}
          {log.map((line, i) => (
            <div key={i} className={`whitespace-pre-wrap break-all ${line.type === 'cmd' ? 'font-bold text-[var(--ink)]' : line.type === 'err' ? 'text-[var(--danger)]' : 'text-[var(--ink-secondary)]'}`}>{line.text}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
