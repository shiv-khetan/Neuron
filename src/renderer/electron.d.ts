export interface RepositoryInfo {
  path: string;
  name: string;
  cloud: boolean;
}

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiCompleteRequest {
  provider: string;
  model?: string;
  system?: string;
  messages: AiMessage[];
  config?: Record<string, string>;
}

export interface AiCompleteResult {
  success: boolean;
  text?: string;
  error?: string;
}

export interface NetRequestResult {
  success: boolean;
  status?: number;
  body?: string;
  error?: string;
}

export interface ViewSourceResult {
  success: boolean;
  count?: number;
  byExtension?: Record<string, number>;
  rows?: { path: string; extension: string; size: number; modified: string }[];
  error?: string;
}

export interface ViewCsvResult {
  success: boolean;
  columns?: string[];
  rows?: string[][];
  error?: string;
}

export interface ElectronAPI {
  // Notes
  listNotes: () => Promise<string[]>;
  readNote: (relativePath: string) => Promise<string>;
  writeNote: (relativePath: string, content: string) => Promise<{ success: boolean; error?: string }>;
  deleteNote: (relativePath: string) => Promise<{ success: boolean; error?: string }>;
  createSection: (relativePath: string) => Promise<{ success: boolean; error?: string }>;
  getNotesDirectory: () => Promise<string | null>;
  logError: (errorData: {
    phase: 'COMPILATION' | 'RUNTIME' | 'IPC';
    error_message: string;
    stack_trace: string;
    remediation_step: string;
  }) => Promise<{ success: boolean; error?: string }>;
  onNotesChanged: (callback: (event: 'add' | 'change' | 'unlink', path: string) => void) => () => void;

  // Repository
  repository: {
    getCurrent: () => Promise<RepositoryInfo | null>;
    listRecent: () => Promise<RepositoryInfo[]>;
    create: () => Promise<RepositoryInfo | null>;
    open: () => Promise<RepositoryInfo | null>;
    switch: (dir: string) => Promise<{ success: boolean; error?: string; repository?: RepositoryInfo }>;
    setName: (dir: string, name: string) => Promise<{ success: boolean; repository: RepositoryInfo }>;
    remove: (dir: string) => Promise<{ success: boolean; clearedActive: boolean }>;
    reveal: (dir: string) => Promise<{ success: boolean }>;
    onChanged: (callback: (repo: RepositoryInfo) => void) => () => void;
  };

  // Window controls
  windowControls: {
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<boolean>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    onMaximizedChanged: (callback: (maximized: boolean) => void) => () => void;
  };

  // Settings
  settings: {
    get: <T = unknown>(key: string) => Promise<T | null>;
    set: (key: string, value: unknown) => Promise<{ success: boolean }>;
  };

  // Privileged plugin capabilities
  ai: {
    complete: (request: AiCompleteRequest) => Promise<AiCompleteResult>;
  };
  net: {
    request: (req: { url: string; method?: string; headers?: Record<string, string>; body?: string }) => Promise<NetRequestResult>;
  };
  terminal: {
    run: (cmd: string) => Promise<{ success: boolean; stdout: string; stderr: string; code: number }>;
    /** Spawn an interactive PTY in the active repo; returns its id. */
    spawn: (opts: { cols?: number; rows?: number }) => Promise<number>;
    write: (id: number, data: string) => Promise<void>;
    resize: (id: number, cols: number, rows: number) => Promise<void>;
    kill: (id: number) => Promise<void>;
    onData: (callback: (id: number, data: string) => void) => () => void;
    onExit: (callback: (id: number, exitCode: number) => void) => () => void;
  };
  views: {
    source: (request: { type: string; glob?: string; limit?: number }) => Promise<ViewSourceResult>;
    action: (action: { type: string; path?: string; content?: string }) => Promise<{ success: boolean; stdout?: string; stderr?: string; code?: number; error?: string }>;
    csv: (relativePath: string) => Promise<ViewCsvResult>;
    file: (relativePath: string) => Promise<{ success: boolean; dataUrl?: string; error?: string }>;
  };
  cookies: {
    importChrome: (domain?: string) => Promise<{ success: boolean; imported?: number; skipped?: number; error?: string }>;
  };
}


declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
