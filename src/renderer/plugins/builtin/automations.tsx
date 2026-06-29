import { Zap } from 'lucide-react';
import type { PluginModule } from '../types';
import Automations from '../../components/Automations';

const automations: PluginModule = {
  manifest: {
    id: 'automations',
    name: 'Automations',
    version: '1.0.0',
    author: 'Neuron',
    description: 'Save and run named command sequences in the active workspace.',
    category: 'integration',
  },
  activate(host) {
    host.registerPanel({
      id: 'automations.panel',
      title: 'Automations',
      icon: Zap,
      location: 'bottom',
      render: () => <Automations />,
    });
  },
};

export default automations;
