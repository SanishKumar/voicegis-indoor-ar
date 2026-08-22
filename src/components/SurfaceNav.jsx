import { Box, Map, PenTool, Radio } from 'lucide-react';

const SURFACES = [
  { id: 'visitor', label: '2D map', icon: Map },
  { id: 'inspector', label: '3D + venues', icon: Box },
  { id: 'studio', label: 'Studio', icon: PenTool },
  { id: 'recorder', label: 'Record', icon: Radio },
];

export default function SurfaceNav({ activeSurface }) {
  return (
    <nav className="surface-nav" aria-label="Application surface">
      {SURFACES.map((surface) => (
        <SurfaceLink key={surface.id} surface={surface} activeSurface={activeSurface} />
      ))}
    </nav>
  );
}

function SurfaceLink({ surface, activeSurface }) {
  const Icon = surface.icon;
  const active = surface.id === activeSurface;
  return (
    <a
      href={`#/${surface.id}`}
      className={active ? 'active' : ''}
      aria-current={active ? 'page' : undefined}
      /*
        Named explicitly, because the visible label is the first thing to go.
        Below 700px the span is display:none and the icon is aria-hidden, which
        left all four links with no accessible name whatsoever - a screen reader
        announced four unlabelled links to nowhere. The name matches the visible
        text where there is one, so the two never disagree.
      */
      aria-label={surface.label}
    >
      <Icon size={14} aria-hidden="true" />
      <span>{surface.label}</span>
    </a>
  );
}
