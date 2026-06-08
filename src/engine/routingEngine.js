/**
 * routingEngine.js
 * 
 * Client-side A* pathfinding for indoor navigation.
 * Operates on the building graph and generates turn-by-turn directions.
 * 
 * Performance: For a ~30 node graph, routing completes in <1ms.
 * 
 * @module engine/routingEngine
 */

import { NODES, EDGES, buildAdjacencyList, getNodeById } from '../data/buildingGraph.js';

/** Direction/step types */
export const STEP_TYPE = {
  START: 'start',
  STRAIGHT: 'straight',
  TURN_LEFT: 'turn_left',
  TURN_RIGHT: 'turn_right',
  SLIGHT_LEFT: 'slight_left',
  SLIGHT_RIGHT: 'slight_right',
  U_TURN: 'u_turn',
  ARRIVE: 'arrive',
};

// Pre-build the adjacency list (singleton)
let _adjacencyList = null;
function getAdjacencyList() {
  if (!_adjacencyList) {
    _adjacencyList = buildAdjacencyList();
  }
  return _adjacencyList;
}

/**
 * Calculate Euclidean distance between two nodes (heuristic for A*).
 */
function heuristic(nodeA, nodeB) {
  const dx = nodeA.x - nodeB.x;
  const dy = nodeA.y - nodeB.y;
  return Math.sqrt(dx * dx + dy * dy) * 0.15; // Scale to approximate meters
}

/**
 * Calculate bearing angle from node A to node B (in degrees, 0=up/north, clockwise).
 */
function getBearing(fromNode, toNode) {
  const dx = toNode.x - fromNode.x;
  const dy = -(toNode.y - fromNode.y); // SVG Y is inverted
  let angle = Math.atan2(dx, dy) * (180 / Math.PI);
  if (angle < 0) angle += 360;
  return angle;
}

/**
 * Determine the turn direction given previous bearing and new bearing.
 */
function getTurnType(prevBearing, newBearing) {
  let diff = newBearing - prevBearing;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;

  if (Math.abs(diff) < 20) return STEP_TYPE.STRAIGHT;
  if (diff >= 20 && diff < 60) return STEP_TYPE.SLIGHT_RIGHT;
  if (diff >= 60 && diff <= 150) return STEP_TYPE.TURN_RIGHT;
  if (diff >= -60 && diff < -20) return STEP_TYPE.SLIGHT_LEFT;
  if (diff >= -150 && diff < -60) return STEP_TYPE.TURN_LEFT;
  return STEP_TYPE.U_TURN;
}

/**
 * A* pathfinding algorithm.
 * 
 * @param {string} startId - Starting node ID
 * @param {string} endId - Destination node ID
 * @returns {{ 
 *   path: Array<object>, 
 *   pathIds: string[], 
 *   totalDistance: number, 
 *   steps: Array<object>,
 *   found: boolean 
 * }}
 */
export function findRoute(startId, endId) {
  return new Promise((resolve, reject) => {
    if (!startId || !endId || startId === endId) {
      resolve({ found: false, error: 'Invalid start or end node.' });
      return;
    }

    // Convert map to plain object for serialization to the worker
    const adjMap = getAdjacencyList();
    const adjObj = {};
    for (const [key, val] of adjMap.entries()) {
      adjObj[key] = val;
    }

    // Initialize worker
    const worker = new Worker(new URL('./routing.worker.js', import.meta.url), { type: 'module' });

    worker.onmessage = (e) => {
      const { type, result, error } = e.data;
      if (type === 'ROUTE_RESULT') {
        resolve(result);
      } else if (type === 'ROUTE_ERROR') {
        resolve({ found: false, error });
      }
      worker.terminate();
    };

    worker.onerror = (err) => {
      console.error('Routing worker error:', err);
      resolve({ found: false, error: 'Worker error occurred.' });
      worker.terminate();
    };

    // Dispatch payload
    worker.postMessage({
      type: 'COMPUTE_ROUTE',
      startId,
      endId,
      nodes: NODES,
      edges: EDGES,
      adjacencyList: adjObj
    });
  });
}

