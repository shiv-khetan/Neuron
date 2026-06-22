import { useMemo } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { SurfaceProps } from './index';
import { parseLayout, type LayoutChild, type LayoutGroup } from './layout';
import { getPanel, type PanelContext } from './panels';

function PanelBody({ spec, surface }: PanelContext) {
  const Renderer = getPanel(spec.type);
  if (!Renderer) {
    return <div className="grid h-full place-items-center px-4 text-center text-xs text-[var(--ink-muted)]">Unknown panel type "{spec.type}".</div>;
  }
  return <Renderer spec={spec} surface={surface} />;
}

function renderGroup(group: LayoutGroup, surface: SurfaceProps, key: string) {
  const handleClass = group.direction === 'horizontal' ? 'resize-handle resize-handle-v' : 'resize-handle resize-handle-h';
  return (
    <PanelGroup
      direction={group.direction}
      autoSaveId={`neuron.config.${key}`}
      className={group.direction === 'horizontal' ? 'flex min-h-0' : 'flex min-h-0 flex-col'}
    >
      {group.children.map((child: LayoutChild, i) => {
        const childKey = `${key}.${i}`;
        return (
          <Panel key={childKey} id={childKey} order={i + 1} defaultSize={child.size} minSize={8} className="min-h-0 min-w-0">
            {child.group
              ? renderGroup(child.group, surface, childKey)
              : child.panel
                ? <PanelBody spec={child.panel} surface={surface} />
                : null}
          </Panel>
        );
      }).flatMap((node, i) => (i === 0 ? [node] : [<PanelResizeHandle key={`h-${key}-${i}`} className={handleClass} />, node]))}
    </PanelGroup>
  );
}

export function LayoutSurface(props: SurfaceProps) {
  const group = useMemo(() => parseLayout(props.content), [props.content]);

  if (!group) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-xs text-[var(--ink-muted)]">
        <LayoutDashboard className="h-5 w-5" />
        .neuron/layout.json is empty or invalid JSON. It should contain a layout tree.
      </div>
    );
  }

  return <div className="h-full w-full">{renderGroup(group, props, '0')}</div>;
}

export default LayoutSurface;
