/// <reference lib="webworker" />

import { calculateCompiledRoute, type CompiledRouteOptions } from './compiledRoutePolicy';

interface RouteRequest {
  type: 'COMPUTE_ROUTE';
  requestId: number;
  startId: string;
  endId: string;
  options?: CompiledRouteOptions;
}

const workerScope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = ({ data }: MessageEvent<RouteRequest>) => {
  if (data.type !== 'COMPUTE_ROUTE') return;

  try {
    const result = calculateCompiledRoute(data.startId, data.endId, data.options);
    workerScope.postMessage({ type: 'ROUTE_RESULT', requestId: data.requestId, result });
  } catch (error) {
    workerScope.postMessage({
      type: 'ROUTE_ERROR',
      requestId: data.requestId,
      error: error instanceof Error ? error.message : 'Unknown routing error.',
    });
  }
};
