import type { GraphEdge, GraphNode } from "./types";

export class ForceSimulation {
  private nodes: GraphNode[] = [];
  private reduced = false;
  private hovering = false;

  setData(nodes: GraphNode[], _edges: GraphEdge[]): void {
    this.nodes = nodes;
    for (const node of nodes) {
      if (!Number.isFinite(node.x)) node.x = 0;
      if (!Number.isFinite(node.y)) node.y = 0;
      if (node.fx === undefined) node.fx = null;
      if (node.fy === undefined) node.fy = null;
      const kind = (node as { kind?: string }).kind;
      if ((kind === "core" || kind === "document") && node.fx == null) {
        node.fx = node.x;
        node.fy = node.y;
      }
    }
  }

  setReducedMotion(value: boolean): void {
    this.reduced = value;
  }

  setHovering(value: boolean): void {
    this.hovering = value;
  }

  reheat(): void { }

  tick(dt: number): void {
    if (!this.reduced && !this.hovering) {
      this.drift(dt);
    }
  }

  private isStableNode(node: GraphNode): boolean {
    const kind = (node as { kind?: string }).kind;
    return kind === "core" || kind === "document";
  }

  private drift(dt: number): void {
    for (const node of this.nodes) {
      if (!node.orbitSpeed || node.held) continue;
      if (this.isStableNode(node)) continue;
      node.orbitAngle = (node.orbitAngle ?? 0) + node.orbitSpeed * dt;
      const x = Math.cos(node.orbitAngle) * (node.orbitRadius ?? 0);
      const y = Math.sin(node.orbitAngle) * (node.orbitRadius ?? 0);
      node.x = x;
      node.y = y;
      node.fx = x;
      node.fy = y;
    }
  }
}