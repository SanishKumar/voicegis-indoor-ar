/// <reference lib="webworker" />

import { calculateCompiledRoute, type CompiledRouteOptions } from './compiledRoutePolicy';
import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import { createCompiledBuildingRuntime } from '../data/compiledBuilding';

interface RouteRequest {
  type: 'COMPUTE_ROUTE';
  requestId: number;
  buildingPackage: CompiledBuildingPackage;
  startId: string;
  endId: string;
  options?: CompiledRouteOptions;
}

const workerScope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = ({ data }: MessageEvent<RouteRequest>) => {
  if (data.type !== 'COMPUTE_ROUTE') return;

  try {
    const venue = createCompiledBuildingRuntime(data.buildingPackage);
    const result = calculateCompiledRoute(venue, data.startId, data.endId, data.options);
    workerScope.postMessage({ type: 'ROUTE_RESULT', requestId: data.requestId, result });
  } catch (error) {
    workerScope.postMessage({
      type: 'ROUTE_ERROR',
      requestId: data.requestId,
      error: error instanceof Error ? error.message : 'Unknown routing error.',
    });
  }
};
