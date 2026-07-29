import { Box, Map, PenTool } from 'lucide-react';

const SURFACES = [
  { id: 'visitor', label: '2D map', icon: Map },
  { id: 'inspector', label: '3D + venues', icon: Box },
  { id: 'studio', label: 'Studio', icon: PenTool },
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
    >
      <Icon size={14} aria-hidden="true" />
      <span>{surface.label}</span>
    </a>
  );
}
