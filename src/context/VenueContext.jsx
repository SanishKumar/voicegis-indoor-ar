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
import { loadVenuePackageFromFile, loadVenuePackageFromUrl } from '../data/venuePackageContract';

const VenueContext = createContext(null);
const CATALOG_URL = '/venues/catalog.json';
const ACTIVE_VENUE_URL_KEY = 'voicegis_active_venue_url';

async function loadCatalog() {
  const response = await fetch(CATALOG_URL, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Venue catalog request failed (${response.status}).`);
  const value = await response.json();
  if (
    !value ||
    value.catalogVersion !== '0.1.0' ||
    typeof value.defaultVenueId !== 'string' ||
    !Array.isArray(value.venues)
  ) {
    throw new Error('Venue catalog does not match catalogVersion 0.1.0.');
  }
  return value;
}

export function VenueProvider({ children }) {
  const [venue, setVenue] = useState(null);
  const [catalog, setCatalog] = useState([]);
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
  const activationSequence = useRef(0);

  const activatePackage = useCallback(async (buildingPackage, source, sequence) => {
    const cacheStatus = await cacheAndActivateVenuePackage(buildingPackage);
    if (sequence !== activationSequence.current) return null;

    const runtime = createCompiledBuildingRuntime(buildingPackage);
    setPackageCacheStatus(cacheStatus);
    setVenue(runtime);
    setStatus({
      state: 'ready',
      source,
      detail: `${buildingPackage.building.name} is active.`,
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
          localStorage.setItem(ACTIVE_VENUE_URL_KEY, url);
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
        return await activatePackage(buildingPackage, source, sequence);
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

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const nextCatalog = await loadCatalog();
        if (!mounted) return;
        setCatalog(nextCatalog.venues);
        const queryVenueUrl = new URLSearchParams(window.location.search).get('venue');
        const storedVenueUrl = localStorage.getItem(ACTIVE_VENUE_URL_KEY);
        const defaultVenue = nextCatalog.venues.find(
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
      status,
      packageCacheStatus,
      activateFromUrl,
      activateFromFile,
    }),
    [activateFromFile, activateFromUrl, catalog, packageCacheStatus, status, venue],
  );

  return <VenueContext.Provider value={value}>{children}</VenueContext.Provider>;
}

export function useVenue() {
  const context = useContext(VenueContext);
  if (!context) throw new Error('useVenue must be used within a VenueProvider');
  return context;
}
