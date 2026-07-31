import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Layers3, X } from 'lucide-react';
import type { DxfInspectionResult, DxfLayerMappingProfile } from '@voicegis/dxf-importer';
import type { SpaceType } from '@voicegis/spatial-schema';
import {
  buildDxfLayerMappingProfile,
  createDxfLayerMappingDraft,
  type DxfLayerMappingDraft,
} from '../studio/dxfLayerMappingWorkspace';

const SPACE_TYPES: SpaceType[] = [
  'entrance',
  'room',
  'corridor',
  'lobby',
  'service',
  'restricted',
  'vertical-circulation',
];

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
    inspection.layers.map(createDxfLayerMappingDraft),
  );
  const profile = useMemo(() => buildDxfLayerMappingProfile(drafts), [drafts]);
  const floorIds = drafts
    .filter((draft) => draft.role === 'floor' && draft.id)
    .map((draft) => draft.id);

  const updateDraft = (index: number, changes: Partial<DxfLayerMappingDraft>) => {
    setDrafts((current) =>
      current.map((draft, draftIndex) => (draftIndex === index ? { ...draft, ...changes } : draft)),
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

      <div className="studio-layer-mapper-note">
        <AlertTriangle size={15} />
        <span>
          This slice maps one closed polyline per layer to floors or spaces. Values such as
          elevation and height use the drawing&apos;s declared units. Accessibility must be reviewed
          explicitly.
        </span>
      </div>

      <div className="studio-layer-mapper-list">
        {inspection.layers.map((layer, index) => {
          const draft = drafts[index];
          const supported =
            layer.entityCount === 1 &&
            layer.closedLightweightPolylines === 1 &&
            layer.entityTypes.length === 1 &&
            layer.entityTypes[0] === 'LWPOLYLINE';
          return (
            <article key={layer.name} className={draft.role === 'ignore' ? '' : 'mapped'}>
              <div className="studio-layer-source">
                <span>
                  <strong>{layer.name}</strong>
                  <small>
                    {layer.entityCount} entities · {layer.entityTypes.join(', ')} ·{' '}
                    {layer.closedLightweightPolylines} closed polylines
                  </small>
                </span>
                <label>
                  Role
                  <select
                    value={draft.role}
                    onChange={(event) => {
                      const role = event.target.value as DxfLayerMappingDraft['role'];
                      updateDraft(index, {
                        role,
                        floorId:
                          role === 'space' && floorIds.length === 1 ? floorIds[0] : draft.floorId,
                      });
                    }}
                  >
                    <option value="ignore">Ignore</option>
                    <option value="floor" disabled={!supported}>
                      Floor outline
                    </option>
                    <option value="space" disabled={!supported}>
                      Space polygon
                    </option>
                  </select>
                </label>
              </div>

              {!supported && (
                <p className="studio-layer-unsupported">
                  This layer is visible for inspection but cannot be mapped in Slice 1.
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
                  <label>
                    Display name
                    <input
                      value={draft.name}
                      onChange={(event) => updateDraft(index, { name: event.target.value })}
                    />
                  </label>

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
