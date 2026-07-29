import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createCompiledBuildingRuntime } from '../data/compiledBuilding';
import { cacheAndActivateVenuePackage } from '../data/packageCacheRuntime';
import {
  loadVenuePackageFromFile,
  loadVenuePackageFromUrl,
  verifyVenuePackage,
} from '../data/venuePackageContract';
import {
  consumeRuntimeRollback,
  createRuntimeActivationHistory,
  recordRuntimeActivation,
  summarizeRuntimePackage,
} from '../data/runtimeActivationHistory';
import { createRuntimeCatalogEntries, parseVenueVersionCatalog } from '../data/venueVersionCatalog';

const VenueContext = createContext(null);
const CATALOG_URL = '/venues/catalog.json';
const ACTIVE_VENUE_URL_KEY = 'voicegis_active_venue_url';

function persistRuntimeSource(source) {
  if (typeof localStorage === 'undefined') return;
  if (/^(https?:)?\/\//.test(source) || source.startsWith('/')) {
    localStorage.setItem(ACTIVE_VENUE_URL_KEY, source);
  } else {
    localStorage.removeItem(ACTIVE_VENUE_URL_KEY);
  }
}

async function loadCatalog() {
  const response = await fetch(CATALOG_URL, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Venue catalog request failed (${response.status}).`);
  return parseVenueVersionCatalog(await response.json());
}

export function VenueProvider({ children }) {
  const [venue, setVenue] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [versionCatalog, setVersionCatalog] = useState(null);
  const [status, setStatus] = useState({
    state: 'loading',
    source: null,
    detail: 'Loading the venue catalog.',
    error: null,
  });
  const [packageCacheStatus, setPackageCacheStatus] = useState({
    state: 'unavailable',
    buildingId: null,
    activeHash: null,
    previousHash: null,
    detail: 'No VenuePackage has been activated.',
  });
  const [rollbackCandidate, setRollbackCandidate] = useState(null);
  const activationSequence = useRef(0);
  const activationHistory = useRef(createRuntimeActivationHistory());

  const activatePackage = useCallback(async (buildingPackage, source, sequence, options = {}) => {
    const cacheStatus = await cacheAndActivateVenuePackage(buildingPackage);
    if (sequence !== activationSequence.current) return null;

    const runtime = createCompiledBuildingRuntime(buildingPackage);
    const nextHistory =
      options.history ??
      recordRuntimeActivation(activationHistory.current, { buildingPackage, source });
    activationHistory.current = nextHistory;
    setRollbackCandidate(summarizeRuntimePackage(nextHistory.rollback));
    setPackageCacheStatus(cacheStatus);
    setVenue(runtime);
    setStatus({
      state: 'ready',
      source,
      detail: options.detail ?? `${buildingPackage.building.name} is active.`,
      error: null,
    });
    return runtime;
  }, []);

  const activateFromUrl = useCallback(
    async (url, options = {}) => {
      const sequence = ++activationSequence.current;
      setStatus((current) => ({
        ...current,
        state: current.state === 'ready' ? 'switching' : 'loading',
        source: url,
        detail: 'Loading and verifying the VenuePackage.',
        error: null,
      }));
      try {
        const buildingPackage = await loadVenuePackageFromUrl(url);
        if (sequence !== activationSequence.current) return null;
        const runtime = await activatePackage(buildingPackage, url, sequence);
        if (runtime && options.persist !== false && typeof localStorage !== 'undefined') {
          persistRuntimeSource(url);
        }
        return runtime;
      } catch (error) {
        if (sequence !== activationSequence.current) return null;
        setStatus((current) => ({
          ...current,
          state: current.state === 'switching' || current.state === 'ready' ? 'ready' : 'error',
          detail:
            current.state === 'switching' || current.state === 'ready'
              ? 'Activation rejected; the current venue remains active.'
              : 'No VenuePackage could be activated.',
          error: error instanceof Error ? error.message : 'VenuePackage activation failed.',
        }));
        throw error;
      }
    },
    [activatePackage],
  );

  const activateFromFile = useCallback(
    async (file) => {
      const sequence = ++activationSequence.current;
      const source = `file:${file.name}`;
      setStatus((current) => ({
        ...current,
        state: current.state === 'ready' ? 'switching' : 'loading',
        source,
        detail: 'Loading and verifying the VenuePackage.',
        error: null,
      }));
      try {
        const buildingPackage = await loadVenuePackageFromFile(file);
        if (sequence !== activationSequence.current) return null;
        const runtime = await activatePackage(buildingPackage, source, sequence);
        if (runtime) persistRuntimeSource(source);
        return runtime;
      } catch (error) {
        if (sequence !== activationSequence.current) return null;
        setStatus((current) => ({
          ...current,
          state: current.state === 'switching' || current.state === 'ready' ? 'ready' : 'error',
          detail:
            current.state === 'switching' || current.state === 'ready'
              ? 'Activation rejected; the current venue remains active.'
              : 'No VenuePackage could be activated.',
          error: error instanceof Error ? error.message : 'VenuePackage activation failed.',
        }));
        throw error;
      }
    },
    [activatePackage],
  );

  const activateVerifiedPackage = useCallback(
    async (candidatePackage, sourceLabel = 'studio:compiled-preview') => {
      const sequence = ++activationSequence.current;
      setStatus((current) => ({
        ...current,
        state: current.state === 'ready' ? 'switching' : 'loading',
        source: sourceLabel,
        detail: 'Verifying the compiled package before runtime activation.',
        error: null,
      }));
      try {
        const buildingPackage = await verifyVenuePackage(candidatePackage);
        if (sequence !== activationSequence.current) return null;
        const source = `${sourceLabel}:${buildingPackage.manifest.contentHash}`;
        const runtime = await activatePackage(buildingPackage, source, sequence, {
          detail: `${buildingPackage.building.name} was activated from a verified Studio preview.`,
        });
        if (runtime) persistRuntimeSource(source);
        return runtime;
      } catch (error) {
        if (sequence !== activationSequence.current) return null;
        setStatus((current) => ({
          ...current,
          state: current.state === 'switching' || current.state === 'ready' ? 'ready' : 'error',
          detail:
            current.state === 'switching' || current.state === 'ready'
              ? 'Studio activation rejected; the current venue remains active.'
              : 'No VenuePackage could be activated.',
          error: error instanceof Error ? error.message : 'Studio activation failed.',
        }));
        throw error;
      }
    },
    [activatePackage],
  );

  const rollbackRuntimePackage = useCallback(async () => {
    const rollbackHistory = consumeRuntimeRollback(activationHistory.current);
    const candidate = rollbackHistory.active;
    if (!candidate) throw new Error('No previous runtime package is available.');

    const sequence = ++activationSequence.current;
    setStatus((current) => ({
      ...current,
      state: current.state === 'ready' ? 'switching' : 'loading',
      source: candidate.source,
      detail: 'Re-verifying the previous package before rollback.',
      error: null,
    }));
    try {
      const buildingPackage = await verifyVenuePackage(candidate.buildingPackage);
      if (sequence !== activationSequence.current) return null;
      const verifiedHistory = {
        active: { ...candidate, buildingPackage },
        rollback: null,
      };
      const runtime = await activatePackage(buildingPackage, candidate.source, sequence, {
        history: verifiedHistory,
        detail: `${buildingPackage.building.name} was restored from the rollback package.`,
      });
      if (runtime) persistRuntimeSource(candidate.source);
      return runtime;
    } catch (error) {
      if (sequence !== activationSequence.current) return null;
      setStatus((current) => ({
        ...current,
        state: current.state === 'switching' || current.state === 'ready' ? 'ready' : 'error',
        detail:
          current.state === 'switching' || current.state === 'ready'
            ? 'Rollback rejected; the current venue remains active.'
            : 'No VenuePackage could be activated.',
        error: error instanceof Error ? error.message : 'VenuePackage rollback failed.',
      }));
      throw error;
    }
  }, [activatePackage]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const nextCatalog = await loadCatalog();
        if (!mounted) return;
        const runtimeCatalog = createRuntimeCatalogEntries(nextCatalog);
        setVersionCatalog(nextCatalog);
        setCatalog(runtimeCatalog);
        const queryVenueUrl = new URLSearchParams(window.location.search).get('venue');
        const storedVenueUrl = localStorage.getItem(ACTIVE_VENUE_URL_KEY);
        const defaultVenue = runtimeCatalog.find(
          (candidate) => candidate.id === nextCatalog.defaultVenueId,
        );
        const packageUrl = queryVenueUrl || storedVenueUrl || defaultVenue?.packageUrl;
        if (!packageUrl) throw new Error('Venue catalog has no loadable default package.');
        await activateFromUrl(packageUrl, { persist: false });
      } catch (error) {
        if (!mounted) return;
        setStatus({
          state: 'error',
          source: null,
          detail: 'No VenuePackage could be activated.',
          error: error instanceof Error ? error.message : 'Venue bootstrap failed.',
        });
      }
    })();
    return () => {
      mounted = false;
      activationSequence.current += 1;
    };
  }, [activateFromUrl]);

  const value = useMemo(
    () => ({
      venue,
      catalog,
      versionCatalog,
      status,
      packageCacheStatus,
      rollbackCandidate,
      activateFromUrl,
      activateFromFile,
      activateVerifiedPackage,
      rollbackRuntimePackage,
    }),
    [
      activateFromFile,
      activateFromUrl,
      activateVerifiedPackage,
      catalog,
      packageCacheStatus,
      rollbackCandidate,
      rollbackRuntimePackage,
      status,
      venue,
      versionCatalog,
    ],
  );

  return <VenueContext.Provider value={value}>{children}</VenueContext.Provider>;
}

export function useVenue() {
  const context = useContext(VenueContext);
  if (!context) throw new Error('useVenue must be used within a VenueProvider');
  return context;
}