/**
 * Generate human-readable turn-by-turn steps from a path.
 * 
 * @param {Array<object>} path - Array of node objects
 * @param {number} totalDistance - Total route distance
 * @returns {Array<{ type: string, instruction: string, distance: number, nodeId: string, bearing: number }>}
 */
function generateSteps(path, totalDistance) {
  if (path.length < 2) {
    return [{ type: STEP_TYPE.ARRIVE, instruction: 'You have arrived', distance: 0, nodeId: path[0]?.id }];
  }

  const steps = [];
  const adj = getAdjacencyList();
  let prevBearing = null;
  let accumulatedDistance = 0;

  // Start step
  const startPoi = path[0].poi;
  const firstBearing = getBearing(path[0], path[1]);
  steps.push({
    type: STEP_TYPE.START,
    instruction: `Start at ${startPoi?.name || 'your location'}`,
    distance: 0,
    nodeId: path[0].id,
    bearing: firstBearing,
  });

  for (let i = 0; i < path.length - 1; i++) {
    const currentNode = path[i];
    const nextNode = path[i + 1];
    const bearing = getBearing(currentNode, nextNode);

    // Find edge distance
    const neighbors = adj.get(currentNode.id) || [];
    const edge = neighbors.find(n => n.to === nextNode.id);
    const segmentDistance = edge ? edge.distance : heuristic(currentNode, nextNode);
    accumulatedDistance += segmentDistance;

    // Determine turn type
    if (prevBearing !== null) {
      const turnType = getTurnType(prevBearing, bearing);

      // Only emit a step if there's a turn or we're at a POI
      if (turnType !== STEP_TYPE.STRAIGHT || nextNode.type === 'poi') {
        if (turnType !== STEP_TYPE.STRAIGHT) {
          const corridor = edge?.corridor || '';
          steps.push({
            type: turnType,
            instruction: formatTurnInstruction(turnType, corridor, nextNode),
            distance: accumulatedDistance,
            nodeId: currentNode.id,
            bearing,
          });
          accumulatedDistance = 0;
        }
      }
    }

    prevBearing = bearing;
  }

  // Arrival step
  const destNode = path[path.length - 1];
  steps.push({
    type: STEP_TYPE.ARRIVE,
    instruction: `Arrive at ${destNode.poi?.name || 'destination'}`,
    distance: accumulatedDistance,
    nodeId: destNode.id,
    bearing: prevBearing || 0,
  });

  return steps;
}

/**
 * Format a turn instruction into a human-readable string.
 */
function formatTurnInstruction(turnType, corridor, nextNode) {
  const directionWord = {
    [STEP_TYPE.TURN_LEFT]: 'Turn left',
    [STEP_TYPE.TURN_RIGHT]: 'Turn right',
    [STEP_TYPE.SLIGHT_LEFT]: 'Bear left',
    [STEP_TYPE.SLIGHT_RIGHT]: 'Bear right',
    [STEP_TYPE.U_TURN]: 'Turn around',
    [STEP_TYPE.STRAIGHT]: 'Continue straight',
  }[turnType] || 'Continue';

  if (nextNode.poi) {
    return `${directionWord} toward ${nextNode.poi.name}`;
  }
  if (corridor) {
    return `${directionWord} onto ${corridor}`;
  }
  return directionWord;
}

/**
 * Get the icon for a step type (for UI display).
 */
export function getStepIcon(stepType) {
  switch (stepType) {
    case STEP_TYPE.START: return 'circle-dot';
    case STEP_TYPE.STRAIGHT: return 'arrow-up';
    case STEP_TYPE.TURN_LEFT: return 'corner-up-left';
    case STEP_TYPE.TURN_RIGHT: return 'corner-up-right';
    case STEP_TYPE.SLIGHT_LEFT: return 'arrow-up-left';
    case STEP_TYPE.SLIGHT_RIGHT: return 'arrow-up-right';
    case STEP_TYPE.U_TURN: return 'u-turn-left';
    case STEP_TYPE.ARRIVE: return 'map-pin';
    default: return 'arrow-up';
  }
}
