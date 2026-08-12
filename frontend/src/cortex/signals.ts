import type { GraphEdge, GraphNode, Signal } from "./types";

let signalCounter = 0;
let ambientCounter = 0;

export interface SignalSpawnOptions {
  reverse?: boolean;
  speed?: number;
  color?: string;
  boost?: boolean;
}

export interface AmbientParticle {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  maxAlpha: number;
  color: string;
  life: number;
  maxLife: number;
  phase: number;
  pulseSpeed: number;
}

const AMBIENT_COLORS = ["#C4EFEB", "#FFB15C", "#FF8A3D", "#C4EFEB", "#C4EFEB"];
const CORE_COLORS = ["#FFB15C", "#FF8A3D", "#FFE6A8"];
const BRIDGE_COLORS = ["#C4EFEB", "#8FD8D2", "#EAFBF9"];
const FLOAT_COLORS = [
  "#FF8A3D",
  "#FFB15C",
  "#C4EFEB",
  "#8FD8D2",
  "#FFE6A8",
  "#E39AB8",
];
const MAX_AMBIENT = 64;
const TRAIL_LENGTH = 5;
const BOOST_TRAIL_LENGTH = 10;

export class SignalSystem {
  signals: Signal[] = [];
  ambientParticles: AmbientParticle[] = [];
  private edgeById = new Map<string, GraphEdge>();
  private trails = new Map<string, number[]>();
  private boosted = new Set<string>();

  setEdges(edges: GraphEdge[]): void {
    this.edgeById = new Map(edges.map((edge) => [edge.id, edge]));
    this.signals = this.signals.filter((signal) =>
      this.edgeById.has(signal.edgeId)
    );
    for (const id of this.trails.keys()) {
      if (!this.edgeById.has(id)) this.trails.delete(id);
    }
    for (const id of this.boosted) {
      if (!this.edgeById.has(id)) this.boosted.delete(id);
    }
  }

  private defaultColor(edge: GraphEdge): string {
    const edgeWithKind = edge as { edgeKind?: string; crossDocument?: boolean };
    if (edgeWithKind.edgeKind === "core-document") {
      return CORE_COLORS[Math.floor(Math.random() * CORE_COLORS.length)];
    }
    if (
      edgeWithKind.edgeKind === "document-bridge" ||
      edgeWithKind.crossDocument === true
    ) {
      return BRIDGE_COLORS[Math.floor(Math.random() * BRIDGE_COLORS.length)];
    }
    return AMBIENT_COLORS[Math.floor(Math.random() * AMBIENT_COLORS.length)];
  }

  spawn(edgeId: string, options: SignalSpawnOptions = {}): void {
    const edge = this.edgeById.get(edgeId);
    if (!edge) return;
    const id = `signal-${++signalCounter}`;
    const speed = options.speed ?? 0.8 + Math.random() * 0.6;
    this.signals.push({
      id,
      edgeId,
      progress: 0,
      speed,
      color: options.color ?? this.defaultColor(edge),
      reverse: options.reverse ?? false,
    });
    this.trails.set(id, []);
    if (options.boost || speed >= 1.1) this.boosted.add(id);
  }

  burst(edgeIds: string[]): void {
    for (const id of edgeIds) this.spawn(id, { boost: true });
  }

  isBoosted(signalId: string): boolean {
    return this.boosted.has(signalId);
  }

  spawnAmbient(count = 1): void {
    const ids = [...this.edgeById.keys()];
    if (ids.length === 0) return;
    const total = count + (Math.random() > 0.6 ? 1 : 0);
    for (let i = 0; i < total; i++) {
      const id = ids[Math.floor(Math.random() * ids.length)];
      const edge = this.edgeById.get(id);
      if (!edge) continue;
      this.spawn(id, {
        color: this.defaultColor(edge),
        speed: 0.7 + Math.random() * 0.8,
      });
    }
  }

