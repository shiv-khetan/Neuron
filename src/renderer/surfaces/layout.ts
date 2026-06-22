export interface PanelSpec {
  type: string;
  [key: string]: unknown;
}

export interface LayoutGroup {
  direction: 'horizontal' | 'vertical';
  children: LayoutChild[];
}

export interface LayoutChild {
  size?: number;
  group?: LayoutGroup;
  panel?: PanelSpec;
}

function isGroup(value: unknown): value is LayoutGroup {
  if (!value || typeof value !== 'object') return false;
  const group = value as Record<string, unknown>;
  return (group.direction === 'horizontal' || group.direction === 'vertical') && Array.isArray(group.children);
}

export function parseLayout(content: string): LayoutGroup | null {
  const text = content.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return isGroup(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
