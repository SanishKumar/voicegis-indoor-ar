import type { GraphEdge, GraphNode } from './routingCore';

export type GraphIssueCode =
  'duplicate-node' | 'duplicate-edge' | 'invalid-distance' | 'missing-endpoint' | 'isolated-node';

export interface GraphIssue {
  code: GraphIssueCode;
  message: string;
  subjectId: string;
}

function edgeKey(edge: GraphEdge) {
  return [edge.from, edge.to].sort().join('::');
}

export function validateGraph(nodes: GraphNode[], edges: GraphEdge[]): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const nodeIds = new Set<string>();
  const connectedNodeIds = new Set<string>();
  const edgeKeys = new Set<string>();

  for (const node of nodes) {
    if (nodeIds.has(node.id)) {
      issues.push({
        code: 'duplicate-node',
        message: `Node identifier "${node.id}" is not unique.`,
        subjectId: node.id,
      });
    }
    nodeIds.add(node.id);
  }

  for (const edge of edges) {
    const key = edgeKey(edge);
    if (edgeKeys.has(key)) {
      issues.push({
        code: 'duplicate-edge',
        message: `Edge "${key}" is defined more than once.`,
        subjectId: key,
      });
    }
    edgeKeys.add(key);

    if (edge.distance <= 0 || !Number.isFinite(edge.distance)) {
      issues.push({
        code: 'invalid-distance',
        message: `Edge "${key}" must have a finite, positive distance.`,
        subjectId: key,
      });
    }

    for (const endpoint of [edge.from, edge.to]) {
      if (!nodeIds.has(endpoint)) {
        issues.push({
          code: 'missing-endpoint',
          message: `Edge "${key}" refers to unknown node "${endpoint}".`,
          subjectId: key,
        });
      } else {
        connectedNodeIds.add(endpoint);
      }
    }
  }

  for (const nodeId of nodeIds) {
    if (!connectedNodeIds.has(nodeId)) {
      issues.push({
        code: 'isolated-node',
        message: `Node "${nodeId}" has no routing edges.`,
        subjectId: nodeId,
      });
    }
  }

  return issues;
}