  spawnAmbientParticles(
    count: number,
    centerX: number,
    centerY: number,
    spread: number
  ): void {
    if (this.ambientParticles.length >= MAX_AMBIENT) return;
    const toSpawn = Math.min(count, MAX_AMBIENT - this.ambientParticles.length);
    for (let i = 0; i < toSpawn; i++) {
      const color =
        FLOAT_COLORS[Math.floor(Math.random() * FLOAT_COLORS.length)];
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * spread;
      const speed = 8 + Math.random() * 18;
      const driftAngle = Math.random() * Math.PI * 2;
      this.ambientParticles.push({
        id: `amb-${++ambientCounter}`,
        x: centerX + Math.cos(angle) * dist,
        y: centerY + Math.sin(angle) * dist,
        vx: Math.cos(driftAngle) * speed,
        vy: Math.sin(driftAngle) * speed,
        size: 1.2 + Math.random() * 2.6,
        alpha: 0,
        maxAlpha: 0.28 + Math.random() * 0.5,
        color,
        life: 0,
        maxLife: 5 + Math.random() * 7,
        phase: Math.random() * Math.PI * 2,
        pulseSpeed: 0.6 + Math.random() * 1.4,
      });
    }
  }

  update(dtSeconds: number): void {
    for (const signal of this.signals) {
      const trail = this.trails.get(signal.id);
      if (trail) {
        trail.push(signal.progress);
        const cap = this.boosted.has(signal.id)
          ? BOOST_TRAIL_LENGTH
          : TRAIL_LENGTH;
        while (trail.length > cap) trail.shift();
      }
      signal.progress += signal.speed * dtSeconds;
    }
    this.signals = this.signals.filter((signal) => {
      const alive = signal.progress < 1;
      if (!alive) {
        this.trails.delete(signal.id);
        this.boosted.delete(signal.id);
      }
      return alive;
    });
  }

  updateAmbient(dtSeconds: number): void {
    for (const p of this.ambientParticles) {
      p.life += dtSeconds;
      p.x += p.vx * dtSeconds;
      p.y += p.vy * dtSeconds;
      p.vx *= 0.997;
      p.vy *= 0.997;
      const lifeRatio = p.life / p.maxLife;
      if (lifeRatio < 0.15) {
        p.alpha = p.maxAlpha * (lifeRatio / 0.15);
      } else if (lifeRatio > 0.75) {
        p.alpha = p.maxAlpha * ((1 - lifeRatio) / 0.25);
      } else {
        p.alpha = p.maxAlpha;
      }
      p.alpha *= 0.65 + 0.35 * Math.sin(p.life * p.pulseSpeed + p.phase);
    }
    this.ambientParticles = this.ambientParticles.filter(
      (p) => p.life < p.maxLife
    );
  }

  trailOf(signal: Signal): number[] {
    return this.trails.get(signal.id) ?? [];
  }

  positionAtProgress(
    signal: Signal,
    rawProgress: number,
    nodeById: Map<string, GraphNode>
  ): { x: number; y: number } | null {
    const edge = this.edgeById.get(signal.edgeId);
    if (!edge) return null;
    const a = nodeById.get(edge.source);
    const b = nodeById.get(edge.target);
    if (!a || !b) return null;
    const t = signal.reverse ? 1 - rawProgress : rawProgress;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
    const bend = Math.min(dist * 0.14, 34);
    const cx = (a.x + b.x) / 2 + (-dy / dist) * bend;
    const cy = (a.y + b.y) / 2 + (dx / dist) * bend;
    const u = 1 - t;
    return {
      x: u * u * a.x + 2 * u * t * cx + t * t * b.x,
      y: u * u * a.y + 2 * u * t * cy + t * t * b.y,
    };
  }

  positionOf(
    signal: Signal,
    nodeById: Map<string, GraphNode>
  ): { x: number; y: number } | null {
    return this.positionAtProgress(signal, signal.progress, nodeById);
  }

  clear(): void {
    this.signals = [];
    this.trails.clear();
    this.boosted.clear();
    this.ambientParticles = [];
  }
}