import { contextBridge, ipcRenderer } from 'electron';

interface RepositoryInfo { path: string; name: string; cloud: boolean }
interface AiMessage { role: 'user' | 'assistant'; content: string }

contextBridge.exposeInMainWorld('electronAPI', {
  // Notes
  listNotes: () => ipcRenderer.invoke('notes:list'),
  readNote: (relativePath: string) => ipcRenderer.invoke('notes:read', relativePath),
  writeNote: (relativePath: string, content: string) => ipcRenderer.invoke('notes:write', relativePath, content),
  deleteNote: (relativePath: string) => ipcRenderer.invoke('notes:delete', relativePath),
  createSection: (relativePath: string) => ipcRenderer.invoke('notes:create-section', relativePath),
  getNotesDirectory: () => ipcRenderer.invoke('notes:get-dir'),
  logError: (errorData: { phase: string; error_message: string; stack_trace: string; remediation_step: string }) =>
    ipcRenderer.invoke('notes:log-error', errorData),
  onNotesChanged: (callback: (event: 'add' | 'change' | 'unlink', path: string) => void) => {
    const listener = (_event: unknown, type: 'add' | 'change' | 'unlink', path: string) => callback(type, path);
    ipcRenderer.on('notes:changed', listener);
    return () => ipcRenderer.removeListener('notes:changed', listener);
  },

  // Repository
  repository: {
    getCurrent: () => ipcRenderer.invoke('repository:get-current'),
    listRecent: () => ipcRenderer.invoke('repository:list-recent'),
    create: () => ipcRenderer.invoke('repository:create'),
    open: () => ipcRenderer.invoke('repository:open'),
    switch: (dir: string) => ipcRenderer.invoke('repository:switch', dir),
    setName: (dir: string, name: string) => ipcRenderer.invoke('repository:set-name', dir, name),
    remove: (dir: string) => ipcRenderer.invoke('repository:remove', dir),
    reveal: (dir: string) => ipcRenderer.invoke('repository:reveal', dir),
    onChanged: (callback: (repo: RepositoryInfo) => void) => {
      const listener = (_event: unknown, repo: RepositoryInfo) => callback(repo);
      ipcRenderer.on('repository:changed', listener);
      return () => ipcRenderer.removeListener('repository:changed', listener);
    },
  },

  // Window controls
  windowControls: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizedChanged: (callback: (maximized: boolean) => void) => {
      const listener = (_event: unknown, maximized: boolean) => callback(maximized);
      ipcRenderer.on('window:maximized-changed', listener);
      return () => ipcRenderer.removeListener('window:maximized-changed', listener);
    },
  },

  // Settings (generic key/value for plugin config + state)
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
  },

  // Privileged plugin capabilities
  ai: {
    complete: (request: { provider: string; model?: string; system?: string; messages: AiMessage[]; config?: Record<string, string> }) =>
      ipcRenderer.invoke('ai:complete', request),
  },
  net: {
    request: (req: { url: string; method?: string; headers?: Record<string, string>; body?: string }) =>
      ipcRenderer.invoke('plugin:net-request', req),
  },
  terminal: {
    run: (cmd: string) => ipcRenderer.invoke('terminal:run', cmd),
    spawn: (opts: { cols?: number; rows?: number }) => ipcRenderer.invoke('terminal:spawn', opts),
    write: (id: number, data: string) => ipcRenderer.invoke('terminal:write', id, data),
    resize: (id: number, cols: number, rows: number) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
    kill: (id: number) => ipcRenderer.invoke('terminal:kill', id),
    onData: (callback: (id: number, data: string) => void) => {
      const listener = (_event: unknown, id: number, data: string) => callback(id, data);
      ipcRenderer.on('terminal:data', listener);
      return () => ipcRenderer.removeListener('terminal:data', listener);
    },
    onExit: (callback: (id: number, exitCode: number) => void) => {
      const listener = (_event: unknown, id: number, exitCode: number) => callback(id, exitCode);
      ipcRenderer.on('terminal:exit', listener);
      return () => ipcRenderer.removeListener('terminal:exit', listener);
    },
  },
  views: {
    source: (request: { type: string; glob?: string; limit?: number }) => ipcRenderer.invoke('views:source', request),
    action: (action: { type: string; path?: string; content?: string }) => ipcRenderer.invoke('views:action', action),
    csv: (relativePath: string) => ipcRenderer.invoke('views:csv', relativePath),
    file: (relativePath: string) => ipcRenderer.invoke('views:file', relativePath),
  },
  cookies: {
    importChrome: (domain?: string) => ipcRenderer.invoke('cookies:import-chrome', domain),
  },
});
