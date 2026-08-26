import { Box, Map, PenTool, Radio } from 'lucide-react';

/**
 * Operator tooling, and the way back out of it.
 *
 * This used to be primary navigation on every surface, so a visitor looking for
 * a toilet was offered a package inspector, a venue authoring workspace and a
 * sensor recorder. None of those are for them, and three of the four entries
 * being operator tools made the one that was theirs harder to find.
 *
 * It renders only on the operator surfaces now. "Visitor view" is kept as the
 * first entry because an operator needs a way back, and without it the only
 * exit is editing the URL.
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
