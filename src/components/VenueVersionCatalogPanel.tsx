import { CalendarDays, CheckCircle2, Database, PackageCheck } from 'lucide-react';
import type { VenueVersionCatalog } from '../data/venueVersionCatalog';

interface VenueVersionCatalogPanelProps {
  catalog: VenueVersionCatalog | null;
  activeHash: string;
  rollbackHash: string | null;
}

function releaseDate(timestamp: string) {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp));
}

export default function VenueVersionCatalogPanel({
  catalog,
  activeHash,
  rollbackHash,
}: VenueVersionCatalogPanelProps) {
  if (!catalog) {
    return (
      <section className="studio-version-catalog" aria-label="Venue version catalog">
        <div className="studio-version-catalog-empty">
          <Database size={17} />
          Version catalog metadata is not available.
        </div>
      </section>
    );
  }

  const releaseCount = catalog.venues.reduce((total, venue) => total + venue.releases.length, 0);
  const activeIsCataloged = catalog.venues.some((venue) =>
    venue.releases.some((release) => release.contentHash === activeHash),
  );

  return (
    <section className="studio-version-catalog" aria-label="Venue version catalog">
      <div className="studio-section-heading">
        <div>
          <span>Read-only release registry</span>
          <h2>Version catalog</h2>
        </div>
        <div className="studio-catalog-summary">
          <span>v{catalog.catalogVersion}</span>
          <strong>
            {catalog.venues.length} venues · {releaseCount} releases
          </strong>
        </div>
      </div>

      {!activeIsCataloged && (
        <div className="studio-catalog-local-notice">
          <PackageCheck size={15} />
          The active Studio revision is verified locally but has not been published to this catalog.
        </div>
      )}

      <div className="studio-catalog-venues">
        {catalog.venues.map((venue) => (
          <details
            key={venue.id}
            open={venue.releases.some(
              (release) =>
                release.contentHash === activeHash || release.contentHash === rollbackHash,
            )}
          >
            <summary>
              <Database size={15} />
              <span>
                <strong>{venue.name}</strong>
                <small>{venue.description}</small>
              </span>
              <b>{venue.releases.length}</b>
            </summary>

            <div className="studio-catalog-releases">
              {venue.releases.map((release) => {
                const active = release.contentHash === activeHash;
                const rollback = release.contentHash === rollbackHash;
                const isDefault = release.releaseId === venue.defaultReleaseId;
                return (
                  <article
                    key={release.releaseId}
                    className={active ? 'active' : rollback ? 'rollback' : undefined}
                  >
                    <div className="studio-catalog-release-heading">
                      <span>
                        {active && <CheckCircle2 size={14} />}
                        <strong>{release.releaseId}</strong>
                      </span>
                      <div>
                        {active && <i>Active</i>}
                        {rollback && <i>Rollback</i>}
                        {isDefault && <i>Default</i>}
                        <i>{release.status}</i>
                      </div>
                    </div>

                    <p>{release.notes}</p>
                    <div className="studio-catalog-release-meta">
                      <span>
                        <CalendarDays size={12} />
                        {releaseDate(release.publishedAt)}
                      </span>
                      <span>Package {release.packageVersion}</span>
                      <span>Compiler {release.compilerVersion}</span>
                      <span>Schema {release.sourceSchemaVersion}</span>
                    </div>
                    <div className="studio-catalog-release-counts">
                      <span>{release.summary.floors} floors</span>
                      <span>{release.summary.spaces} spaces</span>
                      <span>{release.summary.portals} portals</span>
                      <span>{release.summary.connectors} connectors</span>
                      <span>{release.summary.pois} POIs</span>
                      <span>{release.summary.anchors} anchors</span>
                    </div>
                    <code title={release.contentHash}>{release.contentHash}</code>
                    <small title={release.packageUrl}>{release.packageUrl}</small>
                  </article>
                );
              })}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
