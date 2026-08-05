import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Download, Layers3, Upload, X } from 'lucide-react';
import type {
  DxfImportIssue,
  DxfInspectionResult,
  DxfLayerMappingProfile,
  DxfSelectableEntitySummary,
} from '@voicegis/dxf-importer';
import type { AnchorKind, ConnectorKind, PortalKind, SpaceType } from '@voicegis/spatial-schema';
import {
  buildDxfLayerMappingProfile,
  createDxfLayerMappingDrafts,
  restoreDxfLayerMappingDrafts,
  type DxfLayerMappingDraft,
} from '../studio/dxfLayerMappingWorkspace';
import {
  createDxfMappingProfileArtifact,
  parseDxfMappingProfileArtifact,
} from '../studio/dxfMappingProfileArtifact';

const SPACE_TYPES: SpaceType[] = [
  'entrance',
  'room',
  'corridor',
  'lobby',
  'service',
  'restricted',
  'vertical-circulation',
];
const PORTAL_KINDS: PortalKind[] = ['door', 'opening', 'gate'];
const CONNECTOR_KINDS: ConnectorKind[] = ['elevator', 'stairs', 'ramp', 'escalator'];
const ANCHOR_KINDS: AnchorKind[] = ['qr', 'apriltag', 'image', 'nfc'];

function EntityPreview({ entity }: { entity: DxfSelectableEntitySummary }) {
  if (entity.type === 'POINT') {
    const [x, y] = entity.point;
    return (
      <svg
        className="studio-entity-preview"
        viewBox={`${x - 0.5} ${y - 0.5} 1 1`}
        aria-hidden="true"
      >
        <circle cx={x} cy={y} r="0.16" />
      </svg>
    );
  }
  const points = entity.type === 'LWPOLYLINE' ? entity.polygon : entity.line;
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(0.01, Math.max(...xs) - minX);
  const height = Math.max(0.01, Math.max(...ys) - minY);
  const padding = Math.max(width, height) * 0.08;
  return (
    <svg
      className="studio-entity-preview"
      viewBox={`${minX - padding} ${minY - padding} ${width + padding * 2} ${height + padding * 2}`}
      aria-hidden="true"
    >
      {entity.type === 'LWPOLYLINE' ? (
        <polygon points={entity.polygon.map(([x, y]) => `${x},${y}`).join(' ')} />
      ) : (
        <line
          x1={entity.line[0][0]}
          y1={entity.line[0][1]}
          x2={entity.line[1][0]}
          y2={entity.line[1][1]}
        />
      )}
    </svg>
  );
}

interface DxfLayerMappingPanelProps {
  fileName: string;
  inspection: DxfInspectionResult;
  onCancel: () => void;
  onStage: (profile: DxfLayerMappingProfile) => void;
}

