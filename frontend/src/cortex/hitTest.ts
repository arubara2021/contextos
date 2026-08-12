import type { GraphEdge, GraphNode } from "./types";

export interface HitTestOptions {
  touch?: boolean;
}

export function findNodeAt(
  nodes: GraphNode[],
  wx: number,
  wy: number,
  zoom: number,
  options: HitTestOptions = {}
): GraphNode | null {
  const baseSlack = options.touch ? 24 : 8;
  const slack = baseSlack / zoom;
  let best: GraphNode | null = null;
  let bestScore = Infinity;
  for (const node of nodes) {
    const kind = node.kind ?? "concept";
    const dx = wx - node.x;
    const dy = wy - node.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (kind === "document") {
      const halfW = (node.boxWidth ?? 188) / 2 + slack;
      const halfH = (node.boxHeight ?? 72) / 2 + slack;
      if (Math.abs(dx) <= halfW && Math.abs(dy) <= halfH) {
        const score = dist;
        if (score < bestScore) {
          best = node;
          bestScore = score;
        }
      }
      continue;
    }
    if (kind === "core") {
      const radius = Math.max(node.radius || 32, 30) + 20;
      if (dist <= radius + slack) {
        const score = dist - 6;
        if (score < bestScore) {
          best = node;
          bestScore = score;
        }
      }
      continue;
    }
    if (dist <= node.radius + slack) {
      const score = dist - 12;
      if (score < bestScore) {
        best = node;
        bestScore = score;
      }
    }
  }
  return best;
}

export interface Neighborhood {
  nodes: Set<string>;
  edges: Set<string>;
}

export function neighborhoodOf(
  nodeId: string,
  edges: GraphEdge[],
  depth = 1
): Neighborhood {
  const nodes = new Set<string>([nodeId]);
  const edgeIds = new Set<string>();
  let frontier = new Set<string>([nodeId]);
  for (let d = 0; d < depth; d++) {
    const next = new Set<string>();
    for (const edge of edges) {
      if (frontier.has(edge.source) || frontier.has(edge.target)) {
        edgeIds.add(edge.id);
        if (!nodes.has(edge.source)) {
          nodes.add(edge.source);
          next.add(edge.source);
        }
        if (!nodes.has(edge.target)) {
          nodes.add(edge.target);
          next.add(edge.target);
        }
      }
    }
    frontier = next;
    if (frontier.size === 0) break;
  }
  return { nodes, edges: edgeIds };
}

export function edgesTouching(nodeId: string, edges: GraphEdge[]): GraphEdge[] {
  return edges.filter((edge) => edge.source === nodeId || edge.target === nodeId);
}