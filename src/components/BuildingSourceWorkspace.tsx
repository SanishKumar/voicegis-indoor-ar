import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Braces,
  CheckCircle2,
  Code2,
  Download,
  Eye,
  FileJson,
  GitCompare,
  History,
  Map as MapIcon,
  Network,
  PackageCheck,
  Play,
  Power,
  RotateCcw,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import {
  compileBuildingInBrowser,
  type BrowserCompilationResult,
} from '@voicegis/map-compiler/browser';
import { useNavigation } from '../context/NavigationContext.jsx';
import { useVenue } from '../context/VenueContext.jsx';
import {
  formatBuildingSource,
  sourceFromVenuePackage,
  validateBuildingSourceDraft,
} from '../studio/buildingSourceWorkspace';
import {
  createVenuePackageArtifact,
  formatArtifactSize,
  type VenuePackageArtifact,
} from '../studio/venuePackageArtifact';
import type { CompiledBuildingRuntime } from '../data/compiledBuilding';
import type { RuntimePackageSummary } from '../data/runtimeActivationHistory';
import type { VenueVersionCatalog } from '../data/venueVersionCatalog';
import type { BuildingSource } from '@voicegis/spatial-schema';
import BuildingSourceFloorCanvas from './BuildingSourceFloorCanvas';
import VenuePublishDryRunPanel from './VenuePublishDryRunPanel';
import VenueVersionCatalogPanel from './VenueVersionCatalogPanel';

interface VenueRuntimeControls {
  status: {
    state: 'loading' | 'ready' | 'switching' | 'error';
    detail: string;
    error: string | null;
  };
  versionCatalog: VenueVersionCatalog | null;
  rollbackCandidate: RuntimePackageSummary | null;
  activateVerifiedPackage: (
    buildingPackage: NonNullable<BrowserCompilationResult['package']>,
    sourceLabel?: string,
  ) => Promise<CompiledBuildingRuntime | null>;
  rollbackRuntimePackage: () => Promise<CompiledBuildingRuntime | null>;
}

function validationTitle(validation: ReturnType<typeof validateBuildingSourceDraft>) {
  if (validation.valid) return 'BuildingSource is valid';
  if (!validation.syntaxValid) return 'JSON needs attention';
  if (!validation.shapeValid) return 'Schema validation failed';
  return 'Semantic validation failed';
}

function validationDescription(validation: ReturnType<typeof validateBuildingSourceDraft>) {
  if (validation.valid) {
    return 'The draft is ready for the deterministic compiler boundary.';
  }
  if (!validation.syntaxValid) {
    return 'Fix the JSON syntax before schema validation can continue.';
  }
  if (!validation.shapeValid) {
    return 'The draft does not satisfy BuildingSource schema 0.1.0.';
  }
  return 'The shape is valid, but spatial relationships or accessibility rules need correction.';
}

