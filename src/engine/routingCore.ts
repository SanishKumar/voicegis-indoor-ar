export const STEP_TYPE = {
  START: 'start',
  STRAIGHT: 'straight',
  TURN_LEFT: 'turn_left',
  TURN_RIGHT: 'turn_right',
  SLIGHT_LEFT: 'slight_left',
  SLIGHT_RIGHT: 'slight_right',
  U_TURN: 'u_turn',
  ARRIVE: 'arrive',
} as const;

export type StepType = (typeof STEP_TYPE)[keyof typeof STEP_TYPE];

export interface PoiMetadata {
  name: string;
  category: string;
  icon?: string;
  description?: string;
}

export interface GraphNode {
  id: string;
  x: number;
  y: number;
  floor: number;
  type: string;
  poi?: PoiMetadata;
}

export interface GraphEdge {
  from: string;
  to: string;
  distance: number;
  corridor?: string;
  accessible?: boolean;
}

export interface RouteOptions {
  accessibleOnly?: boolean;
}

export interface RouteStep {
  type: StepType;
  instruction: string;
  distance: number;
  nodeId: string;
  bearing: number;
}

export interface RouteSuccess {
  found: true;
  algorithm: 'a-star';
  pathIds: string[];
  path: GraphNode[];
  steps: RouteStep[];
  totalDistance: number;
}

export interface RouteFailure {
  found: false;
  error: string;
}

export type RouteResult = RouteSuccess | RouteFailure;

interface Neighbor {
  to: string;
  distance: number;
  corridor?: string;
  accessible: boolean;
}

interface GraphIndex {
  adjacency: Map<string, Neighbor[]>;
  edgeByPair: Map<string, GraphEdge>;
  nodeById: Map<string, GraphNode>;
  heuristicScale: number;
}

interface QueueEntry {
  id: string;
  cost: number;
  priority: number;
}

class MinPriorityQueue {
  private heap: QueueEntry[] = [];

  get size() {
    return this.heap.length;
  }

  enqueue(entry: QueueEntry) {
    this.heap.push(entry);
    this.bubbleUp(this.heap.length - 1);
  }

  dequeue(): QueueEntry | undefined {
    const first = this.heap[0];
    const last = this.heap.pop();

    if (this.heap.length > 0 && last) {
      this.heap[0] = last;
      this.sinkDown(0);
    }

    return first;
  }

  private bubbleUp(startIndex: number) {
    let index = startIndex;
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.heap[parentIndex].priority <= this.heap[index].priority) break;
      [this.heap[parentIndex], this.heap[index]] = [this.heap[index], this.heap[parentIndex]];
      index = parentIndex;
    }
  }

  private sinkDown(startIndex: number) {
    let index = startIndex;

    while (true) {
      const leftIndex = index * 2 + 1;
      const rightIndex = leftIndex + 1;
      let smallestIndex = index;

      if (
        leftIndex < this.heap.length &&
        this.heap[leftIndex].priority < this.heap[smallestIndex].priority
      ) {
        smallestIndex = leftIndex;
      }
      if (
        rightIndex < this.heap.length &&
        this.heap[rightIndex].priority < this.heap[smallestIndex].priority
      ) {
        smallestIndex = rightIndex;
      }
      if (smallestIndex === index) break;

      [this.heap[index], this.heap[smallestIndex]] = [this.heap[smallestIndex], this.heap[index]];
      index = smallestIndex;
    }
  }
}