export default function DxfLayerMappingPanel({
  fileName,
  inspection,
  onCancel,
  onStage,
}: DxfLayerMappingPanelProps) {
  const [drafts, setDrafts] = useState<DxfLayerMappingDraft[]>(() =>
    createDxfLayerMappingDrafts(inspection),
  );
  const [profileIssues, setProfileIssues] = useState<DxfImportIssue[]>([]);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);
  const profileInputRef = useRef<HTMLInputElement>(null);
  const profile = useMemo(() => buildDxfLayerMappingProfile(drafts), [drafts]);
  const floorIds = drafts
    .filter((draft) => draft.role === 'floor' && draft.id)
    .map((draft) => draft.id);
  const spaceIds = drafts
    .filter((draft) => draft.role === 'space' && draft.id)
    .map((draft) => draft.id);

  const updateDraft = (index: number, changes: Partial<DxfLayerMappingDraft>) => {
    setDrafts((current) =>
      current.map((draft, draftIndex) => (draftIndex === index ? { ...draft, ...changes } : draft)),
    );
    setProfileIssues([]);
    setProfileNotice(null);
  };

  const saveProfile = async () => {
    if (!profile.profile) return;
    const artifact = await createDxfMappingProfileArtifact(profile.profile, fileName);
    const blob = new Blob([artifact.text], { type: artifact.mediaType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = artifact.fileName;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setProfileIssues([]);
    setProfileNotice(`Saved ${artifact.mappingCount} mappings as ${artifact.fileName}.`);
  };

  const loadProfile = async (file: File | undefined) => {
    if (!file) return;
    const parsed = parseDxfMappingProfileArtifact(await file.text());
    if (!parsed.profile) {
      setProfileNotice(null);
      setProfileIssues(parsed.issues);
      return;
    }
    const restored = restoreDxfLayerMappingDrafts(inspection, parsed.profile);
    if (!restored.drafts) {
      setProfileNotice(null);
      setProfileIssues(restored.issues);
      return;
    }
    setDrafts(restored.drafts);
    setProfileIssues([]);
    setProfileNotice(
      `Restored ${parsed.profile.mappings.length} mappings from ${file.name}. Review every field before staging.`,
    );
  };

  return (
    <section className="studio-layer-mapper" aria-label="DXF layer mapping workspace">
      <header>
        <div>
          <Layers3 size={18} />
          <span>
            <strong>Map CAD layers</strong>
            <small>
              {fileName} · {inspection.detectedUnits ?? 'units unknown'} ·{' '}
              {inspection.layers.length} layers
            </small>
          </span>
        </div>
        <button type="button" onClick={onCancel} aria-label="Cancel DXF layer mapping">
          <X size={16} />
        </button>
      </header>

      <div className="studio-layer-mapper-profile">
        <input
          ref={profileInputRef}
          type="file"
          accept="application/json,.json"
          onChange={(event) => void loadProfile(event.target.files?.[0])}
          aria-label="Load saved CAD mapping profile"
        />
        <button type="button" onClick={() => profileInputRef.current?.click()}>
          <Upload size={14} />
          Load profile
        </button>
        <button
          type="button"
          onClick={() => void saveProfile()}
          disabled={!profile.profile}
          title={
            profile.profile
              ? 'Save this completed mapping as a reusable artifact'
              : 'Complete every mapped field before saving a profile'
          }
        >
          <Download size={14} />
          Save profile
        </button>
        {profileNotice && <small>{profileNotice}</small>}
      </div>

      {profileIssues.length > 0 && (
        <ul className="studio-layer-mapper-profile-issues">
          {profileIssues.map((entry) => (
            <li key={`${entry.code}:${entry.path}`}>
              <strong>{entry.path}</strong>
              {entry.message}
            </li>
          ))}
        </ul>
      )}

      <div className="studio-layer-mapper-note">
        <AlertTriangle size={15} />
        <span>
          Shared-layer polygons, portal lines, and semantic points are listed individually;
          single-entity layers can still be mapped as a whole. Public, accessibility, and
          restriction policies must be reviewed explicitly. Connector stops sharing an ID must use
          identical metadata, and every localization anchor needs its own surveyed heading and
          payload. A saved profile only restores mappings this drawing still offers; a stale
          profile is rejected whole rather than applied halfway.
        </span>
      </div>

      <div className="studio-layer-mapper-list">
        {drafts.map((draft, index) => {
          const layer = inspection.layers.find(
            (candidate) => candidate.name === draft.sourceLayer,
          )!;
          const sourceEntity = draft.sourceEntityKey
            ? layer.selectableEntities.find((entity) => entity.key === draft.sourceEntityKey)
            : undefined;
          const sourceEntityNumber = sourceEntity
            ? layer.selectableEntities.findIndex((entity) => entity.key === sourceEntity.key) + 1
            : null;
          const supportsPolygon =
            (sourceEntity &&
              sourceEntity.type === 'LWPOLYLINE' &&
              sourceEntity.occurrenceCount === 1) ||
            (!sourceEntity &&
              layer.entityCount === 1 &&
              layer.closedLightweightPolylines === 1 &&
              layer.entityTypes.length === 1 &&
              layer.entityTypes[0] === 'LWPOLYLINE');
          const supportsPortal =
            (sourceEntity && sourceEntity.type === 'LINE' && sourceEntity.occurrenceCount === 1) ||
            (!sourceEntity &&
              layer.entityCount === 1 &&
              layer.entityTypes.length === 1 &&
              layer.entityTypes[0] === 'LINE');
          const supportsPoi =
            (sourceEntity && sourceEntity.type === 'POINT' && sourceEntity.occurrenceCount === 1) ||
            (!sourceEntity &&
              layer.entityCount === 1 &&
              layer.entityTypes.length === 1 &&
              layer.entityTypes[0] === 'POINT');
          const supportsConnector = supportsPoi;
          const supportsAnchor = supportsPoi;
          return (
            <article
              key={`${layer.name}:${draft.sourceEntityKey ?? 'whole'}`}
              className={draft.role === 'ignore' ? '' : 'mapped'}
            >
              <div className="studio-layer-source">
                <div className="studio-layer-identity">
                  {sourceEntity && <EntityPreview entity={sourceEntity} />}
                  <span>
                    <strong>{layer.name}</strong>
                    <small>
                      {sourceEntity?.type === 'LINE'
                        ? `Line ${sourceEntityNumber} of ${layer.selectableEntities.length} · length ${sourceEntity.length}`
                        : sourceEntity?.type === 'POINT'
                          ? `Point ${sourceEntityNumber} of ${layer.selectableEntities.length} · ${sourceEntity.point[0]}, ${sourceEntity.point[1]}`
                          : sourceEntity
                            ? `Polygon ${sourceEntityNumber} of ${layer.selectableEntities.length} · area ${sourceEntity.area}`
                            : `${layer.entityCount} entities · ${layer.entityTypes.join(', ')} · ${layer.closedLightweightPolylines} closed polylines`}
                    </small>
                  </span>
                </div>
                <label>
                  Role
                  <select
                    value={draft.role}
                    onChange={(event) => {
                      const role = event.target.value as DxfLayerMappingDraft['role'];
                      updateDraft(index, {
                        role,
                        floorId:
                          (role === 'space' ||
                            role === 'portal' ||
                            role === 'poi' ||
                            role === 'connector' ||
                            role === 'anchor') &&
                          floorIds.length === 1
                            ? floorIds[0]
                            : draft.floorId,
                        spaceId:
                          (role === 'poi' || role === 'connector' || role === 'anchor') &&
                          spaceIds.length === 1
                            ? spaceIds[0]
                            : draft.spaceId,
                      });
                    }}
                  >
                    <option value="ignore">Ignore</option>
                    <option value="floor" disabled={!supportsPolygon}>
                      Floor outline
                    </option>
                    <option value="space" disabled={!supportsPolygon}>
                      Space polygon
                    </option>
                    <option value="portal" disabled={!supportsPortal}>
                      Door / opening / gate
                    </option>
                    <option value="poi" disabled={!supportsPoi}>
                      Point of interest
                    </option>
                    <option value="connector" disabled={!supportsConnector}>
                      Vertical connector stop
                    </option>
                    <option value="anchor" disabled={!supportsAnchor}>
                      Localization anchor
                    </option>
                  </select>
                </label>
              </div>

              {!supportsPolygon && !supportsPortal && !supportsPoi && !supportsConnector && (
                <p className="studio-layer-unsupported">
                  {sourceEntity?.occurrenceCount && sourceEntity.occurrenceCount > 1
                    ? `${sourceEntity.occurrenceCount} identical entities share this geometry identity and cannot be selected safely.`
                    : 'This entity is visible for inspection but cannot be mapped in this slice.'}
                </p>
              )}

              {draft.role !== 'ignore' && (
                <div className="studio-layer-fields">
                  <label>
                    Canonical id
                    <input
                      value={draft.id}
                      onChange={(event) => updateDraft(index, { id: event.target.value })}
                    />
                  </label>
                  {draft.role !== 'portal' && draft.role !== 'anchor' && (
                    <label>
                      Display name
                      <input
                        value={draft.name}
                        onChange={(event) => updateDraft(index, { name: event.target.value })}
                      />
                    </label>
                  )}

                  {draft.role === 'floor' ? (
                    <>
                      <label>
                        Level
                        <input
                          type="number"
                          step="1"
                          value={draft.level}
                          onChange={(event) => updateDraft(index, { level: event.target.value })}
                        />
                      </label>
                      <label>
                        Elevation
                        <input
                          type="number"
                          step="any"
                          value={draft.elevation}
                          onChange={(event) =>
                            updateDraft(index, { elevation: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        Clear height
                        <input
                          type="number"
                          step="any"
                          value={draft.clearHeight}
                          onChange={(event) =>
                            updateDraft(index, { clearHeight: event.target.value })
                          }
                        />
                      </label>
                    </>
                  ) : draft.role === 'space' ? (
                    <>
                      <label>
                        Floor
                        <select
                          value={draft.floorId}
                          onChange={(event) => updateDraft(index, { floorId: event.target.value })}
                        >
                          <option value="">Choose floor</option>
                          {floorIds.map((floorId) => (
                            <option key={floorId} value={floorId}>
                              {floorId}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Space type
                        <select
                          value={draft.spaceType}
                          onChange={(event) =>
                            updateDraft(index, { spaceType: event.target.value as SpaceType })
                          }
                        >
                          <option value="">Choose type</option>
                          {SPACE_TYPES.map((spaceType) => (
                            <option key={spaceType} value={spaceType}>
                              {spaceType}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Public
                        <select
                          value={draft.publicPolicy}
                          onChange={(event) =>
                            updateDraft(index, {
                              publicPolicy: event.target
                                .value as DxfLayerMappingDraft['publicPolicy'],
                            })
                          }
                        >
                          <option value="">Review required</option>
                          <option value="true">Public</option>
                          <option value="false">Not public</option>
                        </select>
                      </label>
                      <label>
                        Accessible
                        <select
                          value={draft.accessiblePolicy}
                          onChange={(event) =>
                            updateDraft(index, {
                              accessiblePolicy: event.target
                                .value as DxfLayerMappingDraft['accessiblePolicy'],
                            })
                          }
                        >
                          <option value="">Review required</option>
                          <option value="true">Accessible</option>
                          <option value="false">Not accessible</option>
                        </select>
                      </label>
                    </>
                  ) : draft.role === 'connector' ? (
                    <>
                      <label>
                        Floor
                        <select
                          value={draft.floorId}
                          onChange={(event) => updateDraft(index, { floorId: event.target.value })}
                        >
                          <option value="">Choose floor</option>
                          {floorIds.map((floorId) => (
                            <option key={floorId} value={floorId}>
                              {floorId}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Space
                        <select
                          value={draft.spaceId}
                          onChange={(event) => updateDraft(index, { spaceId: event.target.value })}
                        >
                          <option value="">Choose space</option>
                          {spaceIds.map((spaceId) => (
                            <option key={spaceId} value={spaceId}>
                              {spaceId}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Kind
                        <select
                          value={draft.connectorKind}
                          onChange={(event) =>
                            updateDraft(index, {
                              connectorKind: event.target.value as ConnectorKind,
                            })
                          }
                        >
                          <option value="">Choose kind</option>
                          {CONNECTOR_KINDS.map((kind) => (
                            <option key={kind} value={kind}>
                              {kind}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Accessible
                        <select
                          value={draft.accessiblePolicy}
                          onChange={(event) =>
                            updateDraft(index, {
                              accessiblePolicy: event.target
                                .value as DxfLayerMappingDraft['accessiblePolicy'],
                            })
                          }
                        >
                          <option value="">Review required</option>
                          <option value="true">Accessible</option>
                          <option value="false">Not accessible</option>
                        </select>
                      </label>
                      <label>
                        Restricted
                        <select
                          value={draft.restrictedPolicy}
                          onChange={(event) =>
                            updateDraft(index, {
                              restrictedPolicy: event.target
                                .value as DxfLayerMappingDraft['restrictedPolicy'],
                            })
                          }
                        >
                          <option value="">Review required</option>
                          <option value="true">Restricted</option>
                          <option value="false">Not restricted</option>
                        </select>
                      </label>
                    </>
                  ) : draft.role === 'poi' ? (
                    <>
                      <label>
                        Floor
                        <select
                          value={draft.floorId}
                          onChange={(event) => updateDraft(index, { floorId: event.target.value })}
                        >
                          <option value="">Choose floor</option>
                          {floorIds.map((floorId) => (
                            <option key={floorId} value={floorId}>
                              {floorId}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Space
                        <select
                          value={draft.spaceId}
                          onChange={(event) => updateDraft(index, { spaceId: event.target.value })}
                        >
                          <option value="">Choose space</option>
                          {spaceIds.map((spaceId) => (
                            <option key={spaceId} value={spaceId}>
                              {spaceId}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Category
                        <input
                          value={draft.poiCategory}
                          onChange={(event) =>
                            updateDraft(index, { poiCategory: event.target.value })
                          }
                          placeholder="service, amenity, exhibit…"
                        />
                      </label>
                      <label>
                        Public
                        <select
                          value={draft.publicPolicy}
                          onChange={(event) =>
                            updateDraft(index, {
                              publicPolicy: event.target
                                .value as DxfLayerMappingDraft['publicPolicy'],
                            })
                          }
                        >
                          <option value="">Review required</option>
                          <option value="true">Public</option>
                          <option value="false">Not public</option>
                        </select>
                      </label>
                      <label>
                        Accessible
                        <select
                          value={draft.accessiblePolicy}
                          onChange={(event) =>
                            updateDraft(index, {
                              accessiblePolicy: event.target
                                .value as DxfLayerMappingDraft['accessiblePolicy'],
                            })
                          }
                        >
                          <option value="">Review required</option>
                          <option value="true">Accessible</option>
                          <option value="false">Not accessible</option>
                        </select>
                      </label>
                    </>
                  ) : draft.role === 'anchor' ? (
                    <>
                      <label>
                        Floor
                        <select
                          value={draft.floorId}
                          onChange={(event) => updateDraft(index, { floorId: event.target.value })}
                        >
                          <option value="">Choose floor</option>
                          {floorIds.map((floorId) => (
                            <option key={floorId} value={floorId}>
                              {floorId}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Space
                        <select
                          value={draft.spaceId}
                          onChange={(event) => updateDraft(index, { spaceId: event.target.value })}
                        >
                          <option value="">Choose space</option>
                          {spaceIds.map((spaceId) => (
                            <option key={spaceId} value={spaceId}>
                              {spaceId}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Kind
                        <select
                          value={draft.anchorKind}
                          onChange={(event) =>
                            updateDraft(index, { anchorKind: event.target.value as AnchorKind })
                          }
                        >
                          <option value="">Choose kind</option>
                          {ANCHOR_KINDS.map((kind) => (
                            <option key={kind} value={kind}>
                              {kind}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Heading°
                        <input
                          type="number"
                          step="any"
                          min="0"
                          max="359.999"
                          value={draft.headingDegrees}
                          onChange={(event) =>
                            updateDraft(index, { headingDegrees: event.target.value })
                          }
                          placeholder="0–359.999"
                        />
                      </label>
                      <label>
                        Payload
                        <input
                          value={draft.anchorPayload}
                          onChange={(event) =>
                            updateDraft(index, { anchorPayload: event.target.value })
                          }
                          placeholder="surveyed marker value"
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <label>
                        Floor
                        <select
                          value={draft.floorId}
                          onChange={(event) => updateDraft(index, { floorId: event.target.value })}
                        >
                          <option value="">Choose floor</option>
                          {floorIds.map((floorId) => (
                            <option key={floorId} value={floorId}>
                              {floorId}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Kind
                        <select
                          value={draft.portalKind}
                          onChange={(event) =>
                            updateDraft(index, { portalKind: event.target.value as PortalKind })
                          }
                        >
                          <option value="">Choose kind</option>
                          {PORTAL_KINDS.map((kind) => (
                            <option key={kind} value={kind}>
                              {kind}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        From space
                        <select
                          value={draft.spaceA}
                          onChange={(event) => updateDraft(index, { spaceA: event.target.value })}
                        >
                          <option value="">Choose space</option>
                          {spaceIds.map((spaceId) => (
                            <option key={spaceId} value={spaceId}>
                              {spaceId}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        To space
                        <select
                          value={draft.spaceB}
                          onChange={(event) => updateDraft(index, { spaceB: event.target.value })}
                        >
                          <option value="">Choose space</option>
                          {spaceIds.map((spaceId) => (
                            <option key={spaceId} value={spaceId}>
                              {spaceId}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Accessible
                        <select
                          value={draft.accessiblePolicy}
                          onChange={(event) =>
                            updateDraft(index, {
                              accessiblePolicy: event.target
                                .value as DxfLayerMappingDraft['accessiblePolicy'],
                            })
                          }
                        >
                          <option value="">Review required</option>
                          <option value="true">Accessible</option>
                          <option value="false">Not accessible</option>
                        </select>
                      </label>
                      <label>
                        Restricted
                        <select
                          value={draft.restrictedPolicy}
                          onChange={(event) =>
                            updateDraft(index, {
                              restrictedPolicy: event.target
                                .value as DxfLayerMappingDraft['restrictedPolicy'],
                            })
                          }
                        >
                          <option value="">Review required</option>
                          <option value="true">Restricted</option>
                          <option value="false">Not restricted</option>
                        </select>
                      </label>
                    </>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>

      <footer>
        <span className={profile.valid ? 'valid' : ''}>
          {profile.valid
            ? `${profile.profile?.mappings.length ?? 0} layers ready to stage`
            : `${profile.issues.length} mapping fields need attention`}
        </span>
        <button
          type="button"
          disabled={!profile.profile}
          onClick={() => profile.profile && onStage(profile.profile)}
        >
          Stage mapped import
          <ArrowRight size={14} />
        </button>
      </footer>
    </section>
  );
}
