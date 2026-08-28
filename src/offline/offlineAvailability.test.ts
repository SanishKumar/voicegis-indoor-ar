/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageChannel as NodeMessageChannel, type MessagePort } from 'node:worker_threads';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('offline availability', () => {
  it('settles online-only when a first install becomes redundant without reading ready', async () => {
    const candidate = new EventTarget() as EventTarget & { state: ServiceWorkerState };
    candidate.state = 'installing';
    const registration = new EventTarget() as EventTarget & {
      active: ServiceWorker | null;
      waiting: ServiceWorker | null;
      installing: ServiceWorker | null;
    };
    registration.active = null;
    registration.waiting = null;
    registration.installing = candidate as unknown as ServiceWorker;

    const serviceWorkers = new EventTarget() as EventTarget & {
      controller: ServiceWorker | null;
      register: ReturnType<typeof vi.fn>;
    };
    serviceWorkers.controller = null;
    serviceWorkers.register = vi.fn().mockResolvedValue(registration);
    Object.defineProperty(serviceWorkers, 'ready', {
      get: () => {
        throw new Error('ready must not be read on the installation-failure path');
      },
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: serviceWorkers,
    });

    const { getOfflineAvailability, registerOfflineWorker } = await import('./offlineAvailability');
    const registrationResult = registerOfflineWorker();
    await vi.waitFor(() => expect(serviceWorkers.register).toHaveBeenCalledOnce());
    candidate.state = 'redundant';
    candidate.dispatchEvent(new Event('statechange'));

    await expect(registrationResult).resolves.toBeUndefined();
    expect(getOfflineAvailability()).toBe('online-only');
  });

  it('does not accept a successful cache reply from a worker that lost ownership', async () => {
    vi.stubGlobal('MessageChannel', NodeMessageChannel);
    const replyPort = { current: null as MessagePort | null };
    const worker = {
      state: 'activated' as const,
      postMessage: vi.fn((_message: unknown, ports: MessagePort[]) => {
        [replyPort.current] = ports;
      }),
    } as unknown as ServiceWorker;
    const registration = new EventTarget() as EventTarget & {
      active: ServiceWorker | null;
      waiting: ServiceWorker | null;
      installing: ServiceWorker | null;
    };
    registration.active = worker;
    registration.waiting = null;
    registration.installing = null;
    const serviceWorkers = new EventTarget() as EventTarget & {
      controller: ServiceWorker | null;
      register: ReturnType<typeof vi.fn>;
    };
    serviceWorkers.controller = worker;
    serviceWorkers.register = vi.fn().mockResolvedValue(registration);
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: serviceWorkers,
    });

    const { getOfflineAvailability, registerOfflineWorker } = await import('./offlineAvailability');
    const registrationResult = registerOfflineWorker();
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce());

    registration.active = null;
    serviceWorkers.controller = null;
    serviceWorkers.dispatchEvent(new Event('controllerchange'));
    expect(getOfflineAvailability()).toBe('online-only');

    replyPort.current?.postMessage({ type: 'voicegis:offline-cache-status', complete: true });
    await expect(registrationResult).resolves.toBeUndefined();
    expect(getOfflineAvailability()).toBe('online-only');
    replyPort.current?.close();
  });
});
