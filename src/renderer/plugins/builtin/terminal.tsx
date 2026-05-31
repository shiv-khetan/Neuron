import { useEffect, useRef, useState } from 'react';
import { TerminalSquare, Trash2 } from 'lucide-react';
import type { HostRuntime, PluginModule } from '../types';
import { Button } from '../../components/ui/button';
import { ScrollArea } from '../../components/ui/scroll-area';

interface TerminalLine {
  type: 'input' | 'output' | 'error' | 'info';
  text: string;
}

function TerminalPanel({ host }: { host: HostRuntime }) {
  const [lines, setLines] = useState<TerminalLine[]>([
    { type: 'info', text: 'Neuron Integrated Terminal' },
    { type: 'info', text: 'Type "help" for a list of built-in commands or run any shell command.' },
  ]);
  const [input, setInput] = useState('');
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [executing, setExecuting] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll terminal on new output
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [lines]);

  // Load command history from local storage on mount
  useEffect(() => {
    void host.storage.get<string[]>('cmd_history').then((saved) => {
      if (saved && Array.isArray(saved)) {
        setCmdHistory(saved);
      }
    });
  }, [host]);

  const saveHistory = async (newHistory: string[]) => {
    setCmdHistory(newHistory);
    await host.storage.set('cmd_history', newHistory);
  };

  const handleRunCommand = async () => {
    const trimmedCmd = input.trim();
    if (!trimmedCmd || executing) return;

    setExecuting(true);
    const nextLines = [...lines, { type: 'input' as const, text: trimmedCmd }];
    setLines(nextLines);
    setInput('');
    setHistoryIndex(-1);

    // Save history
    const updatedHistory = [trimmedCmd, ...cmdHistory.filter((c) => c !== trimmedCmd)].slice(0, 50);
    void saveHistory(updatedHistory);

    if (trimmedCmd.toLowerCase() === 'clear' || trimmedCmd.toLowerCase() === 'cls') {
      setLines([]);
      setExecuting(false);
      return;
    }

    if (trimmedCmd.toLowerCase() === 'help') {
      setLines((prev) => [
        ...prev,
        { type: 'info', text: 'Built-in commands:' },
        { type: 'info', text: '  help       Display this help list' },
        { type: 'info', text: '  clear      Clear the terminal log' },
        { type: 'info', text: '  notes      List all notes in the active repository' },
        { type: 'info', text: 'Any other input is run as a system command in the active repository root.' },
      ]);
      setExecuting(false);
      return;
    }

    if (trimmedCmd.toLowerCase() === 'notes') {
      setLines((prev) => [
        ...prev,
        { type: 'info', text: `Notes in workspace (${host.notes.length} total):` },
        ...host.notes.map((note) => ({ type: 'output' as const, text: `  - ${note}` })),
      ]);
      setExecuting(false);
      return;
    }

    try {
      // Run shell command via IPC
      const result = await host.terminal.run(trimmedCmd);
      const outputLines: TerminalLine[] = [];

      if (result.stdout) {
        outputLines.push({ type: 'output', text: result.stdout });
      }
      if (result.stderr) {
        outputLines.push({ type: 'error', text: result.stderr });
      }
      if (!result.success && !result.stderr) {
        outputLines.push({ type: 'error', text: `Command failed with exit code ${result.code}` });
      }

      setLines((prev) => [...prev, ...outputLines]);
    } catch (err: any) {
      setLines((prev) => [
        ...prev,
        { type: 'error', text: `Execution failed: ${err.message || String(err)}` },
      ]);
    } finally {
      setExecuting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      void handleRunCommand();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (cmdHistory.length === 0) return;
      const nextIndex = historyIndex + 1;
      if (nextIndex < cmdHistory.length) {
        setHistoryIndex(nextIndex);
        setInput(cmdHistory[nextIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = historyIndex - 1;
      if (nextIndex >= 0) {
        setHistoryIndex(nextIndex);
        setInput(cmdHistory[nextIndex]);
      } else {
        setHistoryIndex(-1);
        setInput('');
      }
    }
  };

  const focusInput = () => {
    inputRef.current?.focus();
  };

  const clearLog = () => {
    setLines([]);
    focusInput();
  };

  return (
    <div className="flex h-full flex-col font-mono text-[13px] bg-[var(--nav)] text-[var(--ink-secondary)]">
      {/* Header toolbar */}
      <div className="flex items-center justify-between border-b border-[var(--divider)] px-3 py-1.5 shrink-0 bg-[var(--canvas)]">
        <div className="flex items-center gap-1.5 text-xs text-[var(--ink-muted)]">
          <TerminalSquare className="h-3.5 w-3.5" />
          <span>sh</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-[var(--ink-muted)] hover:text-[var(--ink)]"
            onClick={clearLog}
            title="Clear Terminal log"
            aria-label="Clear Terminal log"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Main Terminal scroll area */}
      <ScrollArea className="min-h-0 flex-1 cursor-text" onClick={focusInput}>
        <div ref={containerRef} className="flex flex-col gap-1 p-3 min-h-full overflow-y-auto">
          {lines.map((line, index) => {
            if (line.type === 'input') {
              return (
                <div key={index} className="flex items-start gap-1.5 font-bold text-[var(--ink)]">
                  <span className="text-[var(--accent)] font-mono">$</span>
                  <span className="whitespace-pre-wrap break-all">{line.text}</span>
                </div>
              );
            }
            if (line.type === 'error') {
              return (
                <div key={index} className="text-[var(--danger)] whitespace-pre-wrap break-all font-mono">
                  {line.text}
                </div>
              );
            }
            if (line.type === 'info') {
              return (
                <div key={index} className="text-[var(--ink-muted)] italic font-mono">
                  {line.text}
                </div>
              );
            }
            return (
              <div key={index} className="whitespace-pre-wrap break-all font-mono">
                {line.text}
              </div>
            );
          })}

          {executing && (
            <div className="flex items-center gap-1.5 text-[var(--ink-muted)]">
              <span className="animate-pulse">_</span>
              <span className="text-xs">Running...</span>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input row */}
      <div className="flex items-center border-t border-[var(--divider)] bg-[var(--canvas)] px-3 py-2 shrink-0">
        <span className="mr-2 text-[var(--accent)] font-bold shrink-0">$</span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Run commands..."
          disabled={executing}
          className="flex-1 bg-transparent text-[var(--ink)] border-0 outline-none p-0 font-mono shadow-none focus:outline-none focus:ring-0 focus:border-0"
        />
      </div>
    </div>
  );
}

const terminal: PluginModule = {
  manifest: {
    id: 'terminal',
    name: 'Workspace Terminal',
    version: '1.0.0',
    author: 'Neuron',
    description: 'Run terminal scripts and build tools directly inside your workspace.',
    category: 'integration',
  },
  activate(host) {
    host.registerPanel({
      id: 'terminal.panel',
      title: 'Terminal',
      icon: TerminalSquare,
      location: 'bottom',
      render: (runtime) => <TerminalPanel host={runtime} />,
    });
  },
};

export default terminal;
