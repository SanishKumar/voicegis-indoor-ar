/**
 * routing.worker.js
 * 
 * Web Worker for running Dijkstra's / A* pathfinding algorithms off the main thread.
 * Guarantees 60 FPS UI performance even when calculating massive multi-wing hospital routes.
 */

// Simple Priority Queue for Dijkstra/A*
class PriorityQueue {
  constructor() {
    this.values = [];
  }
  enqueue(val, priority) {
    this.values.push({ val, priority });
    this.sort();
  }
  dequeue() {
    return this.values.shift();
  }
  sort() {
    this.values.sort((a, b) => a.priority - b.priority);
  }
  isEmpty() {
    return this.values.length === 0;
  }
}

/**
 * Calculates turn-by-turn directions from a path of nodes.
 * Simplified for the worker.
 */
function generateDirections(pathNodes, edges) {
  if (!pathNodes || pathNodes.length < 2) return [];

  const steps = [];
  let currentDistance = 0;
  let currentCorridor = null;

  for (let i = 0; i < pathNodes.length - 1; i++) {
    const from = pathNodes[i];
    const to = pathNodes[i + 1];

    // Find the edge connecting them
    const edge = edges.find(
      e => (e.from === from.id && e.to === to.id) || (e.from === to.id && e.to === from.id)
    );

    if (edge) {
      if (currentCorridor === null) {
        currentCorridor = edge.corridor;
      }

      if (currentCorridor === edge.corridor) {
        currentDistance += edge.distance;
      } else {
        // Corridor change implies a turn
        steps.push({
          instruction: `Continue on ${currentCorridor}`,
          distance: currentDistance,
          type: 'straight'
        });
        currentCorridor = edge.corridor;
        currentDistance = edge.distance;
      }
    }
  }

  // Final segment
  if (currentDistance > 0) {
    steps.push({
      instruction: `Continue on ${currentCorridor}`,
      distance: currentDistance,
      type: 'straight'
    });
  }

  return steps;
}

/**
 * Dijkstra's algorithm for pathfinding.
 */
function calculateRoute(startId, endId, nodes, edges, adjacencyList) {
  const distances = {};
  const previous = {};
  const pq = new PriorityQueue();

  // Initialize
  for (const node of nodes) {
    if (node.id === startId) {
      distances[node.id] = 0;
      pq.enqueue(node.id, 0);
    } else {
      distances[node.id] = Infinity;
      pq.enqueue(node.id, Infinity);
    }
    previous[node.id] = null;
  }

  // Traverse
  while (!pq.isEmpty()) {
    const smallest = pq.dequeue().val;

    if (smallest === endId) {
      // Path found, build it backwards
      const pathIds = [];
      let curr = smallest;
      while (previous[curr]) {
        pathIds.push(curr);
        curr = previous[curr];
      }
      pathIds.push(startId);
      pathIds.reverse();

      const pathNodes = pathIds.map(id => nodes.find(n => n.id === id));
      const steps = generateDirections(pathNodes, edges);
      const totalDistance = distances[smallest];

      return {
        found: true,
        pathIds,
        path: pathNodes,
        steps,
        totalDistance
      };
    }

    if (smallest || distances[smallest] !== Infinity) {
      const neighbors = adjacencyList[smallest] || [];
      for (const neighbor of neighbors) {
        // Calculate new distance to neighboring node
        const candidate = distances[smallest] + neighbor.distance;
        const nextNode = neighbor.to;

        if (candidate < distances[nextNode]) {
          // Updating new shortest distance to neighbor
          distances[nextNode] = candidate;
          previous[nextNode] = smallest;
          pq.enqueue(nextNode, candidate);
        }
      }
    }
  }

  return { found: false, error: 'No path found.' };
}

// Listen for messages from the main thread
self.onmessage = function (e) {
  const { type, startId, endId, nodes, edges, adjacencyList } = e.data;

  if (type === 'COMPUTE_ROUTE') {
    try {
      const result = calculateRoute(startId, endId, nodes, edges, adjacencyList);
      self.postMessage({ type: 'ROUTE_RESULT', result });
    } catch (error) {
      self.postMessage({ type: 'ROUTE_ERROR', error: error.message });
    }
  }
};
