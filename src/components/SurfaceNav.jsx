const SURFACES = [
  { id: 'visitor', label: 'Visitor' },
  { id: 'inspector', label: 'Inspector' },
  { id: 'studio', label: 'Studio' },
];

export default function SurfaceNav({ activeSurface }) {
  return (
    <nav className="surface-nav" aria-label="Application surface">
      {SURFACES.map((surface) => (
        <a
          key={surface.id}
          href={`#/${surface.id}`}
          className={surface.id === activeSurface ? 'active' : ''}
          aria-current={surface.id === activeSurface ? 'page' : undefined}
        >
          {surface.label}
        </a>
      ))}
    </nav>
  );
}
