import { Sparkles } from 'lucide-react';
import type { PluginModule } from '../types';
import AssistantPanel from './AssistantPanel';

const aiOpenrouter: PluginModule = {
  manifest: {
    id: 'ai-openrouter',
    name: 'OpenRouter Assistant',
    version: '1.0.0',
    author: 'Neuron',
    description: 'Chat with any model hosted on OpenRouter about the note you are editing.',
    category: 'ai',
    configSchema: [
      { key: 'apiKey', label: 'OpenRouter API key', type: 'password', placeholder: 'sk-or-…', description: 'Stored locally in app settings; used only for your requests.' },
      { key: 'model', label: 'Model', type: 'text', placeholder: 'google/gemini-2.5-flash', description: 'Optional. Defaults to google/gemini-2.5-flash.' },
    ],
  },
  activate(host) {
    host.registerPanel({
      id: 'ai-openrouter.assistant',
      title: 'OpenRouter',
      icon: Sparkles,
      render: (runtime) => (
        <AssistantPanel
          host={runtime}
          provider="openrouter"
          defaultModel="google/gemini-2.5-flash"
          emptyHint="Ask OpenRouter models to summarize, rewrite, or expand the note you have open. Add your API key in plugin settings first."
        />
      ),
    });
  },
};

export default aiOpenrouter;