function pairKey(a: string, b: string) {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

export function buildGraphIndex(nodes: GraphNode[], edges: GraphEdge[]): GraphIndex {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const adjacency = new Map(nodes.map((node) => [node.id, [] as Neighbor[]]));
  const edgeByPair = new Map<string, GraphEdge>();
  let heuristicScale = Number.POSITIVE_INFINITY;

  for (const edge of edges) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to || edge.distance <= 0) continue;

    const neighbor = {
      distance: edge.distance,
      corridor: edge.corridor,
      accessible: edge.accessible !== false,
    };
    adjacency.get(edge.from)?.push({ ...neighbor, to: edge.to });
    adjacency.get(edge.to)?.push({ ...neighbor, to: edge.from });
    edgeByPair.set(pairKey(edge.from, edge.to), edge);

    if (from.floor === to.floor) {
      const coordinateDistance = Math.hypot(to.x - from.x, to.y - from.y);
      if (coordinateDistance > 0) {
        heuristicScale = Math.min(heuristicScale, edge.distance / coordinateDistance);
      }
    }
  }

  return {
    adjacency,
    edgeByPair,
    nodeById,
    heuristicScale: Number.isFinite(heuristicScale) ? heuristicScale : 0,
  };
}

function estimateRemainingCost(from: GraphNode, to: GraphNode, scale: number) {
  if (from.floor !== to.floor) return 0;
  return Math.hypot(to.x - from.x, to.y - from.y) * scale;
}

function getBearing(fromNode: GraphNode, toNode: GraphNode) {
  const dx = toNode.x - fromNode.x;
  const dy = -(toNode.y - fromNode.y);
  const bearing = Math.atan2(dx, dy) * (180 / Math.PI);
  return bearing < 0 ? bearing + 360 : bearing;
}

function getTurnType(previousBearing: number, nextBearing: number): StepType {
  let difference = nextBearing - previousBearing;
  if (difference > 180) difference -= 360;
  if (difference < -180) difference += 360;

  if (Math.abs(difference) < 20) return STEP_TYPE.STRAIGHT;
  if (difference < 60 && difference >= 20) return STEP_TYPE.SLIGHT_RIGHT;
  if (difference <= 150 && difference >= 60) return STEP_TYPE.TURN_RIGHT;
  if (difference > -60 && difference <= -20) return STEP_TYPE.SLIGHT_LEFT;
  if (difference >= -150 && difference <= -60) return STEP_TYPE.TURN_LEFT;
  return STEP_TYPE.U_TURN;
}

function turnInstruction(type: StepType, corridor?: string) {
  const action = {
    [STEP_TYPE.TURN_LEFT]: 'Turn left',
    [STEP_TYPE.TURN_RIGHT]: 'Turn right',
    [STEP_TYPE.SLIGHT_LEFT]: 'Bear left',
    [STEP_TYPE.SLIGHT_RIGHT]: 'Bear right',
    [STEP_TYPE.U_TURN]: 'Turn around',
    [STEP_TYPE.STRAIGHT]: 'Continue straight',
    [STEP_TYPE.START]: 'Start',
    [STEP_TYPE.ARRIVE]: 'Arrive',
  }[type];

  return corridor ? `${action} onto ${corridor}` : action;
}

export function generateRouteSteps(
  path: GraphNode[],
  edgeByPair: Map<string, GraphEdge>,
): RouteStep[] {
  if (path.length === 0) return [];
  if (path.length === 1) {
    return [
      {
        type: STEP_TYPE.ARRIVE,
        instruction: `You are already at ${path[0].poi?.name ?? 'the destination'}`,
        distance: 0,
        nodeId: path[0].id,
        bearing: 0,
      },
    ];
  }

  const segments = path.slice(0, -1).map((from, index) => {
    const to = path[index + 1];
    const edge = edgeByPair.get(pairKey(from.id, to.id));
    return {
      from,
      to,
      bearing: getBearing(from, to),
      corridor: edge?.corridor,
      distance: edge?.distance ?? 0,
    };
  });

  const firstCorridor = segments[0].corridor;
  const startName = path[0].poi?.name ?? 'your location';
  const steps: RouteStep[] = [
    {
      type: STEP_TYPE.START,
      instruction: firstCorridor
        ? `Start at ${startName} and continue on ${firstCorridor}`
        : `Start at ${startName}`,
      distance: 0,
      nodeId: path[0].id,
      bearing: segments[0].bearing,
    },
  ];

  let activeStepDistance = segments[0].distance;
  let previousBearing = segments[0].bearing;

  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index];
    const turnType = getTurnType(previousBearing, segment.bearing);

    if (turnType === STEP_TYPE.STRAIGHT) {
      activeStepDistance += segment.distance;
      previousBearing = segment.bearing;
      continue;
    }

    steps[steps.length - 1].distance = activeStepDistance;
    steps.push({
      type: turnType,
      instruction: turnInstruction(turnType, segment.corridor),
      distance: segment.distance,
      nodeId: segment.from.id,
      bearing: segment.bearing,
    });
    activeStepDistance = segment.distance;
    previousBearing = segment.bearing;
  }

  steps[steps.length - 1].distance = activeStepDistance;
  const destination = path[path.length - 1];
  steps.push({
    type: STEP_TYPE.ARRIVE,
    instruction: `Arrive at ${destination.poi?.name ?? 'the destination'}`,
    distance: 0,
    nodeId: destination.id,
    bearing: segments[segments.length - 1].bearing,
  });

  return steps;
}

