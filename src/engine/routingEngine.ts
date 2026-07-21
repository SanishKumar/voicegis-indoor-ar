import { EDGES, NODES } from '../data/buildingGraph.js';
import {
  STEP_TYPE,
  calculateRoute,
  type GraphEdge,
  type GraphNode,
  type RouteOptions,
  type RouteResult,
} from './routingCore';

export { STEP_TYPE };
export type { RouteOptions, RouteResult, RouteStep } from './routingCore';

interface WorkerResponse {
  requestId: number;
  result?: RouteResult;
  error?: string;
}

interface PendingRequest {
  resolve: (result: RouteResult) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

const REQUEST_TIMEOUT_MS = 10_000;
const pendingRequests = new Map<number, PendingRequest>();
let requestSequence = 0;
let routingWorker: Worker | null = null;

function failPendingRequests(message: string) {
  for (const request of pendingRequests.values()) {
    clearTimeout(request.timeoutId);
    request.resolve({ found: false, error: message });
  }
  pendingRequests.clear();
}

function getRoutingWorker() {
  if (routingWorker) return routingWorker;

  routingWorker = new Worker(new URL('./routing.worker.ts', import.meta.url), { type: 'module' });
  routingWorker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
    const request = pendingRequests.get(data.requestId);
    if (!request) return;

    clearTimeout(request.timeoutId);
    pendingRequests.delete(data.requestId);
    if (data.error) console.error('Routing worker response error:', data.error);
    request.resolve(data.result ?? { found: false, error: data.error ?? 'Routing failed.' });
  };
  routingWorker.onerror = (event) => {
    const message = event.message || 'The routing worker stopped unexpectedly.';
    console.error('Routing worker error:', message);
    failPendingRequests(message);
    routingWorker?.terminate();
    routingWorker = null;
  };

  return routingWorker;
}

export function findRoute(
  startId: string,
  endId: string,
  options: RouteOptions = {},
): Promise<RouteResult> {
  if (typeof Worker === 'undefined') {
    return Promise.resolve(
      calculateRoute(startId, endId, NODES as GraphNode[], EDGES as GraphEdge[], options),
    );
  }

  const worker = getRoutingWorker();
  const requestId = ++requestSequence;

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      pendingRequests.delete(requestId);
      resolve({ found: false, error: 'Route calculation timed out.' });
    }, REQUEST_TIMEOUT_MS);

    pendingRequests.set(requestId, { resolve, timeoutId });
    worker.postMessage({ type: 'COMPUTE_ROUTE', requestId, startId, endId, options });
  });
}

export function shutdownRoutingWorker() {
  failPendingRequests('Routing was cancelled.');
  routingWorker?.terminate();
  routingWorker = null;
}

export function getStepIcon(stepType: string) {
  switch (stepType) {
    case STEP_TYPE.START:
      return 'circle-dot';
    case STEP_TYPE.STRAIGHT:
      return 'arrow-up';
    case STEP_TYPE.TURN_LEFT:
      return 'corner-up-left';
    case STEP_TYPE.TURN_RIGHT:
      return 'corner-up-right';
    case STEP_TYPE.SLIGHT_LEFT:
      return 'arrow-up-left';
    case STEP_TYPE.SLIGHT_RIGHT:
      return 'arrow-up-right';
    case STEP_TYPE.U_TURN:
      return 'u-turn-left';
    case STEP_TYPE.ARRIVE:
      return 'map-pin';
    default:
      return 'arrow-up';
  }
}
