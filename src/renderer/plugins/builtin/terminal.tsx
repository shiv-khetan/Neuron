import { TerminalSquare } from 'lucide-react';
import type { PluginModule } from '../types';
import XtermTerminal from '../../components/XtermTerminal';

const terminal: PluginModule = {
  manifest: {
    id: 'terminal',
    name: 'Workspace Terminal',
    version: '2.0.0',
    author: 'Neuron',
    description: 'Full interactive shell (PTY) for workspace-aware command-line work.',
    category: 'integration',
  },
  activate(host) {
    host.registerPanel({
      id: 'terminal.panel',
      title: 'Terminal',
      icon: TerminalSquare,
      location: 'bottom',
      render: () => <XtermTerminal />,
    });
  },
};

export default terminal;
