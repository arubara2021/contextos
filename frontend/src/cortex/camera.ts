import type { GraphNode } from "./types";

export interface FitInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const FIT_CAP = 3.8;
const FIT_CAP_MOBILE = 1.8;
const FOCUS_CAP = 3.5;
const FOCUS_CAP_MOBILE = 2.8;
const FIT_PADDING = 0.94;
const FIT_PADDING_MOBILE = 0.98;
const EASE_SPEED = 9;

function mobileViewport(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 767px)").matches
  );
}

export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  rotation = 0;
  private animating = false;
  private tx = 0;
  private ty = 0;
  private tzoom = 1;
  private trotation = 0;


  private clampZoom(z: number): number {
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
  }

  private cancelAnim(): void {
    this.animating = false;
    this.tx = this.x;
    this.ty = this.y;
    this.tzoom = this.zoom;
    this.trotation = this.rotation;
  }

  worldToScreen(
    wx: number,
    wy: number,
    width: number,
    height: number
  ): { x: number; y: number } {
    return {
      x: (wx - this.x) * this.zoom + width / 2,
      y: (wy - this.y) * this.zoom + height / 2,
    };
  }

  screenToWorld(
    sx: number,
    sy: number,
    width: number,
    height: number
  ): { x: number; y: number } {
    return {
      x: (sx - width / 2) / this.zoom + this.x,
      y: (sy - height / 2) / this.zoom + this.y,
    };
  }

  animateTo(x: number, y: number, zoom: number): void {
    this.tx = x;
    this.ty = y;
    this.tzoom = this.clampZoom(zoom);
    this.trotation = this.rotation;
    this.animating = true;
  }

  private nodeBounds(node: GraphNode): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } {
    const kind = node.kind ?? "concept";
    if (kind === "document") {
      const w = node.boxWidth ?? 188;
      const h = node.boxHeight ?? 72;
      return {
        minX: node.x - w / 2,
        minY: node.y - h / 2,
        maxX: node.x + w / 2,
        maxY: node.y + h / 2,
      };
    }
    if (kind === "core") {
      const r = Math.max(node.radius || 32, (node.boxWidth ?? 64) / 2);
      return {
        minX: node.x - r,
        minY: node.y - r,
        maxX: node.x + r,
        maxY: node.y + r,
      };
    }
    const r = node.radius || 8;
    return {
      minX: node.x - r,
      minY: node.y - r,
      maxX: node.x + r,
      maxY: node.y + r,
    };
  }

  fit(
    nodes: GraphNode[],
    width: number,
    height: number,
    insets: FitInsets
  ): void {
    if (nodes.length === 0 || width <= 0 || height <= 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      const bounds = this.nodeBounds(node);
      if (bounds.minX < minX) minX = bounds.minX;
      if (bounds.minY < minY) minY = bounds.minY;
      if (bounds.maxX > maxX) maxX = bounds.maxX;
      if (bounds.maxY > maxY) maxY = bounds.maxY;
    }
    if (!isFinite(minX)) return;
    const bboxW = Math.max(maxX - minX, 1);
    const bboxH = Math.max(maxY - minY, 1);
    const availW = Math.max(width - insets.left - insets.right, 40);
    const availH = Math.max(height - insets.top - insets.bottom, 40);
    const padding = mobileViewport() ? FIT_PADDING_MOBILE : FIT_PADDING;
    const cap = mobileViewport() ? FIT_CAP_MOBILE : FIT_CAP;
    const first = this.clampZoom(
      Math.min((availW / bboxW) * padding, (availH / bboxH) * padding, cap)
    );
    const labelPad = 46 / first;
    const zoom = this.clampZoom(
      Math.min(
        (availW / (bboxW + labelPad * 2)) * padding,
        (availH / (bboxH + labelPad * 2)) * padding,
        cap
      )
    );
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const screenCX = insets.left + availW / 2;
    const screenCY = insets.top + availH / 2;
    this.tzoom = zoom;
    this.tx = centerX - (screenCX - width / 2) / zoom;
    this.ty = centerY - (screenCY - height / 2) / zoom;
    if (!this.animating && this.zoom === 1 && this.x === 0 && this.y === 0) {
      this.x = this.tx;
      this.y = this.ty;
      this.zoom = this.tzoom;
    }
    this.animating = true;
    this.trotation = this.rotation;
  }

  focusOn(node: GraphNode, zoom: number): void {
    this.tzoom = this.clampZoom(zoom);
    this.tx = node.x;
    this.ty = node.y;
    this.trotation = this.rotation;
    this.animating = true;
  }

  focusNode(
    node: GraphNode,
    width: number,
    height: number,
    insets: FitInsets,
    padding = 0.35
  ): void {
    if (width <= 0 || height <= 0) return;
    const bounds = this.nodeBounds(node);
    const bboxW = Math.max(bounds.maxX - bounds.minX, 1);
    const bboxH = Math.max(bounds.maxY - bounds.minY, 1);
    const targetW = bboxW * (1 + padding) + 120;
    const targetH = bboxH * (1 + padding) + 120;
    const availW = Math.max(width - insets.left - insets.right, 40);
    const availH = Math.max(height - insets.top - insets.bottom, 40);
    const cap = mobileViewport() ? FOCUS_CAP_MOBILE : FOCUS_CAP;
    const zoom = this.clampZoom(
      Math.min(availW / targetW, availH / targetH, cap)
    );
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    const screenCX = insets.left + availW / 2;
    const screenCY = insets.top + availH / 2;
    this.tzoom = zoom;
    this.tx = centerX - (screenCX - width / 2) / zoom;
    this.ty = centerY - (screenCY - height / 2) / zoom;
    this.animating = true;
    this.trotation = this.rotation;
  }

  focusDocument(
    node: GraphNode,
    width: number,
    height: number,
    insets: FitInsets
  ): void {
    this.focusNode(node, width, height, insets, 0.45);
  }

  focusCore(
    nodes: GraphNode[],
    width: number,
    height: number,
    insets: FitInsets
  ): void {
    const core = nodes.find((node) => (node.kind ?? "concept") === "core");
    if (core) {
      this.focusNode(core, width, height, insets, 0.8);
      return;
    }
    this.fit(nodes, width, height, insets);
  }

  zoomByWheel(
    ox: number,
    oy: number,
    deltaY: number,
    width: number,
    height: number
  ): void {
    const factor = Math.exp(-deltaY * 0.0025);
    this.zoomAt(ox, oy, factor, width, height);
  }

  zoomAt(
    cx: number,
    cy: number,
    factor: number,
    width: number,
    height: number
  ): void {
    this.cancelAnim();
    const before = this.screenToWorld(cx, cy, width, height);
    const next = this.clampZoom(this.zoom * factor);
    if (next === this.zoom) return;
    this.zoom = next;
    this.x = before.x - (cx - width / 2) / this.zoom;
    this.y = before.y - (cy - height / 2) / this.zoom;
  }

  panBy(dx: number, dy: number): void {
    this.cancelAnim();
    const cos = Math.cos(-this.rotation);
    const sin = Math.sin(-this.rotation);
    const rdx = (dx * cos - dy * sin) / this.zoom;
    const rdy = (dx * sin + dy * cos) / this.zoom;
    this.x -= rdx;
    this.y -= rdy;
  }

  update(dt: number): void {
    if (!this.animating) return;
    const f = 1 - Math.exp(-dt * EASE_SPEED);
    this.x += (this.tx - this.x) * f;
    this.y += (this.ty - this.y) * f;
    this.zoom = Math.exp(
      Math.log(this.zoom) + (Math.log(this.tzoom) - Math.log(this.zoom)) * f
    );
    this.rotation += (this.trotation - this.rotation) * f;
    const close =
      Math.abs(this.tx - this.x) < 0.05 &&
      Math.abs(this.ty - this.y) < 0.05 &&
      Math.abs(this.tzoom - this.zoom) < 0.002 &&
      Math.abs(this.trotation - this.rotation) < 0.001;
    if (close) {
      this.x = this.tx;
      this.y = this.ty;
      this.zoom = this.tzoom;
      this.rotation = this.trotation;
      this.animating = false;
    }
  }
  rotateBy(angle: number): void {
    this.cancelAnim();
    this.rotation += angle;
    this.trotation = this.rotation;
  }

  rotateTo(angle: number): void {
    this.rotation = angle;
    this.trotation = angle;
  }

  resetRotation(): void {
    this.trotation = 0;
    this.animating = true;
  }
}