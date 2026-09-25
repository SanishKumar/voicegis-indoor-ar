import { APP_BASE, appPath } from '../appPath';

export type OfflineAvailability = 'preparing' | 'available' | 'online-only';

let availability: OfflineAvailability = 'online-only';
const listeners = new Set<() => void>();
let activeRegistration: ServiceWorkerRegistration | null = null;
let activeWorker: ServiceWorker | null = null;
let refreshGeneration = 0;
let lifecycleListenersInstalled = false;
let observedRegistration: ServiceWorkerRegistration | null = null;

function publish(next: OfflineAvailability) {
  availability = next;
  listeners.forEach((listener) => listener());
}

export function getOfflineAvailability(): OfflineAvailability {
  return availability;
}

export function subscribeOfflineAvailability(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function verifyWorkerCache(worker: ServiceWorker): Promise<boolean> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let settled = false;
    let timeout = 0;
    const finish = (complete: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      channel.port1.close();
      resolve(complete);
    };
    timeout = window.setTimeout(() => finish(false), 5_000);
    channel.port1.onmessage = (event) => {
      if (event.data?.type !== 'voicegis:offline-cache-status') return;
      finish(event.data.complete === true);
    };
    try {
      worker.postMessage({ type: 'voicegis:verify-offline-cache' }, [channel.port2]);
    } catch {
      finish(false);
    }
  });
}

export async function refreshOfflineAvailability(): Promise<void> {
  // Supersede every older check, including when this one discovers there is no
  // worker. Otherwise an in-flight reply from a worker that just lost
  // ownership can overwrite `online-only` with a stale `available` result.
  const generation = ++refreshGeneration;
  const worker =
    activeWorker ?? activeRegistration?.active ?? navigator.serviceWorker.controller ?? null;
  if (worker === null) {
    if (generation === refreshGeneration) publish('online-only');
    return;
  }
  const complete = await verifyWorkerCache(worker);
  if (generation === refreshGeneration) publish(complete ? 'available' : 'online-only');
}

/**
 * Waits for this registration's worker, without relying on
 * `navigator.serviceWorker.ready`.
 *
 * `ready` intentionally remains pending until an active worker exists. That is
 * useful to application code that cannot proceed without a controller, but it
 * is the wrong failure primitive for installation UI: if a precache response
 * has the wrong digest, installation becomes redundant and `ready` may never
 * settle. A failed first install must become `online-only`, not an eternal
 * "preparing" state.
 */
export function waitForActivatedWorker(
  registration: ServiceWorkerRegistration,
  timeoutMs = 10_000,
): Promise<ServiceWorker | null> {
  if (registration.active !== null) return Promise.resolve(registration.active);

  return new Promise((resolve) => {
    let settled = false;
    let candidate: ServiceWorker | null = null;
    let timeout = 0;

    const finish = (worker: ServiceWorker | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      registration.removeEventListener('updatefound', inspect);
      candidate?.removeEventListener('statechange', inspect);
      resolve(worker);
    };

    const inspect = () => {
      if (registration.active !== null) {
        finish(registration.active);
        return;
      }

      const next = registration.waiting ?? registration.installing;
      if (next !== candidate) {
        candidate?.removeEventListener('statechange', inspect);
        candidate = next;
        candidate?.addEventListener('statechange', inspect);
      }
      if (candidate?.state === 'activated') finish(candidate);
      else if (candidate?.state === 'redundant') finish(null);
    };

    registration.addEventListener('updatefound', inspect);
    timeout = window.setTimeout(() => finish(null), timeoutMs);
    inspect();
  });
}

function observeRegistration(registration: ServiceWorkerRegistration) {
  if (observedRegistration === registration) return;
  observedRegistration = registration;

  const observeCandidate = () => {
    const candidate = registration.installing ?? registration.waiting;
    if (candidate === null) return;
    const handleState = () => {
      if (candidate.state !== 'activated') return;
      candidate.removeEventListener('statechange', handleState);
      activeWorker = registration.active ?? candidate;
      void refreshOfflineAvailability();
    };
    candidate.addEventListener('statechange', handleState);
  };

  registration.addEventListener('updatefound', observeCandidate);
  observeCandidate();
}

function installLifecycleListeners() {
  if (lifecycleListenersInstalled) return;
  lifecycleListenersInstalled = true;
  const refresh = () => void refreshOfflineAvailability();
  window.addEventListener('online', refresh);
  window.addEventListener('offline', refresh);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    activeWorker = navigator.serviceWorker.controller ?? activeRegistration?.active ?? null;
    refresh();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });
}

/**
 * Installs the generated public-shell worker.
 *
 * Registration is called only by the `public` production build. Development
 * and the operator build report `online-only`; neither silently installs a
 * worker whose cache could outlive the surface being tested.
 */
export async function registerOfflineWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    publish('online-only');
    return;
  }

  publish('preparing');
  try {
    const registration = await navigator.serviceWorker.register(appPath('/sw.js'), {
      scope: APP_BASE,
      updateViaCache: 'none',
    });
    activeRegistration = registration;
    observeRegistration(registration);
    installLifecycleListeners();
    activeWorker = await waitForActivatedWorker(registration);
    if (activeWorker === null) {
      publish('online-only');
      return;
    }
    await refreshOfflineAvailability();
  } catch {
    publish('online-only');
  }
}
