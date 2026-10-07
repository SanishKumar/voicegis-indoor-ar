import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { visibleInspectorLabels } from '../engine/inspectorLabels';

/** Html positions its labels during the frame; measure them afterwards in CSS pixels. */
export default function InspectorLabelLayout() {
  const get = useThree((state) => state.get);
  const scheduleRef = useRef<(() => void) | null>(null);
  useFrame(() => scheduleRef.current?.());

  useEffect(() => {
    const { gl, invalidate } = get();
    const container = gl.domElement.closest<HTMLElement>('.twin-canvas');
    if (!container) return undefined;
    let frame: number | null = null;
    let active = true;
    const layout = () => {
      frame = null;
      if (!active) return;
      const labels = [...container.querySelectorAll<HTMLElement>('[data-inspector-label-id]')];
      const candidates = labels.map((label) => ({
        id: label.dataset.inspectorLabelId!,
        priority: Number(label.dataset.inspectorLabelPriority) || 30,
        bounds: label.getBoundingClientRect(),
      }));
      const rect = container.getBoundingClientRect();
      const viewport = {
        left: Math.max(0, rect.left),
        top: Math.max(0, rect.top),
        right: Math.min(window.innerWidth, rect.right),
        bottom: Math.min(window.innerHeight, rect.bottom),
      };
      const reserved = [...container.querySelectorAll<HTMLElement>('.twin-viewport-status')].map(
        (element) => element.getBoundingClientRect(),
      );
      const shown = visibleInspectorLabels(candidates, viewport, reserved);
      for (const label of labels) {
        const visible = shown.has(label.dataset.inspectorLabelId!);
        label.style.visibility = visible ? 'visible' : 'hidden';
        label.dataset.inspectorLabelVisible = String(visible);
        label.setAttribute('aria-hidden', String(!visible));
      }
    };
    const schedule = () => {
      if (active && frame === null) frame = requestAnimationFrame(layout);
    };
    const refresh = () => {
      schedule();
      invalidate();
    };
    scheduleRef.current = schedule;
    const observer = new ResizeObserver(refresh);
    observer.observe(container);
    window.addEventListener('resize', refresh);
    window.addEventListener('scroll', schedule, true);
    document.fonts?.addEventListener('loadingdone', refresh);
    void document.fonts?.ready.then(() => {
      if (active) refresh();
    });
    refresh();
    return () => {
      active = false;
      scheduleRef.current = null;
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', refresh);
      window.removeEventListener('scroll', schedule, true);
      document.fonts?.removeEventListener('loadingdone', refresh);
      for (const label of container.querySelectorAll<HTMLElement>('[data-inspector-label-id]')) {
        label.style.removeProperty('visibility');
        delete label.dataset.inspectorLabelVisible;
        label.removeAttribute('aria-hidden');
      }
    };
  }, [get]);
  return null;
}
