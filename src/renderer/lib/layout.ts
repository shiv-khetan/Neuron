// Workbench layout state: which shell regions are visible. Persisted via the
// settings bridge (never localStorage) under the 'layout' key.

export interface WorkbenchLayout {
  activityBar: boolean;
  sidebar: boolean;
  rightPanel: boolean;
  bottomPanel: boolean;
  statusBar: boolean;
  zen: boolean;
}

export const DEFAULT_LAYOUT: WorkbenchLayout = {
  activityBar: true,
  sidebar: true,
  rightPanel: false,
  bottomPanel: false,
  statusBar: true,
  zen: false,
};

/** Merge a stored layout over the defaults, ignoring junk. */
export function resolveLayout(stored: Partial<WorkbenchLayout> | null | undefined): WorkbenchLayout {
  const merged = { ...DEFAULT_LAYOUT };
  if (stored && typeof stored === 'object') {
    for (const key of Object.keys(DEFAULT_LAYOUT) as (keyof WorkbenchLayout)[]) {
      if (typeof stored[key] === 'boolean') merged[key] = stored[key] as boolean;
    }
  }
  // Zen is a transient focus state — never restore a session into zen mode.
  merged.zen = false;
  return merged;
}
