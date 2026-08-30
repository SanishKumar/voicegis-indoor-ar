import { Box, Map, PenTool, Radio, Waypoints } from 'lucide-react';

/**
 * Operator tooling, and the way back out of it.
 *
 * This used to be primary navigation on every surface, so a visitor looking for
 * a toilet was offered a package inspector, a venue authoring workspace and a
 * sensor recorder. None of those are for them, and three of the four entries
 * being operator tools made the one that was theirs harder to find.
 *
 * It belongs to the operator build, not the public visitor bundle. The
 * operator build keeps it while previewing the visitor experience so the
 * operator can return without editing the URL; visually it is a workbench rail
 * on a desk and a bottom dock under a thumb, never a banner over the product.
 */
const SURFACES = [
  { id: 'visitor', label: 'Visitor view', icon: Map },
  { id: 'inspector', label: '3D + venues', icon: Box },
  { id: 'studio', label: 'Studio', icon: PenTool },
  { id: 'recorder', label: 'Record', icon: Radio },
];

export default function SurfaceNav({ activeSurface }) {
  return (
    <nav className="surface-nav" aria-label="Operator tools">
      <div className="surface-nav-brand" aria-hidden="true">
        <span className="surface-nav-mark">
          <Waypoints size={18} />
        </span>
        <span>
          <strong>VoiceGIS</strong>
          <small>Workbench</small>
        </span>
      </div>
      <div className="surface-nav-links">
        {SURFACES.map((surface) => (
          <SurfaceLink key={surface.id} surface={surface} activeSurface={activeSurface} />
        ))}
      </div>
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
        Named explicitly as a stable contract for assistive technology. The
        label remains visible in both the rail and the dock, and the accessible
        name matches it exactly.
      */
      aria-label={surface.label}
    >
      <Icon size={14} aria-hidden="true" />
      <span>{surface.label}</span>
    </a>
  );
}
