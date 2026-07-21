/// <reference lib="webworker" />

import { EDGES, NODES } from '../data/buildingGraph.js';
import { calculateRoute, type GraphEdge, type GraphNode, type RouteOptions } from './routingCore';

interface RouteRequest {
  type: 'COMPUTE_ROUTE';
  requestId: number;
  startId: string;
  endId: string;
  options?: RouteOptions;
}

const workerScope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = ({ data }: MessageEvent<RouteRequest>) => {
  if (data.type !== 'COMPUTE_ROUTE') return;

  try {
    const result = calculateRoute(
      data.startId,
      data.endId,
      NODES as GraphNode[],
      EDGES as GraphEdge[],
      data.options,
    );
    workerScope.postMessage({ type: 'ROUTE_RESULT', requestId: data.requestId, result });
  } catch (error) {
    workerScope.postMessage({
      type: 'ROUTE_ERROR',
      requestId: data.requestId,
      error: error instanceof Error ? error.message : 'Unknown routing error.',
    });
  }
};
