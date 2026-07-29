import { useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  FileCheck2,
  Network,
  ShieldCheck,
  TestTube2,
  UploadCloud,
} from 'lucide-react';
import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import type { VenueVersionCatalog } from '../data/venueVersionCatalog';
import { createPublishDryRun, type PublishDryRunArtifact } from '../studio/publishDryRun';
import type { VenuePackageArtifact } from '../studio/venuePackageArtifact';
import { formatArtifactSize } from '../studio/venuePackageArtifact';
import {
  InMemoryPublishTransport,
  PublishConflictError,
  executePublishPlan,
  type PublishExecutionReceipt,
} from '../studio/publishTransport';

interface VenuePublishDryRunPanelProps {
  candidatePackage: CompiledBuildingPackage | null;
  artifact: VenuePackageArtifact | null;
  catalog: VenueVersionCatalog | null;
  stale: boolean;
}

function localDateTimeValue() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function VenuePublishDryRunPanel({
  candidatePackage,
  artifact,
  catalog,
  stale,
}: VenuePublishDryRunPanelProps) {
  const [packageBaseUrl, setPackageBaseUrl] = useState('https://venues.example.com/releases');
  const [catalogUrl, setCatalogUrl] = useState('https://venues.example.com/catalog.json');
  const [status, setStatus] = useState<'preview' | 'stable'>('preview');
  const [publishedAt, setPublishedAt] = useState(localDateTimeValue);
  const [notes, setNotes] = useState(
    candidatePackage
      ? `Studio release candidate for ${candidatePackage.building.name}.`
      : 'Studio release candidate.',
  );
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PublishDryRunArtifact | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [simulationReceipt, setSimulationReceipt] = useState<PublishExecutionReceipt | null>(null);
  const [simulationError, setSimulationError] = useState<{
    message: string;
    stage: string | null;
    packageStored: boolean | null;
  } | null>(null);
  const transportRef = useRef<InMemoryPublishTransport | null>(null);

  const clearResult = () => {
    setResult(null);
    setError(null);
    setSimulationReceipt(null);
    setSimulationError(null);
    transportRef.current = null;
  };

  const generate = async () => {
    if (!candidatePackage || !artifact || !catalog || stale) return;
    setGenerating(true);
    setError(null);
    try {
      const nextResult = await createPublishDryRun(candidatePackage, artifact, catalog, {
        packageBaseUrl,
        catalogUrl,
        status,
        publishedAt,
        notes,
      });
      transportRef.current = await InMemoryPublishTransport.create(catalog);
      setSimulationReceipt(null);
      setSimulationError(null);
      setResult(nextResult);
    } catch (caught) {
      setResult(null);
      setError(caught instanceof Error ? caught.message : 'Could not generate publish dry run.');
    } finally {
      setGenerating(false);
    }
  };

  const runSimulation = async (forceConflict: boolean) => {
    if (!result || !artifact || !catalog) return;
    setSimulating(true);
    setSimulationReceipt(null);
    setSimulationError(null);
    try {
      const transport = transportRef.current ?? (await InMemoryPublishTransport.create(catalog));
      transportRef.current = transport;
      if (forceConflict) await transport.simulateConcurrentCatalogUpdate();
      setSimulationReceipt(await executePublishPlan(result, artifact, transport));
    } catch (caught) {
      setSimulationError({
        message: caught instanceof Error ? caught.message : 'Mock publish failed.',
        stage: caught instanceof PublishConflictError ? caught.stage : null,
        packageStored: caught instanceof PublishConflictError ? caught.packageStored : null,
      });
    } finally {
      setSimulating(false);
    }
  };

  const resetSimulator = async () => {
    if (!catalog) return;
    transportRef.current = await InMemoryPublishTransport.create(catalog);
    setSimulationReceipt(null);
    setSimulationError(null);
  };

  const download = () => {
    if (!result) return;
    const blob = new Blob([result.text], { type: result.mediaType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = result.fileName;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const unavailableReason = !candidatePackage
    ? 'Compile a valid draft before preparing a publish dry run.'
    : stale
      ? 'The compiled package is stale. Compile the current draft again.'
      : !catalog
        ? 'The version catalog is unavailable.'
        : null;

  return (
    <section className="studio-publish-dry-run" aria-label="Remote publishing dry run">
      <div className="studio-section-heading">
        <div>
          <span>Remote publishing v0</span>
          <h2>Publish dry run</h2>
        </div>
        <span className="studio-dry-run-badge">No network writes</span>
      </div>

      {unavailableReason ? (
        <div className={`studio-publish-unavailable ${stale ? 'warning' : ''}`}>
          {stale ? <AlertTriangle size={17} /> : <UploadCloud size={17} />}
          {unavailableReason}
        </div>
      ) : (
        <>
          <div className="studio-publish-form">
            <label>
              <span>Package destination</span>
              <input
                type="url"
                value={packageBaseUrl}
                onChange={(event) => {
                  setPackageBaseUrl(event.target.value);
                  clearResult();
                }}
                spellCheck={false}
              />
            </label>
            <label>
              <span>Catalog endpoint</span>
              <input
                type="url"
                value={catalogUrl}
                onChange={(event) => {
                  setCatalogUrl(event.target.value);
                  clearResult();
                }}
                spellCheck={false}
              />
            </label>
            <div className="studio-publish-form-row">
              <label>
                <span>Release status</span>
                <select
                  value={status}
                  onChange={(event) => {
                    setStatus(event.target.value as 'preview' | 'stable');
                    clearResult();
                  }}
                >
                  <option value="preview">Preview</option>
                  <option value="stable">Stable</option>
                </select>
              </label>
              <label>
                <span>Publication time</span>
                <input
                  type="datetime-local"
                  value={publishedAt}
                  onChange={(event) => {
                    setPublishedAt(event.target.value);
                    clearResult();
                  }}
                />
              </label>
            </div>
            <label>
              <span>Release notes</span>
              <textarea
                value={notes}
                maxLength={500}
                rows={2}
                onChange={(event) => {
                  setNotes(event.target.value);
                  clearResult();
                }}
              />
              <small>{notes.length}/500</small>
            </label>
            <button
              type="button"
              className="studio-generate-publish-plan"
              onClick={() => void generate()}
              disabled={generating || !notes.trim()}
            >
              <FileCheck2 size={14} />
              {generating ? 'Verifying…' : 'Generate dry run'}
            </button>
          </div>

          {error && (
            <div className="studio-publish-error" role="alert">
              <AlertTriangle size={15} />
              {error}
            </div>
          )}

          {result && (
            <div className="studio-publish-result">
              <div className="studio-publish-result-heading">
                <ShieldCheck size={18} />
                <span>
                  Verified plan generated
                  <strong>{result.plan.release.releaseId}</strong>
                </span>
                <button type="button" onClick={download}>
                  <Download size={13} />
                  Download
                </button>
              </div>

              <div className="studio-publish-safety">
                <span>
                  <Network size={12} /> 0 requests
                </span>
                <span>
                  <Database size={12} /> 0 writes
                </span>
                <span>
                  <ShieldCheck size={12} /> no credentials
                </span>
              </div>

              <ol className="studio-publish-operations">
                {result.plan.operations.map((operation) => (
                  <li key={operation.sequence}>
                    <b>{operation.sequence}</b>
                    <span>
                      <strong>
                        {operation.method} · {operation.type}
                      </strong>
                      <code>{operation.url}</code>
                    </span>
                    <i>not sent</i>
                  </li>
                ))}
              </ol>

              <div className="studio-publish-proposal">
                <span>
                  Catalog proposal
                  <strong>{result.plan.catalogProposal.action}</strong>
                </span>
                <span>
                  Default release
                  <strong>unchanged</strong>
                </span>
                <span>
                  Plan receipt
                  <strong>{result.planHash.slice(0, 12)}</strong>
                </span>
                <span>
                  Manifest
                  <strong>{formatArtifactSize(result.byteLength)}</strong>
                </span>
              </div>

              <details className="studio-publish-manifest">
                <summary>Review complete dry-run manifest</summary>
                <pre tabIndex={0}>{result.text}</pre>
              </details>

              <div className="studio-publish-simulator">
                <div className="studio-publish-simulator-heading">
                  <TestTube2 size={17} />
                  <span>
                    Local transport simulator
                    <small>Isolated memory · optimistic revision checks</small>
                  </span>
                </div>
                <div className="studio-publish-simulator-actions">
                  <button
                    type="button"
                    onClick={() => void runSimulation(false)}
                    disabled={simulating}
                  >
                    <UploadCloud size={13} />
                    {simulating ? 'Simulating…' : 'Run mock publish'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void runSimulation(true)}
                    disabled={simulating}
                  >
                    <AlertTriangle size={13} />
                    Simulate conflict
                  </button>
                  <button type="button" onClick={() => void resetSimulator()} disabled={simulating}>
                    Reset
                  </button>
                </div>

                {simulationReceipt && (
                  <div className="studio-simulation-receipt">
                    <CheckCircle2 size={16} />
                    <span>
                      <strong>{simulationReceipt.status}</strong>
                      {simulationReceipt.package.created
                        ? 'Immutable package stored in memory.'
                        : 'Matching package already existed.'}
                      {simulationReceipt.catalog.changed
                        ? ' Catalog revision committed.'
                        : ' Catalog remained unchanged.'}
                    </span>
                    <i>{simulationReceipt.visibility}</i>
                  </div>
                )}

                {simulationError && (
                  <div className="studio-simulation-conflict" role="alert">
                    <AlertTriangle size={16} />
                    <span>
                      <strong>{simulationError.message}</strong>
                      {simulationError.stage
                        ? `Blocked at ${simulationError.stage}; package stored: ${simulationError.packageStored ? 'yes' : 'no'}.`
                        : 'No simulated release was exposed.'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
