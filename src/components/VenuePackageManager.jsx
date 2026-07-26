import { useState } from 'react';
import { Database, FileUp, Link2, ShieldCheck, X } from 'lucide-react';
import { useVenue } from '../context/VenueContext.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import { resolveOperationalOverlay } from '../engine/operationalOverlay';

export default function VenuePackageManager() {
  const { catalog, status, activateFromFile, activateFromUrl } = useVenue();
  const { venue, operationalOverlay, setOperationalOverlay } = useNavigation();
  const [packageUrl, setPackageUrl] = useState('');
  const [operationMessage, setOperationMessage] = useState(null);

  const switchToUrl = async (url) => {
    setOperationMessage(null);
    try {
      await activateFromUrl(url);
    } catch (error) {
      setOperationMessage(error instanceof Error ? error.message : 'Package activation failed.');
    }
  };

  const loadPackageFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setOperationMessage(null);
    try {
      await activateFromFile(file);
    } catch (error) {
      setOperationMessage(error instanceof Error ? error.message : 'Package activation failed.');
    } finally {
      event.target.value = '';
    }
  };

  const loadOverlayFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const value = JSON.parse(await file.text());
      const evaluatedAt = new Date().toISOString();
      const resolution = resolveOperationalOverlay(value, venue.buildingPackage, evaluatedAt);
      if (!resolution.valid) {
        throw new Error(
          `Overlay rejected: ${resolution.issues.map((issue) => issue.code).join(', ')}.`,
        );
      }
      setOperationalOverlay(value, evaluatedAt);
      setOperationMessage(`${file.name} is active for route evaluation.`);
    } catch (error) {
      setOperationMessage(error instanceof Error ? error.message : 'Overlay activation failed.');
    } finally {
      event.target.value = '';
    }
  };

  const buildingPackage = venue.buildingPackage;

  return (
    <aside className="venue-package-manager" aria-label="VenuePackage runtime controls">
      <div className="venue-package-manager-title">
        <div>
          <span>Runtime boundary</span>
          <strong>{buildingPackage.building.name}</strong>
        </div>
        <ShieldCheck size={20} />
      </div>

      <div className="venue-package-facts">
        <span>{buildingPackage.floors.length} floors</span>
        <span>{buildingPackage.pois.length} POIs</span>
        <span>{buildingPackage.localizationAnchors.length} anchors</span>
        <code>{buildingPackage.manifest.contentHash.slice(0, 12)}</code>
      </div>

      <div className="venue-package-catalog">
        {catalog.map((candidate) => (
          <button
            type="button"
            key={candidate.id}
            className={candidate.id === buildingPackage.building.id ? 'active' : ''}
            disabled={status.state === 'switching'}
            onClick={() => switchToUrl(candidate.packageUrl)}
          >
            <Database size={14} />
            <span>
              <strong>{candidate.name}</strong>
              <small>{candidate.description}</small>
            </span>
          </button>
        ))}
      </div>

      <form
        className="venue-package-url"
        onSubmit={(event) => {
          event.preventDefault();
          if (packageUrl.trim()) void switchToUrl(packageUrl.trim());
        }}
      >
        <Link2 size={14} />
        <input
          type="url"
          value={packageUrl}
          onChange={(event) => setPackageUrl(event.target.value)}
          placeholder="https://…/building.package.json"
          aria-label="VenuePackage URL"
        />
        <button type="submit">Load URL</button>
      </form>

      <div className="venue-artifact-actions">
        <label>
          <FileUp size={14} />
          Load package artifact
          <input type="file" accept="application/json,.json" onChange={loadPackageFile} />
        </label>
        <label>
          <FileUp size={14} />
          Load closure overlay
          <input type="file" accept="application/json,.json" onChange={loadOverlayFile} />
        </label>
        {operationalOverlay && (
          <button type="button" onClick={() => setOperationalOverlay(null)}>
            <X size={14} />
            Clear overlay
          </button>
        )}
      </div>

      <p className={status.error || operationMessage ? 'venue-runtime-message' : undefined}>
        {operationMessage ?? status.error ?? status.detail}
      </p>
    </aside>
  );
}