export default function BuildingSourceWorkspace() {
  const { venue } = useNavigation() as { venue: CompiledBuildingRuntime };
  const {
    status: runtimeStatus,
    versionCatalog,
    rollbackCandidate,
    activateVerifiedPackage,
    rollbackRuntimePackage,
  } = useVenue() as VenueRuntimeControls;
  const initialText = useMemo(
    () => formatBuildingSource(sourceFromVenuePackage(venue.buildingPackage)),
    [venue],
  );
  const [draftText, setDraftText] = useState(initialText);
  const [draftName, setDraftName] = useState(`${venue.buildingPackage.building.id}.json`);
  const [editorMode, setEditorMode] = useState<'visual' | 'json'>('visual');
  const [visualHistory, setVisualHistory] = useState<string[]>([]);
  const [fileMessage, setFileMessage] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [activationArmed, setActivationArmed] = useState(false);
  const [compilePreview, setCompilePreview] = useState<{
    draftText: string;
    result: BrowserCompilationResult;
    artifact: VenuePackageArtifact;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const validation = useMemo(() => validateBuildingSourceDraft(draftText), [draftText]);
  const dirty = draftText !== initialText;
  const errorCount = validation.issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = validation.issues.length - errorCount;
  const lineCount = draftText.split('\n').length;
  const previewStale = Boolean(compilePreview && compilePreview.draftText !== draftText);
  const previewPackage = compilePreview?.result.package ?? null;
  const previewArtifact = compilePreview?.artifact ?? null;
  const matchesActivePackage =
    previewPackage?.manifest.contentHash === venue.buildingPackage.manifest.contentHash;

  const resetDraft = () => {
    setDraftText(initialText);
    setDraftName(`${venue.buildingPackage.building.id}.json`);
    setFileMessage(null);
    setCompileError(null);
    setCompilePreview(null);
    setRuntimeError(null);
    setActivationArmed(false);
    setVisualHistory([]);
  };

  const formatDraft = () => {
    try {
      setDraftText(`${JSON.stringify(JSON.parse(draftText), null, 2)}\n`);
      setFileMessage(null);
      setActivationArmed(false);
      setVisualHistory([]);
    } catch {
      setFileMessage('Fix the JSON syntax before formatting.');
    }
  };

  const openFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      setDraftText(await file.text());
      setDraftName(file.name);
      setFileMessage(null);
      setCompileError(null);
      setCompilePreview(null);
      setRuntimeError(null);
      setActivationArmed(false);
      setVisualHistory([]);
      setEditorMode('json');
    } catch {
      setFileMessage(`Could not read ${file.name}.`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const beginVisualEdit = () => {
    setVisualHistory((history) => [...history.slice(-29), draftText]);
  };

  const applyVisualSource = (source: BuildingSource) => {
    setDraftText(formatBuildingSource(source));
    setFileMessage(null);
    setCompileError(null);
    setActivationArmed(false);
  };

  const undoVisualEdit = () => {
    const previousDraft = visualHistory.at(-1);
    if (!previousDraft) return;
    setDraftText(previousDraft);
    setVisualHistory((history) => history.slice(0, -1));
    setFileMessage(null);
    setCompileError(null);
    setActivationArmed(false);
  };

  const compileDraft = async () => {
    if (!validation.source || !validation.valid) return;
    setCompiling(true);
    setCompileError(null);
    setRuntimeError(null);
    setActivationArmed(false);
    try {
      const result = await compileBuildingInBrowser(validation.source);
      if (!result.package) {
        throw new Error('The deterministic compiler rejected this draft.');
      }
      const artifact = await createVenuePackageArtifact(result.package);
      setCompilePreview({ draftText, result, artifact });
    } catch (error) {
      setCompileError(error instanceof Error ? error.message : 'Compilation preview failed.');
    } finally {
      setCompiling(false);
    }
  };

  const activatePreview = async () => {
    if (!previewPackage || previewStale || matchesActivePackage) return;
    setRuntimeError(null);
    try {
      await activateVerifiedPackage(previewPackage, 'studio:compiled-preview');
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : 'Runtime activation failed.');
    }
  };

  const rollbackRuntime = async () => {
    if (!rollbackCandidate) return;
    setRuntimeError(null);
    try {
      await rollbackRuntimePackage();
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : 'Runtime rollback failed.');
    }
  };

  const downloadArtifact = () => {
    if (!previewArtifact || previewStale) return;
    const blob = new Blob([previewArtifact.text], { type: previewArtifact.mediaType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = previewArtifact.fileName;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <main className="studio-surface" id="main-content">
      <header className="studio-header">
        <div className="studio-heading">
          <span>Venue Studio v0 · Slice 9A</span>
          <h1>BuildingSource workspace</h1>
          <p>Exercise deterministic publishing against a guarded reference service.</p>
        </div>
        <div className="studio-boundary-note">
          <ShieldCheck size={17} />
          <span>
            Reference service tested only
            <small>
              Studio has no live endpoint, credential storage, scan, video, or CV operations
            </small>
          </span>
        </div>
      </header>

      <div className="studio-workspace">
        <section className="studio-editor-panel" aria-label="BuildingSource JSON editor">
          <div className="studio-panel-toolbar">
            <div className="studio-file-identity">
              <FileJson size={18} />
              <span>
                <strong>{draftName}</strong>
                <small>
                  {dirty ? 'Local changes · not published' : 'Derived from the active package'}
                </small>
              </span>
            </div>
            <div className="studio-editor-actions">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                onChange={(event) => void openFile(event.target.files?.[0])}
                aria-label="Open BuildingSource JSON"
              />
              <button type="button" onClick={() => fileInputRef.current?.click()}>
                <Upload size={14} />
                Open JSON
              </button>
              <button type="button" onClick={formatDraft} disabled={!validation.syntaxValid}>
                <Braces size={14} />
                Format
              </button>
              <button type="button" onClick={resetDraft} disabled={!dirty}>
                <RotateCcw size={14} />
                Reset
              </button>
            </div>
          </div>

          <div className="studio-editor-modebar" role="tablist" aria-label="Editor view">
            <button
              type="button"
              role="tab"
              aria-selected={editorMode === 'visual'}
              className={editorMode === 'visual' ? 'active' : ''}
              disabled={!validation.source}
              onClick={() => setEditorMode('visual')}
            >
              <MapIcon size={14} />
              Floor canvas
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={editorMode === 'json'}
              className={editorMode === 'json' ? 'active' : ''}
              onClick={() => setEditorMode('json')}
            >
              <Code2 size={14} />
              Source JSON
            </button>
            <span>
              {editorMode === 'visual'
                ? 'Space polygons only · reference layers are locked'
                : 'Canonical BuildingSource · advanced editing'}
            </span>
          </div>

          {editorMode === 'visual' && validation.source ? (
            <BuildingSourceFloorCanvas
              source={validation.source}
              canUndo={visualHistory.length > 0}
              dirty={dirty}
              onBeginEdit={beginVisualEdit}
              onSourceChange={applyVisualSource}
              onUndo={undoVisualEdit}
              onReset={resetDraft}
            />
          ) : (
            <>
              <textarea
                className="studio-source-editor"
                value={draftText}
                onChange={(event) => {
                  setDraftText(event.target.value);
                  setFileMessage(null);
                  setCompileError(null);
                  setRuntimeError(null);
                  setActivationArmed(false);
                  setVisualHistory([]);
                }}
                wrap="off"
                spellCheck={false}
                aria-label="BuildingSource JSON draft"
              />

              <footer className="studio-editor-status">
                <span>{lineCount.toLocaleString()} lines</span>
                <span>{draftText.length.toLocaleString()} characters</span>
                <span>Schema 0.1.0</span>
                {fileMessage && <strong>{fileMessage}</strong>}
              </footer>
            </>
          )}
        </section>

        <aside className="studio-validation-panel" aria-label="BuildingSource validation results">
          <section
            className={`studio-validation-hero ${validation.valid ? 'valid' : 'invalid'}`}
            aria-live="polite"
          >
            <div className="studio-validation-icon">
              {validation.valid ? <CheckCircle2 size={24} /> : <AlertTriangle size={24} />}
            </div>
            <div>
              <span>Live validation</span>
              <h2>{validationTitle(validation)}</h2>
              <p>{validationDescription(validation)}</p>
            </div>
          </section>

          <section className="studio-pipeline" aria-label="Venue creation pipeline">
            <div>
              <span>01</span>
              <strong>Importer</strong>
              <small>Future adapter boundary</small>
            </div>
            <div className="active">
              <span>02</span>
              <strong>BuildingSource</strong>
              <small>Current slice</small>
            </div>
            <div className={previewPackage && !previewStale ? 'active' : undefined}>
              <span>03</span>
              <strong>Compiler</strong>
              <small>
                {previewPackage && !previewStale ? 'Preview complete' : 'Current slice'}
              </small>
            </div>
            <div className={previewArtifact && !previewStale ? 'active' : undefined}>
              <span>04</span>
              <strong>VenuePackage</strong>
              <small>
                {previewArtifact && !previewStale ? 'Verified artifact' : 'Not generated yet'}
              </small>
            </div>
            <div className="active">
              <span>05</span>
              <strong>Runtime</strong>
              <small>
                {matchesActivePackage ? 'Preview is active' : 'Verified package active'}
              </small>
            </div>
          </section>

          <section className="studio-compile-section" aria-label="Compilation preview">
            <div className="studio-section-heading">
              <div>
                <span>Deterministic compiler</span>
                <h2>VenuePackage preview</h2>
              </div>
              <button
                type="button"
                className="studio-compile-button"
                onClick={() => void compileDraft()}
                disabled={!validation.valid || compiling}
              >
                <Play size={14} />
                {compiling ? 'Compiling…' : previewPackage ? 'Compile again' : 'Compile preview'}
              </button>
            </div>

            {!previewPackage && !compileError && (
              <div className="studio-compile-empty">
                <PackageCheck size={20} />
                <div>
                  <strong>No package preview yet</strong>
                  <p>
                    Compile a valid draft to generate routing topology, a validation report, and a
                    SHA-256 package hash.
                  </p>
                </div>
              </div>
            )}

            {compileError && (
              <div className="studio-compile-error" role="alert">
                <AlertTriangle size={17} />
                {compileError}
              </div>
            )}

            {previewPackage && (
              <div className={`studio-package-preview ${previewStale ? 'stale' : ''}`}>
                <div className="studio-package-hash">
                  <div>
                    <span>{previewStale ? 'Preview out of date' : 'SHA-256 content hash'}</span>
                    <code>{previewPackage.manifest.contentHash}</code>
                  </div>
                  {previewStale ? <AlertTriangle size={19} /> : <CheckCircle2 size={19} />}
                </div>
                <div className="studio-package-facts">
                  <div>
                    <PackageCheck size={14} />
                    <span>
                      Package
                      <strong>{previewPackage.packageVersion}</strong>
                    </span>
                  </div>
                  <div>
                    <Braces size={14} />
                    <span>
                      Compiler
                      <strong>{previewPackage.compilerVersion}</strong>
                    </span>
                  </div>
                  <div>
                    <Network size={14} />
                    <span>
                      Graph
                      <strong>
                        {previewPackage.routing.nodes.length} nodes ·{' '}
                        {previewPackage.routing.edges.length} edges
                      </strong>
                    </span>
                  </div>
                  <div>
                    <GitCompare size={14} />
                    <span>
                      Active package
                      <strong>{matchesActivePackage ? 'Exact hash match' : 'Draft differs'}</strong>
                    </span>
                  </div>
                </div>
                <p>
                  {previewStale
                    ? 'The draft changed after this preview. Compile again before trusting its hash.'
                    : `${compilePreview?.result.report.summary.errors ?? 0} errors · ${compilePreview?.result.report.summary.warnings ?? 0} warnings · preview remains local`}
                </p>

                {previewArtifact && (
                  <div className="studio-artifact-actions">
                    <button
                      type="button"
                      className="studio-download-button"
                      onClick={downloadArtifact}
                      disabled={previewStale}
                    >
                      <Download size={14} />
                      Download verified package
                    </button>
                    <details className="studio-artifact-review">
                      <summary>
                        <Eye size={14} />
                        Review artifact
                        <span>{formatArtifactSize(previewArtifact.byteLength)}</span>
                      </summary>
                      <div className="studio-artifact-meta">
                        <span>
                          File
                          <strong>{previewArtifact.fileName}</strong>
                        </span>
                        <span>
                          Runtime contract
                          <strong>Verified</strong>
                        </span>
                        <span>
                          Artifact SHA-256
                          <strong title={previewArtifact.artifactHash}>
                            {previewArtifact.artifactHash.slice(0, 12)}
                          </strong>
                        </span>
                      </div>
                      <pre tabIndex={0}>{previewArtifact.text}</pre>
                    </details>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="studio-runtime-section" aria-label="Runtime activation controls">
            <div className="studio-section-heading">
              <div>
                <span>Controlled runtime boundary</span>
                <h2>Activation and rollback</h2>
              </div>
              <span className={`studio-runtime-state ${runtimeStatus.state}`}>
                {runtimeStatus.state}
              </span>
            </div>

            <div className="studio-active-runtime">
              <ShieldCheck size={17} />
              <span>
                Active now
                <strong>{venue.buildingPackage.building.name}</strong>
              </span>
              <code title={venue.buildingPackage.manifest.contentHash}>
                {venue.buildingPackage.manifest.contentHash.slice(0, 12)}
              </code>
            </div>

            {rollbackCandidate && (
              <div className="studio-rollback-candidate">
                <History size={17} />
                <span>
                  One rollback available
                  <strong>{rollbackCandidate.buildingName}</strong>
                  <small>{rollbackCandidate.contentHash.slice(0, 12)}</small>
                </span>
                <button
                  type="button"
                  onClick={() => void rollbackRuntime()}
                  disabled={runtimeStatus.state === 'switching'}
                >
                  <RotateCcw size={13} />
                  Roll back
                </button>
              </div>
            )}

            {!previewPackage ? (
              <div className="studio-runtime-empty">
                <Power size={17} />
                Compile a valid draft to stage a verified runtime candidate.
              </div>
            ) : previewStale ? (
              <div className="studio-runtime-empty warning">
                <AlertTriangle size={17} />
                The compiled candidate is stale. Compile the current draft again.
              </div>
            ) : matchesActivePackage ? (
              <div className="studio-runtime-empty valid">
                <CheckCircle2 size={17} />
                This verified preview is already the active runtime package.
              </div>
            ) : (
              <div className="studio-staged-runtime">
                <div>
                  <PackageCheck size={17} />
                  <span>
                    Verified candidate
                    <strong>{previewPackage.building.name}</strong>
                    <small>{previewPackage.manifest.contentHash.slice(0, 12)}</small>
                  </span>
                  {!activationArmed && (
                    <button
                      type="button"
                      onClick={() => setActivationArmed(true)}
                      disabled={runtimeStatus.state === 'switching'}
                    >
                      Review activation
                    </button>
                  )}
                </div>

                {activationArmed && (
                  <div className="studio-activation-confirm" role="alert">
                    <AlertTriangle size={17} />
                    <div>
                      <strong>Activate this package now?</strong>
                      <p>
                        The runtime will reset its route, selected POI, active floor, closure
                        overlay, and localization session. The current package will be retained for
                        one rollback.
                      </p>
                      <span>
                        <button type="button" onClick={() => setActivationArmed(false)}>
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="confirm"
                          onClick={() => void activatePreview()}
                          disabled={runtimeStatus.state === 'switching'}
                        >
                          <Power size={13} />
                          {runtimeStatus.state === 'switching'
                            ? 'Activating…'
                            : 'Activate verified package'}
                        </button>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {(runtimeError || runtimeStatus.error) && (
              <div className="studio-runtime-error" role="alert">
                <AlertTriangle size={15} />
                {runtimeError ?? runtimeStatus.error}
              </div>
            )}
            <p className="studio-runtime-detail">{runtimeStatus.detail}</p>
          </section>

          <VenueVersionCatalogPanel
            catalog={versionCatalog}
            activeHash={venue.buildingPackage.manifest.contentHash}
            rollbackHash={rollbackCandidate?.contentHash ?? null}
          />

          <VenuePublishDryRunPanel
            key={previewPackage?.manifest.contentHash ?? 'no-preview'}
            candidatePackage={previewPackage}
            artifact={previewArtifact}
            catalog={versionCatalog}
            stale={previewStale}
          />

          {validation.stats && (
            <section className="studio-source-stats" aria-label="BuildingSource summary">
              {Object.entries(validation.stats).map(([label, value]) => (
                <div key={label}>
                  <strong>{value}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </section>
          )}

          <section className="studio-issues">
            <div className="studio-section-heading">
              <div>
                <span>Validation report</span>
                <h2>{validation.issues.length === 0 ? 'No issues' : 'Issues to resolve'}</h2>
              </div>
              <div className="studio-issue-counts">
                <span>{errorCount} errors</span>
                <span>{warningCount} warnings</span>
              </div>
            </div>

            {validation.issues.length === 0 ? (
              <div className="studio-empty-issues">
                <CheckCircle2 size={18} />
                Schema and deterministic semantic validation both passed.
              </div>
            ) : (
              <ol>
                {validation.issues.map((issue, index) => (
                  <li key={`${issue.stage}-${issue.code}-${issue.path}-${index}`}>
                    <span className={`studio-issue-severity ${issue.severity}`}>
                      {issue.severity}
                    </span>
                    <div>
                      <strong>{issue.code}</strong>
                      <code>{issue.path}</code>
                      <p>{issue.message}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}
