import { useRef } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import './mobilePanels.css';

export default function MobilePanelHandle({
  panel,
  label,
  controls,
}: {
  panel: { mobile: boolean; collapsed: boolean; setCollapsed: (value: boolean) => void };
  label: string;
  controls: string;
}) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);
  if (!panel.mobile) return null;
  return (
    <button
      type="button"
      className="mobile-panel-handle"
      aria-expanded={!panel.collapsed}
      aria-controls={controls}
      aria-label={`${panel.collapsed ? 'Expand' : 'Collapse'} ${label}`}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        start.current = { x: event.clientX, y: event.clientY };
        dragged.current = false;
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerCancel={() => {
        start.current = null;
        dragged.current = false;
      }}
      onPointerUp={(event) => {
        const from = start.current;
        start.current = null;
        if (!from) return;
        const dy = event.clientY - from.y;
        if (Math.abs(dy) < 28 || Math.abs(dy) < Math.abs(event.clientX - from.x)) return;
        dragged.current = true;
        event.currentTarget.focus({ preventScroll: true });
        panel.setCollapsed(dy > 0);
      }}
      onClick={(event) => {
        if (dragged.current) {
          dragged.current = false;
          return;
        }
        event.currentTarget.focus({ preventScroll: true });
        panel.setCollapsed(!panel.collapsed);
      }}
    >
      <span className="mobile-panel-grip" aria-hidden="true" />
      <span>{panel.collapsed ? 'More' : 'Less'}</span>
      {panel.collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
    </button>
  );
}
