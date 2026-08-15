import type { Camera } from "./camera";
import type { SignalSystem } from "./signals";
import type { GraphNode, RenderOptions, Scene } from "./types";
import { RING_LABELS } from "./layouts";
import { RELATIONSHIP_TYPES } from "../constants";
import {
  categoryColor,
  domainColor,
  nodePalette,
  typeColor,
  withAlpha,
} from "../utils/color";
import { clampScalar } from "../utils/vec";

interface Emphasis {
  active: Set<string> | null;
  activeEdges: Set<string> | null;
}

interface LabelCandidate {
  x0: number;
  top: number;
  cardW: number;
  cardH: number;
  dotX: number;
  dotY: number;
  dotR: number;
  name: string;
  nameX: number;
  nameY: number;
  nameSize: number;
  meta: string | null;
  metaX: number;
  metaY: number;
  metaSize: number;
  screenRect: Rect;
  priority: number;
  forced: boolean;
  bright: boolean;
  dot: string;
  borderW: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

function cellHash(cx: number, cy: number): number {
  let h = (cx * 374761393 + cy * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return (h ^ (h >>> 16)) >>> 0;
}

export class CortexRenderer {
  private ctx: CanvasRenderingContext2D;
  private pulseStarts = new Map<string, number>();

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  render(
    scene: Scene,
    camera: Camera,
    signals: SignalSystem,
    options: RenderOptions,
    width: number,
    height: number
  ): void {
    const { ctx } = this;
    ctx.setTransform(options.dpr, 0, 0, options.dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    this.drawStarfield(camera, width, height, options.time, options.reducedMotion);
    if (scene.nodes.length === 0) {
      this.drawEmptyNexus(options.time, width, height, options.reducedMotion);
    }
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.rotate(camera.rotation);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);
    this.syncPulses(options.pulseIds, options.time);
    const emphasis = this.computeEmphasis(scene, options);
    this.drawScaffold(scene, emphasis, options, camera);
    this.drawDocumentHull(scene, emphasis, camera);
    this.drawEdges(scene, emphasis, options.time);
    this.drawSignals(signals, scene.nodeById);
    this.drawAmbientParticles(signals);
    this.drawNodes(scene, emphasis, options, camera);
    this.drawLabels(scene, emphasis, options, camera, width, height);
    ctx.restore();
    if (options.retrieving) this.drawScanline(options.time, width, height);
  }

  private drawStarfield(
    camera: Camera,
    width: number,
    height: number,
    time: number,
    reduced: boolean
  ): void {
    const { ctx } = this;
    const spacing = 72;
    const parallax = 0.12;
    const ox = camera.x * parallax;
    const oy = camera.y * parallax;
    const c0x = Math.floor(ox / spacing) - 1;
    const c0y = Math.floor(oy / spacing) - 1;
    const c1x = Math.ceil((ox + width) / spacing) + 1;
    const c1y = Math.ceil((oy + height) / spacing) + 1;
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cy = c0y; cy <= c1y; cy++) {
        const h = cellHash(cx, cy);
        const jx = (h & 255) / 255;
        const jy = ((h >>> 8) & 255) / 255;
        const sx = cx * spacing + jx * spacing - ox;
        const sy = cy * spacing + jy * spacing - oy;
        if (sx < -8 || sx > width + 8 || sy < -8 || sy > height + 8) continue;
        const kind = (h >>> 16) & 7;
        const brightnessBase = 0.2 + ((h >>> 24) & 31) / 65;
        const twinkle = reduced
          ? 1
          : 0.55 + 0.45 * Math.sin(time * 0.001 + (h & 1023) * 0.61);
        const alpha = brightnessBase * twinkle;
        const size = kind === 0 ? 2.4 : kind < 3 ? 1.5 : 0.9;
        const colorSel = (h >>> 20) & 3;
        let r: number;
        let g: number;
        let b: number;
        switch (colorSel) {
          case 0:
            r = 255;
            g = 200;
            b = 148;
            break;
          case 1:
            r = 196;
            g = 239;
            b = 235;
            break;
          case 2:
            r = 236;
            g = 229;
            b = 218;
            break;
          default:
            r = 255;
            g = 177;
            b = 92;
            break;
        }
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx.fillRect(sx - size * 0.5, sy - size * 0.5, size, size);
        if (kind === 0 && alpha > 0.12) {
          const glowRadius = size * 5.5;
          const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, glowRadius);
          glow.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha * 0.3})`);
          glow.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(sx, sy, glowRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  private drawEmptyNexus(
    time: number,
    width: number,
    height: number,
    reduced: boolean
  ): void {
    const { ctx } = this;
    const cx = width / 2;
    const cy = height / 2;
    const breathe = reduced ? 1 : 0.84 + 0.16 * Math.sin(time * 0.0008);
    const outerRadius = 340 * breathe;
    const outer = ctx.createRadialGradient(cx, cy, 0, cx, cy, outerRadius);
    outer.addColorStop(0, `rgba(255, 138, 61, ${0.15 * breathe})`);
    outer.addColorStop(0.3, `rgba(255, 138, 61, ${0.07 * breathe})`);
    outer.addColorStop(0.65, `rgba(143, 216, 210, ${0.025 * breathe})`);
    outer.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = outer;
    ctx.beginPath();
    ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2);
    ctx.fill();
    const midRadius = 160 * breathe;
    const mid = ctx.createRadialGradient(cx, cy, 0, cx, cy, midRadius);
    mid.addColorStop(0, `rgba(255, 177, 92, ${0.12 * breathe})`);
    mid.addColorStop(0.5, `rgba(255, 138, 61, ${0.04 * breathe})`);
    mid.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = mid;
    ctx.beginPath();
    ctx.arc(cx, cy, midRadius, 0, Math.PI * 2);
    ctx.fill();
    const innerRadius = 65 * breathe;
    const inner = ctx.createRadialGradient(cx, cy, 0, cx, cy, innerRadius);
    inner.addColorStop(0, `rgba(255, 241, 204, ${0.22 * breathe})`);
    inner.addColorStop(0.45, `rgba(255, 177, 92, ${0.1 * breathe})`);
    inner.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = inner;
    ctx.beginPath();
    ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2);
    ctx.fill();
    if (reduced) return;
    const p1 = 0.5 + 0.5 * Math.sin(time * 0.001);
    ctx.strokeStyle = `rgba(255, 138, 61, ${0.07 + p1 * 0.09})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, 52 + p1 * 14, 0, Math.PI * 2);
    ctx.stroke();
    const p2 = 0.5 + 0.5 * Math.sin(time * 0.0007 + 1.2);
    ctx.strokeStyle = `rgba(143, 216, 210, ${0.045 + p2 * 0.06})`;
    ctx.setLineDash([4, 8]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, 98 + p2 * 20, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    const p3 = 0.5 + 0.5 * Math.sin(time * 0.0005 + 2.4);
    ctx.strokeStyle = `rgba(255, 225, 168, ${0.03 + p3 * 0.04})`;
    ctx.setLineDash([2, 10]);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(cx, cy, 158 + p3 * 24, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    const rot = time * 0.0003;
    ctx.strokeStyle = "rgba(255, 177, 92, 0.2)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 138, rot, rot + 1.15);
    ctx.stroke();
    ctx.strokeStyle = "rgba(143, 216, 210, 0.14)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, 172, rot + Math.PI, rot + Math.PI + 0.7);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 225, 168, 0.1)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(cx, cy, 205, rot + 0.5, rot + 0.5 + 0.5);
    ctx.stroke();
    const orbitDots = [
      { r: 68, spd: 0.0006, ph: 0, sz: 2.8, col: "rgba(255, 177, 92, 0.45)" },
      { r: 112, spd: -0.0004, ph: 2.1, sz: 2.2, col: "rgba(143, 216, 210, 0.38)" },
      { r: 162, spd: 0.0003, ph: 4.2, sz: 1.8, col: "rgba(255, 225, 168, 0.32)" },
      { r: 88, spd: -0.0005, ph: 1.1, sz: 2, col: "rgba(255, 138, 61, 0.38)" },
      { r: 195, spd: 0.00025, ph: 3.3, sz: 1.4, col: "rgba(227, 154, 184, 0.25)" },
    ];
    for (const dot of orbitDots) {
      const ang = time * dot.spd + dot.ph;
      const dx = cx + Math.cos(ang) * dot.r;
      const dy = cy + Math.sin(ang) * dot.r;
      const dotGlow = ctx.createRadialGradient(dx, dy, 0, dx, dy, dot.sz * 3);
      dotGlow.addColorStop(0, dot.col);
      dotGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = dotGlow;
      ctx.beginPath();
      ctx.arc(dx, dy, dot.sz * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = dot.col;
      ctx.beginPath();
      ctx.arc(dx, dy, dot.sz, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private syncPulses(pulseIds: Set<string>, time: number): void {
    for (const id of pulseIds) {
      if (!this.pulseStarts.has(id)) this.pulseStarts.set(id, time);
    }
    for (const [id, start] of this.pulseStarts) {
      if (time - start > 950) this.pulseStarts.delete(id);
    }
  }

  private computeEmphasis(scene: Scene, options: RenderOptions): Emphasis {
    const hasFocus =
      options.highlightedIds.size > 0 ||
      options.hover?.nodeId != null;
    if (!hasFocus) return { active: null, activeEdges: null };
    const active = new Set<string>(options.highlightedIds);
    if (options.hover?.nodeId) active.add(options.hover.nodeId);
    const activeEdges = new Set<string>();
    for (const edge of scene.edges) {
      if (active.has(edge.source) || active.has(edge.target)) {
        activeEdges.add(edge.id);
        active.add(edge.source);
        active.add(edge.target);
      }
    }
    return { active, activeEdges };
  }

  private drawScaffold(
    scene: Scene,
    emphasis: Emphasis,
    options: RenderOptions,
    camera: Camera
  ): void {
    const dim = emphasis.active !== null ? 0.28 : 1;
    if (options.layout === "orbit") this.drawOrbitScaffold(scene, dim);
    else if (options.layout === "timeline") this.drawTimelineScaffold(scene, dim);
    else this.drawConstellationScaffold(scene, dim, camera);
  }

  private drawConstellationScaffold(
    scene: Scene,
    dim: number,
    camera: Camera
  ): void {
    const { ctx } = this;
    const counts = new Map<string, number>();
    const centers = new Map<
      string,
      { x: number; y: number; r: number; color: string; label: string; count: number }
    >();
    for (const node of scene.nodes) {
      if (node.clusterId == null) continue;
      counts.set(node.clusterId, (counts.get(node.clusterId) ?? 0) + 1);
      if (!node.clusterAnchor) continue;
      centers.set(node.clusterId, {
        x: node.clusterCenterX ?? node.x,
        y: node.clusterCenterY ?? node.y,
        r: node.clusterRadius ?? 60,
        color: typeColor(node.conceptType),
        label: node.conceptType,
        count: 0,
      });
    }
    const zoom = camera.zoom;
    for (const [id, c] of centers) {
      c.count = counts.get(id) ?? 0;
      const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r);
      g.addColorStop(0, withAlpha(c.color, 0.09 * dim));
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = withAlpha(c.color, 0.28 * dim);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 6, 0, Math.PI * 2);
      ctx.stroke();
      const size = clampScalar(10 / zoom, 3, 14);
      ctx.font = `600 ${size}px 'Spline Sans Mono', monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillStyle = withAlpha(c.color, 0.78 * dim);
      ctx.fillText(
        `${c.label.toUpperCase()} · ${c.count}`,
        c.x,
        c.y - c.r - 8 / zoom
      );
    }
  }

  private drawOrbitScaffold(scene: Scene, dim: number): void {
    const { ctx } = this;
    const ringRadii = new Map<number, number>();
    const spokes = new Map<number, string>();
    for (const node of scene.nodes) {
      if (node.ring != null && node.orbitRadius != null && !ringRadii.has(node.ring)) {
        ringRadii.set(node.ring, node.orbitRadius);
      }
      if (
        node.wedgeAngle != null &&
        node.wedgeLabel &&
        !spokes.has(Math.round(node.wedgeAngle * 1000))
      ) {
        spokes.set(Math.round(node.wedgeAngle * 1000), node.wedgeLabel);
      }
    }
    const radii = [...ringRadii.values()];
    if (radii.length === 0) return;
    const minR = Math.min(...radii);
    const maxR = Math.max(...radii);
    const sun = ctx.createRadialGradient(0, 0, 0, 0, 0, 70);
    sun.addColorStop(0, withAlpha("#FF8A3D", 0.22 * dim));
    sun.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sun;
    ctx.beginPath();
    ctx.arc(0, 0, 70, 0, Math.PI * 2);
    ctx.fill();
    const rings = [...ringRadii.keys()].sort((a, b) => a - b);
    for (const r of rings) {
      const rad = ringRadii.get(r)!;
      ctx.strokeStyle = withAlpha("#FF8A3D", (r === 0 ? 0.22 : 0.12) * dim);
      ctx.lineWidth = 1;
      ctx.setLineDash(r === 0 ? [] : [2, 6]);
      ctx.beginPath();
      ctx.arc(0, 0, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = withAlpha("#A29384", 0.5 * dim);
      ctx.font = "9px 'Spline Sans Mono', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(RING_LABELS[r] ?? "", 0, -rad);
    }
    for (const [key, label] of spokes) {
      const angle = key / 1000;
      const inner = minR * 0.6;
      const outer = maxR + 26;
      ctx.strokeStyle = withAlpha("#ECE5DA", 0.06 * dim);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
      ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
      ctx.stroke();
      ctx.fillStyle = withAlpha("#A29384", 0.6 * dim);
      ctx.font = "9px 'Spline Sans Mono', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        label.toUpperCase(),
        Math.cos(angle) * (outer + 18),
        Math.sin(angle) * (outer + 18)
      );
    }
  }

  private drawTimelineScaffold(scene: Scene, dim: number): void {
    const { ctx } = this;
    if (scene.nodes.length === 0) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const rows = new Set<number>();
    for (const node of scene.nodes) {
      if (node.x < minX) minX = node.x;
      if (node.x > maxX) maxX = node.x;
      if (node.y < minY) minY = node.y;
      if (node.y > maxY) maxY = node.y;
      rows.add(Math.round(node.y));
    }
    const nowX = maxX + 70;
    for (const ry of rows) {
      ctx.strokeStyle = withAlpha("#ECE5DA", 0.04 * dim);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(minX - 40, ry);
      ctx.lineTo(nowX, ry);
      ctx.stroke();
    }
    const grad = ctx.createLinearGradient(nowX, minY - 30, nowX, maxY + 30);
    grad.addColorStop(0, "rgba(255,138,61,0)");
    grad.addColorStop(0.5, withAlpha("#FF8A3D", 0.5 * dim));
    grad.addColorStop(1, "rgba(255,138,61,0)");
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(nowX, minY - 30);
    ctx.lineTo(nowX, maxY + 30);
    ctx.stroke();
    ctx.fillStyle = withAlpha("#FFB15C", 0.8 * dim);
    ctx.font = "10px 'Spline Sans Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("NOW", nowX, minY - 36);
    ctx.fillStyle = withAlpha("#6B5F54", 0.7 * dim);
    ctx.textBaseline = "top";
    ctx.fillText("PAST", minX - 40, maxY + 36);
  }

  private drawDocumentHull(
    scene: Scene,
    emphasis: Emphasis,
    camera: Camera
  ): void {
    const expandedDoc = scene.nodes.find(
      (node) => (node.kind ?? "concept") === "document" && node.expanded
    );
    const expandedHub = scene.nodes.find(
      (node) => (node.kind ?? "concept") === "domain" && node.expanded
    );
    const expanded = expandedDoc ?? expandedHub;
    if (!expanded) return;
    const members = scene.nodes.filter((node) => (node.kind ?? "concept") === "concept");
    if (members.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of members) {
      const r = node.radius || 10;
      if (node.x - r < minX) minX = node.x - r;
      if (node.y - r < minY) minY = node.y - r;
      if (node.x + r > maxX) maxX = node.x + r;
      if (node.y + r > maxY) maxY = node.y + r;
    }
    const pad = 84;
    const x = minX - pad;
    const y = minY - pad;
    const w = maxX - minX + pad * 2;
    const h = maxY - minY + pad * 2;
    const dim = emphasis.active !== null ? 0.45 : 1;
    const color = expandedHub
      ? expandedHub.domainColor ?? domainColor(expandedHub.domain)
      : "#FF8A3D";
    const { ctx } = this;
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, withAlpha(color, 0.055 * dim));
    grad.addColorStop(1, withAlpha("#8FD8D2", 0.03 * dim));
    ctx.fillStyle = grad;
    this.roundRect(x, y, w, h, 30);
    ctx.fill();
    ctx.setLineDash([10, 8]);
    ctx.strokeStyle = withAlpha(color, 0.22 * dim);
    ctx.lineWidth = 1.2;
    this.roundRect(x, y, w, h, 30);
    ctx.stroke();
    ctx.setLineDash([]);
    const labelSize = clampScalar(10 / camera.zoom, 4, 20);
    ctx.font = `500 ${labelSize}px 'Spline Sans Mono', monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = withAlpha(color, 0.65 * dim);
    const fieldLabel = expandedHub
      ? `${String(expandedHub.domain ?? "general").toUpperCase()} FIELD`
      : `${expanded.label.toUpperCase()} FIELD`;
    ctx.fillText(fieldLabel, x + 18, y + 14);
  }

  private drawEdges(scene: Scene, emphasis: Emphasis, time: number): void {
    const { ctx } = this;
    const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
    const sizeMultiplier = isMobile ? 1.8 : 1;

    const EDGE_COLORS: Record<string, string> = {
      supports: "rgba(143, 216, 210, 0.45)",
      contradicts: "rgba(255, 92, 92, 0.45)",
      refines: "rgba(196, 239, 235, 0.4)",
      related: "rgba(236, 229, 218, 0.3)",
      depends_on: "rgba(255, 225, 168, 0.4)",
      part_of: "rgba(162, 147, 132, 0.35)",
      co_occurs: "rgba(162, 147, 132, 0.3)",
      example_of: "rgba(196, 239, 235, 0.35)",
      requires: "rgba(255, 138, 61, 0.45)",
      neutral: "rgba(162, 147, 132, 0.25)",
    };

    const EDGE_PULSE: Record<string, string> = {
      supports: "196, 239, 235",
      contradicts: "255, 130, 130",
      refines: "196, 239, 235",
      related: "236, 229, 218",
      depends_on: "255, 225, 168",
      part_of: "162, 147, 132",
      co_occurs: "162, 147, 132",
      example_of: "196, 239, 235",
      requires: "255, 177, 92",
      neutral: "162, 147, 132",
    };

    const bezierPoint = (
      ax: number, ay: number,
      cpx: number, cpy: number,
      bx: number, by: number,
      t: number
    ) => {
      const mt = 1 - t;
      return {
        x: mt * mt * ax + 2 * mt * t * cpx + t * t * bx,
        y: mt * mt * ay + 2 * mt * t * cpy + t * t * by,
      };
    };

    for (const edge of scene.edges) {
      const a = scene.nodeById.get(edge.source);
      const b = scene.nodeById.get(edge.target);
      if (!a || !b) continue;
      const emphasized = emphasis.activeEdges?.has(edge.id) ?? false;
      const dimmed = emphasis.active !== null && !emphasized;
      const isCoreEdge =
        edge.edgeKind === "core-document" ||
        (a.kind ?? "concept") === "core" ||
        (b.kind ?? "concept") === "core";
      const isBridge =
        edge.edgeKind === "document-bridge" ||
        edge.edgeKind === "domain-bridge" ||
        edge.crossDocument === true;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const bend = Math.min(dist * 0.14, 34);
      const cpx = (a.x + b.x) / 2 + (-dy / dist) * bend;
      const cpy = (a.y + b.y) / 2 + (dx / dist) * bend;

      const drawPath = () => {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(cpx, cpy, b.x, b.y);
      };

      if (isCoreEdge) {
        drawPath();
        ctx.globalAlpha = dimmed ? 0.06 : 0.25;
        ctx.strokeStyle = "rgba(255, 177, 92, 0.5)";
        ctx.lineWidth = 3 * sizeMultiplier;
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
        ctx.stroke();
        if (!dimmed) {
          const pt = (time * 0.0003) % 1;
          const pos = bezierPoint(a.x, a.y, cpx, cpy, b.x, b.y, pt);
          const gr = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, 14 * sizeMultiplier);
          gr.addColorStop(0, "rgba(255, 225, 168, 0.6)");
          gr.addColorStop(0.4, "rgba(255, 177, 92, 0.2)");
          gr.addColorStop(1, "rgba(255, 177, 92, 0)");
          ctx.globalAlpha = 0.8;
          ctx.fillStyle = gr;
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, 14 * sizeMultiplier, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "rgba(255, 241, 204, 0.95)";
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, 2 * sizeMultiplier, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
        continue;
      }

      if (isBridge) {
        drawPath();
        ctx.globalAlpha = dimmed ? 0.05 : 0.2;
        ctx.strokeStyle = "rgba(143, 216, 210, 0.4)";
        ctx.lineWidth = 2.5 * sizeMultiplier;
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
        ctx.stroke();
        if (!dimmed) {
          const pt = (time * 0.00025 + 0.5) % 1;
          const pos = bezierPoint(a.x, a.y, cpx, cpy, b.x, b.y, pt);
          const gr = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, 10 * sizeMultiplier);
          gr.addColorStop(0, "rgba(196, 239, 235, 0.5)");
          gr.addColorStop(0.4, "rgba(143, 216, 210, 0.15)");
          gr.addColorStop(1, "rgba(143, 216, 210, 0)");
          ctx.globalAlpha = 0.7;
          ctx.fillStyle = gr;
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, 10 * sizeMultiplier, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "rgba(230, 251, 249, 0.9)";
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, 1.5 * sizeMultiplier, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
        continue;
      }

      const meta =
        RELATIONSHIP_TYPES[edge.type] ?? RELATIONSHIP_TYPES.related_to;
      const edgeColor = EDGE_COLORS[edge.type] ?? EDGE_COLORS.neutral;
      const pulseColor = EDGE_PULSE[edge.type] ?? EDGE_PULSE.neutral;
      const pa = nodePalette(a.strength, a.conceptType);
      const pb = nodePalette(b.strength, b.conceptType);

      const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      grad.addColorStop(0, emphasized ? pa.rim : edgeColor);
      grad.addColorStop(1, emphasized ? pb.rim : edgeColor);

      if (dimmed) {
        drawPath();
        ctx.globalAlpha = 0.08;
        ctx.strokeStyle = edgeColor;
        ctx.lineWidth = 2 * sizeMultiplier;
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
        ctx.stroke();
        const pt = (time * 0.00015) % 1;
        const pos = bezierPoint(a.x, a.y, cpx, cpy, b.x, b.y, pt);
        const gr = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, 5);
        gr.addColorStop(0, `rgba(${pulseColor}, 0.2)`);
        gr.addColorStop(1, `rgba(${pulseColor}, 0)`);
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        continue;
      }

      const lineWidth = (emphasized ? 4 : 3) * sizeMultiplier;

      drawPath();
      ctx.globalAlpha = emphasized ? 0.18 : 0.12;
      ctx.strokeStyle = edgeColor;
      ctx.lineWidth = lineWidth + 4 * sizeMultiplier;
      ctx.lineCap = "round";
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      ctx.stroke();
      ctx.lineCap = "butt";

      drawPath();
      ctx.globalAlpha = emphasized ? 0.35 : 0.25;
      ctx.strokeStyle = grad;
      ctx.lineWidth = lineWidth;
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      ctx.stroke();

      const pulseCount = emphasized ? 3 : 2;
      const pulseSpeed = emphasized ? 0.0005 : 0.00035;
      const pulseSpacing = 1 / pulseCount;

      for (let i = 0; i < pulseCount; i++) {
        const pt = ((time * pulseSpeed + i * pulseSpacing) % 1 + 1) % 1;
        const pos = bezierPoint(a.x, a.y, cpx, cpy, b.x, b.y, pt);

        const trailLen = emphasized ? 0.1 : 0.07;
        const trailSteps = 5;
        for (let s = trailSteps; s >= 1; s--) {
          const tt = pt - trailLen * (s / trailSteps);
          if (tt < 0 || tt > 1) continue;
          const tp = bezierPoint(a.x, a.y, cpx, cpy, b.x, b.y, tt);
          const trailAlpha = (1 - s / (trailSteps + 1)) * 0.35;
          const trailR = ((emphasized ? 10 : 7) - s * (emphasized ? 1.5 : 1)) * sizeMultiplier;
          const tr = ctx.createRadialGradient(tp.x, tp.y, 0, tp.x, tp.y, Math.max(1, trailR));
          tr.addColorStop(0, `rgba(${pulseColor}, ${trailAlpha})`);
          tr.addColorStop(1, `rgba(${pulseColor}, 0)`);
          ctx.globalAlpha = emphasized ? 0.7 : 0.45;
          ctx.fillStyle = tr;
          ctx.beginPath();
          ctx.arc(tp.x, tp.y, Math.max(1, trailR), 0, Math.PI * 2);
          ctx.fill();
        }

        const glowR = (emphasized ? 18 : 14) * sizeMultiplier;
        const glow = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, glowR);
        glow.addColorStop(0, `rgba(${pulseColor}, ${emphasized ? 0.65 : 0.45})`);
        glow.addColorStop(0.35, `rgba(${pulseColor}, ${emphasized ? 0.22 : 0.12})`);
        glow.addColorStop(1, `rgba(${pulseColor}, 0)`);
        ctx.globalAlpha = emphasized ? 0.9 : 0.7;
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, glowR, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgba(255, 255, 255, ${emphasized ? 0.95 : 0.85})`;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, (emphasized ? 2.8 : 2.2) * sizeMultiplier, 0, Math.PI * 2);
        ctx.fill();
      }

      if (meta.directed) {
        const tx = b.x - cpx;
        const ty = b.y - cpy;
        const tl = Math.max(Math.sqrt(tx * tx + ty * ty), 1);
        const ux = tx / tl;
        const uy = ty / tl;
        const tipX = b.x - ux * (b.radius + 5);
        const tipY = b.y - uy * (b.radius + 5);
        const size = (emphasized ? 7 : 5) * sizeMultiplier;
        ctx.fillStyle = pb.rim;
        ctx.globalAlpha = emphasized ? 0.7 : 0.45;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(
          tipX - ux * size - uy * size * 0.55,
          tipY - uy * size + ux * size * 0.55
        );
        ctx.lineTo(
          tipX - ux * size + uy * size * 0.55,
          tipY - uy * size - ux * size * 0.55
        );
        ctx.closePath();
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }
  }
  private drawSignals(
    signals: SignalSystem,
    nodeById: Map<string, GraphNode>
  ): void {
    const { ctx } = this;
    for (const signal of signals.signals) {
      const trail = signals.trailOf(signal);
      for (let k = 0; k < trail.length; k++) {
        const tp = signals.positionAtProgress(signal, trail[k], nodeById);
        if (!tp) continue;
        const fade = (1 - (k + 1) / (trail.length + 1)) * 0.5;
        const r = Math.max(1, 7 - k);
        const glow = ctx.createRadialGradient(tp.x, tp.y, 0, tp.x, tp.y, r);
        glow.addColorStop(0, signal.color);
        glow.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.globalAlpha = fade;
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(tp.x, tp.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      const pos = signals.positionOf(signal, nodeById);
      if (!pos) continue;
      const fade = Math.sin(Math.PI * clampScalar(signal.progress, 0, 1));
      const glow = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, 11);
      glow.addColorStop(0, signal.color);
      glow.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.globalAlpha = fade;
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#EAFBF9";
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  private drawAmbientParticles(signals: SignalSystem): void {
    const { ctx } = this;
    for (const particle of signals.ambientParticles) {
      if (particle.alpha <= 0.01) continue;
      if (particle.size > 1.6) {
        const glowRadius = particle.size * 4.5;
        const glow = ctx.createRadialGradient(
          particle.x,
          particle.y,
          0,
          particle.x,
          particle.y,
          glowRadius
        );
        glow.addColorStop(0, withAlpha(particle.color, particle.alpha * 0.55));
        glow.addColorStop(0.35, withAlpha(particle.color, particle.alpha * 0.18));
        glow.addColorStop(1, withAlpha(particle.color, 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, glowRadius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = withAlpha(particle.color, particle.alpha);
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawNodes(
    scene: Scene,
    emphasis: Emphasis,
    options: RenderOptions,
    camera: Camera
  ): void {
    for (const node of scene.nodes) {
      const kind = node.kind ?? "concept";
      if (kind === "core") {
        this.drawCoreNode(node, emphasis, options, camera);
        continue;
      }
      if (kind === "document") {
        this.drawDocumentNode(node, emphasis, options, camera);
        continue;
      }
      if (kind === "domain") {
        this.drawDomainNode(node, emphasis, options, camera);
        continue;
      }
      this.drawConceptNode(node, emphasis, options);
    }
  }
  private drawDomainNode(
    node: GraphNode,
    emphasis: Emphasis,
    options: RenderOptions,
    camera: Camera
  ): void {
    const { ctx } = this;
    const dimmed = emphasis.active !== null && !emphasis.active.has(node.id);
    const isSelected = options.selectedId === node.id;
    const isHovered = options.hover?.nodeId === node.id;
    const isHighlighted = options.highlightedIds.has(node.id);
    const pulseStart = this.pulseStarts.get(node.id);
    const color = node.domainColor ?? domainColor(node.domain);
    const r = Math.max(node.radius || 44, 36);
    const time = options.time;
    const reduced = options.reducedMotion;
    const seed = hashSeed(node.id);
    ctx.globalAlpha = dimmed ? 0.55 : 1;
    const halo = ctx.createRadialGradient(node.x, node.y, r * 0.3, node.x, node.y, r * 2.6);
    halo.addColorStop(0, withAlpha(color, 0.26));
    halo.addColorStop(0.55, withAlpha(color, 0.08));
    halo.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(node.x, node.y, r * 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = withAlpha(color, 0.5);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
    ctx.stroke();
    const sweep = reduced ? 0.9 : time * 0.0008 + seed;
    ctx.strokeStyle = withAlpha(color, 0.85);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, sweep, sweep + 1.2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(236, 229, 218, 0.25)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 6]);
    ctx.beginPath();
    ctx.arc(node.x, node.y, r * 1.35, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    const nucleus = r * 0.62;
    const core = ctx.createRadialGradient(
      node.x - nucleus * 0.3,
      node.y - nucleus * 0.35,
      nucleus * 0.12,
      node.x,
      node.y,
      nucleus
    );
    core.addColorStop(0, "#FFF6E0");
    core.addColorStop(0.45, color);
    core.addColorStop(1, withAlpha(color, 0.85));
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(node.x, node.y, nucleus, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = withAlpha(color, 0.9);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    if (isSelected || isHighlighted) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 8, 0, Math.PI * 2);
      ctx.strokeStyle = isSelected
        ? "rgba(143, 216, 210, 0.9)"
        : withAlpha(color, 0.9);
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    if (isHovered) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 13, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(236, 229, 218, 0.3)";
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }
    if (pulseStart !== undefined) {
      const t = (options.time - pulseStart) / 900;
      if (t < 1) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + t * 56, 0, Math.PI * 2);
        ctx.strokeStyle = withAlpha(color, 0.6 * (1 - t));
        ctx.lineWidth = 2.4 * (1 - t) + 0.6;
        ctx.stroke();
      }
    }
    const zoom = camera.zoom;
    const titleScreen = clampScalar(r * zoom * 0.3, 10, 18);
    const titleSize = titleScreen / zoom;
    ctx.font = `600 ${titleSize}px 'Spline Sans Mono', monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#ECE5DA";
    ctx.fillText(node.label.toUpperCase(), node.x, node.y + r + 14 / zoom);
    const metaScreen = clampScalar(r * zoom * 0.2, 8, 12);
    const metaSize = metaScreen / zoom;
    ctx.font = `500 ${metaSize}px 'Spline Sans Mono', monospace`;
    ctx.fillStyle = "rgba(162, 147, 132, 0.9)";
    ctx.fillText(
      `${node.conceptCount ?? 0} memories`,
      node.x,
      node.y + r + 14 / zoom + titleSize * 1.3
    );
    ctx.globalAlpha = 1;
  }
  private drawCoreNode(
    node: GraphNode,
    emphasis: Emphasis,
    options: RenderOptions,
    camera: Camera
  ): void {
    const { ctx } = this;
    const dimmed = emphasis.active !== null && !emphasis.active.has(node.id);
    const isSelected = options.selectedId === node.id;
    const isHovered = options.hover?.nodeId === node.id;
    const isHighlighted = options.highlightedIds.has(node.id);
    const pulseStart = this.pulseStarts.get(node.id);
    const r = Math.max(node.radius || 32, 26);
    const time = options.time;
    const reduced = options.reducedMotion;
    const seed = hashSeed(node.id);

    ctx.globalAlpha = dimmed ? 0.5 : 1;
    ctx.save();
    ctx.translate(node.x, node.y);

    const breathe = reduced ? 1 : 1 + Math.sin(time * 0.0011 + seed) * 0.04;
    const nucleus = r * 0.58 * breathe;

    const halo = ctx.createRadialGradient(0, 0, nucleus * 0.4, 0, 0, r * 2.4);
    halo.addColorStop(0, "rgba(255, 177, 92, 0.22)");
    halo.addColorStop(0.5, "rgba(255, 138, 61, 0.08)");
    halo.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(255, 138, 61, 0.38)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();

    const tickSpin = reduced ? 0 : time * 0.00012;
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2 + tickSpin;
      const major = i % 3 === 0;
      const inner = r + 3;
      const outer = r + (major ? 9 : 6);
      ctx.strokeStyle = `rgba(236, 229, 218, ${major ? 0.32 : 0.15})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ang) * inner, Math.sin(ang) * inner);
      ctx.lineTo(Math.cos(ang) * outer, Math.sin(ang) * outer);
      ctx.stroke();
    }

    const sweep = reduced ? 0.9 : time * 0.0009 + seed;
    ctx.strokeStyle = "rgba(255, 177, 92, 0.75)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, r, sweep, sweep + 1.25);
    ctx.stroke();
    ctx.strokeStyle = "rgba(196, 239, 235, 0.5)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(0, 0, r, sweep + Math.PI, sweep + Math.PI + 0.7);
    ctx.stroke();

    const gyro1Rot = reduced ? 0.6 : time * 0.00045;
    ctx.strokeStyle = "rgba(143, 216, 210, 0.4)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.42, r * 0.5, gyro1Rot, 0, Math.PI * 2);
    ctx.stroke();

    const gyro2Rot = reduced ? -0.5 : -time * 0.00032;
    ctx.strokeStyle = "rgba(255, 225, 168, 0.26)";
    ctx.lineWidth = 0.9;
    ctx.setLineDash([3, 6]);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.78, r * 0.62, gyro2Rot, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    const ellipsePoint = (
      rx: number,
      ry: number,
      rot: number,
      a: number
    ): { x: number; y: number } => {
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const cr = Math.cos(rot);
      const sr = Math.sin(rot);
      return {
        x: rx * ca * cr - ry * sa * sr,
        y: rx * ca * sr + ry * sa * cr,
      };
    };

    const sparks = [
      { rx: r, ry: r, rot: 0, speed: 0.0011, phase: seed, size: 2.4, color: "255, 177, 92" },
      { rx: r * 1.42, ry: r * 0.5, rot: gyro1Rot, speed: -0.0007, phase: seed + 2.2, size: 2, color: "143, 216, 210" },
      { rx: r * 1.78, ry: r * 0.62, rot: gyro2Rot, speed: 0.0005, phase: seed + 4.4, size: 1.7, color: "255, 225, 168" },
    ];
    for (const spark of sparks) {
      const a = reduced ? spark.phase : time * spark.speed + spark.phase;
      const p = ellipsePoint(spark.rx, spark.ry, spark.rot, a);
      const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, spark.size * 3.2);
      glow.addColorStop(0, `rgba(${spark.color}, 0.5)`);
      glow.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(p.x, p.y, spark.size * 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(${spark.color}, 0.9)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, spark.size, 0, Math.PI * 2);
      ctx.fill();
    }

    const core = ctx.createRadialGradient(
      -nucleus * 0.3,
      -nucleus * 0.35,
      nucleus * 0.1,
      0,
      0,
      nucleus
    );
    core.addColorStop(0, "#FFF1CC");
    core.addColorStop(0.45, "#FFB15C");
    core.addColorStop(1, "rgba(200, 85, 31, 0.95)");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, nucleus, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 177, 92, 0.8)";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    if (!reduced) {
      const arc = time * 0.0012 + seed;
      ctx.strokeStyle = "rgba(255, 241, 204, 0.55)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(0, 0, nucleus * 0.72, arc, arc + 1.3);
      ctx.stroke();
    }

    if (isSelected || isHighlighted) {
      ctx.beginPath();
      ctx.arc(0, 0, r + 8, 0, Math.PI * 2);
      ctx.strokeStyle = isSelected
        ? "rgba(143, 216, 210, 0.9)"
        : "rgba(255, 177, 92, 0.9)";
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    if (isHovered) {
      ctx.beginPath();
      ctx.arc(0, 0, r + 13, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(236, 229, 218, 0.3)";
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }
    if (pulseStart !== undefined) {
      const t = (options.time - pulseStart) / 900;
      if (t < 1) {
        ctx.beginPath();
        ctx.arc(0, 0, r + t * 56, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 177, 92, ${0.6 * (1 - t)})`;
        ctx.lineWidth = 2.4 * (1 - t) + 0.6;
        ctx.stroke();
      }
    }

    ctx.restore();

    const zoom = camera.zoom;
    const titleScreen = clampScalar(r * zoom * 0.32, 10, 18);
    const titleSize = titleScreen / zoom;
    ctx.font = `600 ${titleSize}px 'Spline Sans Mono', monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#ECE5DA";
    ctx.fillText(node.label, node.x, node.y + r + 16 / zoom);
    const metaScreen = clampScalar(r * zoom * 0.2, 8, 12);
    const metaSize = metaScreen / zoom;
    ctx.font = `500 ${metaSize}px 'Spline Sans Mono', monospace`;
    ctx.fillStyle = "rgba(162, 147, 132, 0.9)";
    ctx.fillText(
      `${node.accessCount ?? 0} memories`,
      node.x,
      node.y + r + 16 / zoom + titleSize * 1.3
    );
    ctx.globalAlpha = 1;
  }

  private drawDocumentNode(
    node: GraphNode,
    emphasis: Emphasis,
    options: RenderOptions,
    camera: Camera
  ): void {
    const { ctx } = this;
    const dimmed = emphasis.active !== null && !emphasis.active.has(node.id);
    const isSelected = options.selectedId === node.id;
    const isHovered = options.hover?.nodeId === node.id;
    const isHighlighted = options.highlightedIds.has(node.id);
    const pulseStart = this.pulseStarts.get(node.id);
    const solo = node.solo === true || node.documentState === "solo";
    const expanded = node.expanded === true;
    const w = node.boxWidth ?? 188;
    const h = node.boxHeight ?? 72;
    const x = node.x - w / 2;
    const y = node.y - h / 2;
    const radius = 18;
    ctx.globalAlpha = dimmed ? 0.5 : 1;
    const glow = ctx.createRadialGradient(
      node.x,
      node.y,
      10,
      node.x,
      node.y,
      Math.max(w, h) * 0.9
    );
    glow.addColorStop(
      0,
      solo ? "rgba(162, 147, 132, 0.2)" : "rgba(255, 138, 61, 0.24)"
    );
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(node.x, node.y, Math.max(w, h) * 0.9, 0, Math.PI * 2);
    ctx.fill();
    const panel = ctx.createLinearGradient(x, y, x, y + h);
    panel.addColorStop(0, "rgba(27, 21, 18, 0.94)");
    panel.addColorStop(1, "rgba(18, 14, 11, 0.94)");
    this.roundRect(x, y, w, h, radius);
    ctx.fillStyle = panel;
    ctx.fill();
    ctx.setLineDash(solo ? [6, 5] : []);
    ctx.lineWidth = isSelected || isHighlighted ? 2 : 1.4;
    ctx.strokeStyle = isSelected
      ? "rgba(143, 216, 210, 0.95)"
      : isHighlighted
        ? "rgba(255, 177, 92, 0.9)"
        : solo
          ? "rgba(162, 147, 132, 0.5)"
          : expanded
            ? "rgba(255, 138, 61, 0.58)"
            : "rgba(255, 138, 61, 0.4)";
    this.roundRect(x, y, w, h, radius);
    ctx.stroke();
    ctx.setLineDash([]);
    const accent = ctx.createLinearGradient(x, y, x + w, y);
    accent.addColorStop(0, "rgba(255, 138, 61, 0.55)");
    accent.addColorStop(1, "rgba(255, 138, 61, 0.02)");
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + radius, y + 1);
    ctx.lineTo(x + w - radius, y + 1);
    ctx.stroke();
    const zoom = camera.zoom;
    const pad = 14;
    const titleScreen = clampScalar(h * zoom * 0.22, 7, 220);
    const titleSize = titleScreen / zoom;
    ctx.font = `600 ${titleSize}px 'Spline Sans Mono', monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const maxTextWidth = w - pad * 2 - 36;
    const label = this.fitText(node.label, maxTextWidth);
    ctx.fillStyle = solo ? "rgba(236, 229, 218, 0.82)" : "#ECE5DA";
    ctx.fillText(label, x + pad, y + h * 0.38);
    const metaScreen = clampScalar(h * zoom * 0.16, 6, 160);
    const metaSize = metaScreen / zoom;
    ctx.font = `500 ${metaSize}px 'Spline Sans Mono', monospace`;
    const count = node.conceptCount ?? 0;
    const linked = node.connectedConceptCount ?? 0;
    const islands = node.isolatedConceptCount ?? 0;
    const meta = solo
      ? `${count} memories · solo`
      : `${count} memories · ${linked} linked · ${islands} islands`;
    ctx.fillStyle = "rgba(162, 147, 132, 0.9)";
    ctx.fillText(this.fitText(meta, maxTextWidth), x + pad, y + h * 0.68);
    const badgeText = String(count);
    const badgeScreen = clampScalar(h * zoom * 0.16, 6, 160);
    const badgeSize = badgeScreen / zoom;
    ctx.font = `600 ${badgeSize}px 'Spline Sans Mono', monospace`;
    const badgeWidth = ctx.measureText(badgeText).width + badgeSize * 1.5;
    const bx = x + w - badgeWidth - 8;
    const by = y + 8;
    this.roundRect(bx, by, badgeWidth, badgeSize * 1.6, badgeSize * 0.8);
    ctx.fillStyle = solo
      ? "rgba(162, 147, 132, 0.75)"
      : "rgba(255, 138, 61, 0.85)";
    ctx.fill();
    ctx.fillStyle = "#17100C";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(badgeText, bx + badgeWidth / 2, by + badgeSize * 0.8);
    if (isSelected || isHighlighted) {
      this.roundRect(x - 5, y - 5, w + 10, h + 10, radius + 4);
      ctx.strokeStyle = isSelected
        ? "rgba(143, 216, 210, 0.75)"
        : "rgba(255, 177, 92, 0.7)";
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    if (isHovered) {
      this.roundRect(x - 9, y - 9, w + 18, h + 18, radius + 7);
      ctx.strokeStyle = "rgba(236, 229, 218, 0.25)";
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }
    if (pulseStart !== undefined) {
      const t = (options.time - pulseStart) / 900;
      if (t < 1) {
        ctx.globalAlpha = (1 - t) * 0.6;
        this.roundRect(
          x - t * 18,
          y - t * 18,
          w + t * 36,
          h + t * 36,
          radius + t * 12
        );
        ctx.strokeStyle = "rgba(255, 177, 92, 1)";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawConceptNode(
    node: GraphNode,
    emphasis: Emphasis,
    options: RenderOptions
  ): void {
    const { ctx } = this;
    const dimmed = emphasis.active !== null && !emphasis.active.has(node.id);
    const palette = nodePalette(node.strength, node.conceptType);
    const seed = hashSeed(node.id);
    const isCritical = node.category === "critical";
    const isForgotten = node.category === "forgotten";
    const isStrong = node.category === "strong";
    const isIsland = node.island === true;
    const flicker =
      !options.reducedMotion && isCritical ? flickerAt(options.time, seed) : 1;
    const breathe = options.reducedMotion
      ? 1
      : 1 +
      Math.sin(options.time * 0.0012 + seed) *
      0.03 *
      (isStrong ? 1 : 0.4);
    const r = Math.max(node.radius, 12) * breathe;
    const isSelected = options.selectedId === node.id;
    const isHovered = options.hover?.nodeId === node.id;
    const isHighlighted = options.highlightedIds.has(node.id);
    const pulseStart = this.pulseStarts.get(node.id);
    const typeCol = typeColor(node.conceptType);
    const catCol = categoryColor(node.category);

    ctx.globalAlpha = (dimmed ? 0.42 : 1) * flicker * (isIsland ? 0.85 : 1);

    if (!isForgotten) {
      const glowRadius =
        r *
        (isCritical ? 2.6 : 2.1) *
        (isHovered || isHighlighted || isSelected ? 1.3 : 1) *
        (isIsland ? 0.7 : 1);
      const glow = ctx.createRadialGradient(
        node.x,
        node.y,
        r * 0.3,
        node.x,
        node.y,
        glowRadius
      );
      glow.addColorStop(0, withAlpha(typeCol, 0.16));
      glow.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(node.x, node.y, glowRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    const nucleus = r * 0.5;
    const core = ctx.createRadialGradient(
      node.x - nucleus * 0.3,
      node.y - nucleus * 0.35,
      nucleus * 0.12,
      node.x,
      node.y,
      nucleus
    );
    core.addColorStop(0, isForgotten ? "#3E3833" : palette.core);
    core.addColorStop(1, isForgotten ? "#2A2521" : palette.rim);
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(node.x, node.y, nucleus, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = withAlpha(typeCol, dimmed ? 0.25 : isForgotten ? 0.35 : 0.75);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(node.x, node.y, r * 0.78, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = withAlpha(catCol, 0.16);
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = withAlpha(catCol, isForgotten ? 0.4 : 0.9);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(
      node.x,
      node.y,
      r,
      -Math.PI / 2,
      -Math.PI / 2 + Math.max(0.05, node.strength) * Math.PI * 2
    );
    ctx.stroke();
    ctx.lineCap = "butt";

    if (isIsland) {
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = "rgba(162, 147, 132, 0.55)";
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (isStrong && !options.reducedMotion && !isForgotten) {
      const ang = options.time * 0.0011 + seed;
      ctx.beginPath();
      ctx.arc(node.x, node.y, nucleus * 0.72, ang, ang + 1.3);
      ctx.strokeStyle = "rgba(255, 241, 204, 0.5)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    if (isSelected || isHighlighted) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 5.5, 0, Math.PI * 2);
      ctx.strokeStyle = isSelected
        ? "rgba(143, 216, 210, 0.9)"
        : "rgba(255, 177, 92, 0.9)";
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }
    if (isHovered) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 9, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(236, 229, 218, 0.35)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    if (pulseStart !== undefined) {
      const t = (options.time - pulseStart) / 900;
      if (t < 1) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + t * 46, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 177, 92, ${0.65 * (1 - t)})`;
        ctx.lineWidth = 2.4 * (1 - t) + 0.6;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawLabels(
    scene: Scene,
    emphasis: Emphasis,
    options: RenderOptions,
    camera: Camera,
    width: number,
    height: number
  ): void {
    if (!options.showLabels) return;

    const zoom = camera.zoom;
    const { ctx } = this;

    const forceLabels = emphasis.active;
    const hasForced = forceLabels !== null && forceLabels.size > 0;

    if (!hasForced && zoom < 1.5) return;

    const s = 1 / zoom;
    const labelSize = clampScalar(11 * s, 4, 26);
    const metaSize = labelSize * 0.78;
    const showMeta = zoom >= 0.9;

    const degree = new Map<string, number>();
    for (const edge of scene.edges) {
      degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
      degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
    }

    const zoomFade = clampScalar((zoom - 1.5) / 0.5, 0, 1);

    const maxLabels = hasForced
      ? Math.max(20, Math.round((width * height) / 12000))
      : Math.max(6, Math.min(60, Math.round((width * height) / 18000)));

    const candidates: LabelCandidate[] = [];

    for (const node of scene.nodes) {
      const kind = node.kind ?? "concept";
      if (kind !== "concept") continue;

      const isHovered = options.hover?.nodeId === node.id;
      const isSelected = options.selectedId === node.id;
      const isHighlighted = options.highlightedIds.has(node.id);
      const isIsland = node.island === true;

      const isForced = hasForced && forceLabels!.has(node.id);

      if (!isForced) {
        if (zoom < 1.5) continue;
        if (zoom < 1.8 && node.importance < 8) continue;
        if (zoom < 2.0 && node.importance < 6) continue;
        if (zoom < 2.5 && node.importance < 4) continue;
      }

      const screen = camera.worldToScreen(node.x, node.y, width, height);
      if (
        screen.x < -80 ||
        screen.x > width + 80 ||
        screen.y < -80 ||
        screen.y > height + 80
      )
        continue;

      const name = truncateLabel(node.label);
      ctx.font = `500 ${labelSize}px "Spline Sans Mono", monospace`;
      const nameW = ctx.measureText(name).width;

      const meta = showMeta
        ? `${Math.round(node.strength * 100)}% · ${degree.get(node.id) ?? 0} links`
        : null;
      let metaW = 0;
      if (meta !== null) {
        ctx.font = `500 ${metaSize}px "Spline Sans Mono", monospace`;
        metaW = ctx.measureText(meta).width;
      }

      const padX = 8 * s;
      const padTop = 5 * s;
      const padBottom = 5 * s;
      const dotR = Math.max(1.3 * s, labelSize * 0.14);
      const innerLeft = padX + dotR + 5 * s;
      const textW = Math.max(nameW, metaW);
      const cardW = innerLeft + textW + padX;
      const line1H = labelSize * 1.25;
      const line2H = meta !== null ? metaSize * 1.35 : 0;
      const cardH = padTop + line1H + line2H + padBottom;
      const top = node.y + node.radius + 6;
      const x0 = node.x - cardW / 2;
      const screenW = cardW * zoom;
      const screenH = cardH * zoom;
      const topScreenY = screen.y + node.radius * zoom + 6 * zoom;

      let priority =
        (isForced ? 1e9 : 0) +
        (isHovered ? 1e8 : 0) +
        (isSelected ? 1e7 : 0) +
        (isHighlighted ? 1e6 : 0) +
        (node.clusterAnchor ? 1e5 : 0) +
        node.strength * 1000 +
        node.importance * 20;
      if (isIsland) priority -= 50000;

      candidates.push({
        x0,
        top,
        cardW,
        cardH,
        dotX: x0 + padX + dotR,
        dotY: top + padTop + line1H / 2,
        dotR,
        name,
        nameX: x0 + innerLeft,
        nameY: top + padTop + line1H / 2,
        nameSize: labelSize,
        meta,
        metaX: x0 + innerLeft,
        metaY: top + padTop + line1H + line2H / 2,
        metaSize,
        screenRect: {
          x: screen.x - screenW / 2 - 3,
          y: topScreenY - 3,
          w: screenW + 6,
          h: screenH + 6,
        },
        priority,
        forced: isForced,
        bright: isForced || isHovered || isSelected || isHighlighted,
        dot: isIsland ? "#A29384" : typeColor(node.conceptType),
        borderW: s,
      });
    }

    candidates.sort((a, b) => b.priority - a.priority);
    const placed: Rect[] = [];
    let shown = 0;
    for (const c of candidates) {
      const collides = placed.some((p) => overlaps(c.screenRect, p));
      if (!c.forced && (shown >= maxLabels || collides)) continue;
      this.drawLabel(c, c.forced ? 1 : zoomFade);
      placed.push(c.screenRect);
      if (!c.forced) shown++;
    }
  }

  private drawLabel(c: LabelCandidate, fade: number): void {
    const { ctx } = this;
    ctx.globalAlpha = fade;
    const radius = Math.min(6 * c.borderW, c.cardH / 2);
    ctx.fillStyle = c.bright ? "rgba(14, 11, 9, 0.85)" : "rgba(14, 11, 9, 0.62)";
    this.roundRect(c.x0, c.top, c.cardW, c.cardH, radius);
    ctx.fill();
    ctx.strokeStyle = withAlpha(c.dot, c.bright ? 0.55 : 0.28);
    ctx.lineWidth = c.borderW;
    this.roundRect(c.x0, c.top, c.cardW, c.cardH, radius);
    ctx.stroke();
    ctx.fillStyle = c.dot;
    ctx.beginPath();
    ctx.arc(c.dotX, c.dotY, c.dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `500 ${c.nameSize}px "Spline Sans Mono", monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = c.bright ? "#ECE5DA" : "rgba(236, 229, 218, 0.85)";
    ctx.fillText(c.name, c.nameX, c.nameY);
    if (c.meta !== null) {
      ctx.font = `500 ${c.metaSize}px "Spline Sans Mono", monospace`;
      ctx.fillStyle = "rgba(162, 147, 132, 0.9)";
      ctx.fillText(c.meta, c.metaX, c.metaY);
    }
    ctx.globalAlpha = 1;
  }

  private fitText(text: string, maxWidth: number): string {
    if (maxWidth <= 0) return "";
    const { ctx } = this;
    if (ctx.measureText(text).width <= maxWidth) return text;
    let value = text;
    while (
      value.length > 1 &&
      ctx.measureText(`${value}\u2026`).width > maxWidth
    ) {
      value = value.slice(0, -1);
    }
    return `${value}\u2026`;
  }

  private roundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  private drawScanline(
    time: number,
    width: number,
    height: number
  ): void {
    const { ctx } = this;
    const period = 1800;
    const t = (time % period) / period;
    const bandWidth = width * 0.28;
    const x = -bandWidth + t * (width + bandWidth * 2);
    const grad = ctx.createLinearGradient(x, 0, x + bandWidth, 0);
    grad.addColorStop(0, "rgba(143, 216, 210, 0)");
    grad.addColorStop(0.5, "rgba(143, 216, 210, 0.07)");
    grad.addColorStop(1, "rgba(143, 216, 210, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, bandWidth, height);
    ctx.fillStyle = grad;
    ctx.fillRect(x, 0, bandWidth, height);
  }
}

function hashSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) % 997;
  }
  return h;
}

function flickerAt(time: number, seed: number): number {
  const t = time * 0.001;
  const v =
    Math.sin(t * 6.3 + seed) * 0.4 +
    Math.sin(t * 11.7 + seed * 1.7) * 0.3 +
    Math.sin(t * 19.3 + seed * 3.1) * 0.3;
  return 0.62 + v * 0.38;
}

function truncateLabel(label: string): string {
  return label.length > 24 ? `${label.substring(0, 22)}\u2026` : label;
}