function reconstructPath(
  startId: string,
  endId: string,
  cameFrom: Map<string, string>,
  nodeById: Map<string, GraphNode>,
) {
  const pathIds = [endId];
  let currentId = endId;

  while (currentId !== startId) {
    const previousId = cameFrom.get(currentId);
    if (!previousId) return null;
    pathIds.push(previousId);
    currentId = previousId;
  }

  pathIds.reverse();
  return {
    pathIds,
    path: pathIds.map((id) => nodeById.get(id)).filter((node): node is GraphNode => Boolean(node)),
  };
}

export function calculateRoute(
  startId: string,
  endId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
  options: RouteOptions = {},
): RouteResult {
  const graph = buildGraphIndex(nodes, edges);
  const start = graph.nodeById.get(startId);
  const destination = graph.nodeById.get(endId);

  if (!start || !destination) {
    return { found: false, error: 'Start or destination does not exist in the building graph.' };
  }

  if (startId === endId) {
    return {
      found: true,
      algorithm: 'a-star',
      pathIds: [startId],
      path: [start],
      steps: generateRouteSteps([start], graph.edgeByPair),
      totalDistance: 0,
    };
  }

  const openSet = new MinPriorityQueue();
  const costFromStart = new Map<string, number>([[startId, 0]]);
  const cameFrom = new Map<string, string>();

  openSet.enqueue({
    id: startId,
    cost: 0,
    priority: estimateRemainingCost(start, destination, graph.heuristicScale),
  });

  while (openSet.size > 0) {
    const current = openSet.dequeue();
    if (!current) break;

    const bestKnownCost = costFromStart.get(current.id);
    if (bestKnownCost === undefined || current.cost !== bestKnownCost) continue;

    if (current.id === endId) {
      const reconstructed = reconstructPath(startId, endId, cameFrom, graph.nodeById);
      if (!reconstructed) break;

      return {
        found: true,
        algorithm: 'a-star',
        ...reconstructed,
        steps: generateRouteSteps(reconstructed.path, graph.edgeByPair),
        totalDistance: bestKnownCost,
      };
    }

    for (const neighbor of graph.adjacency.get(current.id) ?? []) {
      if (options.accessibleOnly && !neighbor.accessible) continue;

      const candidateCost = bestKnownCost + neighbor.distance;
      if (candidateCost >= (costFromStart.get(neighbor.to) ?? Number.POSITIVE_INFINITY)) continue;

      const neighborNode = graph.nodeById.get(neighbor.to);
      if (!neighborNode) continue;

      cameFrom.set(neighbor.to, current.id);
      costFromStart.set(neighbor.to, candidateCost);
      openSet.enqueue({
        id: neighbor.to,
        cost: candidateCost,
        priority:
          candidateCost + estimateRemainingCost(neighborNode, destination, graph.heuristicScale),
      });
    }
  }

  return { found: false, error: 'No route satisfies the selected constraints.' };
}
