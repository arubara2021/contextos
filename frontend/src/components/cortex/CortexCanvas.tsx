import { useEffect, useRef } from "react";
import type {
  MouseEvent as CanvasMouseEvent,
  PointerEvent as CanvasPointerEvent,
} from "react";
import { Camera } from "../../cortex/camera";
import type { FitInsets } from "../../cortex/camera";
import { ForceSimulation } from "../../cortex/simulation";
import { SignalSystem } from "../../cortex/signals";
import { CortexRenderer } from "../../cortex/renderer";
import { applyLayout } from "../../cortex/layouts";
import { findNodeAt, edgesTouching } from "../../cortex/hitTest";
import { buildScene } from "../../cortex/types";
import type {
  CortexLayoutMode,
  GraphEdge,
  GraphNode,
  LayoutMode,
  Scene,
} from "../../cortex/types";
import { ScanlineOverlay } from "./ScanlineOverlay";

interface CortexCanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  layout: LayoutMode;
  sceneMode?: "core" | "document" | "domain" | "graph";
  onDomainClick?: (node: GraphNode) => void;
  highlightedIds: string[];
  selectedId: string | null;
  focusedId: string | null;
  pulseIds: string[];
  retrieving: boolean;
  panelsHidden?: boolean;
  fitSignal?: number;
  drawerOpen?: boolean;
  sheetOpen?: boolean;
  onCoreClick?: () => void;
  onDocumentClick?: (node: GraphNode) => void;
  onDocumentOpen?: (node: GraphNode) => void;
  onConceptClick?: (node: GraphNode) => void;
  onNodeClick?: (node: GraphNode) => void;
  onBackgroundClick: () => void;
}

interface EngineBundle {
  simulation: ForceSimulation;
  camera: Camera;
  signals: SignalSystem;
  renderer: CortexRenderer;
}

interface PointerPoint {
  x: number;
  y: number;
}

interface RailQueueItem {
  edgeId: string;
  at: number;
  reverse: boolean;
  speed: number;
  color?: string;
}

function computeInsets(
  width: number,
  drawerOpen: boolean,
  sheetOpen: boolean
): FitInsets {
  if (width < 768) {
    return {
      left: 14,
      right: 14,
      top: 108,
      bottom: sheetOpen ? 280 : 80,
    };
  }
  return {
    left: 26,
    right: drawerOpen ? 420 : 26,
    top: 118,
    bottom: 92,
  };
}

const TOUCH_TAP_THRESHOLD = 8;
const MOUSE_TAP_THRESHOLD = 3;
const TOUCH_TAP_TIME = 550;
const MOUSE_TAP_TIME = 400;




export function CortexCanvas(props: CortexCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<EngineBundle | null>(null);
  const sceneRef = useRef<Scene>({ nodes: [], edges: [], nodeById: new Map() });
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const hoverRef = useRef<{ nodeId: string; x: number; y: number } | null>(
    null
  );
  const layoutRef = useRef<LayoutMode>(props.layout);
  const sceneModeRef = useRef<"core" | "document" | "domain" | "graph">(
    props.sceneMode ?? "graph"
  );
  const structureRef = useRef("");
  const hasInitialFitRef = useRef(false);
  const reducedRef = useRef(false);
  const railQueueRef = useRef<RailQueueItem[]>([]);
  const pointersRef = useRef<Map<number, PointerPoint>>(new Map());
  const pinchRef = useRef<{
    dist: number;
    cx: number;
    cy: number;
    angle: number;
  } | null>(null);
  const downRef = useRef<{
    x: number;
    y: number;
    t: number;
    node: GraphNode | null;
    moved: boolean;
    touch: boolean;
  } | null>(null);
  const lastSingleRef = useRef<PointerPoint | null>(null);
  const dragNodeRef = useRef<GraphNode | null>(null);
  const grabHadPinRef = useRef(false);
  const grabWasHeldRef = useRef(false);
  const grabScreenRef = useRef<PointerPoint>({ x: 0, y: 0 });
  const grabWorldRef = useRef<PointerPoint>({ x: 0, y: 0 });
  const refitRef = useRef<() => void>(() => { });
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      reducedRef.current = mq.matches;
      engineRef.current?.simulation.setReducedMotion(mq.matches);
    };
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: TouchEvent) => {
      e.preventDefault();
    };
    canvas.addEventListener("touchstart", handler, { passive: false });
    return () => {
      canvas.removeEventListener("touchstart", handler);
    };
  }, []);

  const applyCurrentLayout = () => {
    const mode: CortexLayoutMode =
      sceneModeRef.current === "core"
        ? "core"
        : sceneModeRef.current === "document"
          ? "document"
          : sceneModeRef.current === "domain"
            ? "document"
            : layoutRef.current;
    applyLayout(sceneRef.current.nodes, mode);
  };

  const fireRails = (nodeId: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    const touching = edgesTouching(nodeId, sceneRef.current.edges)
      .slice()
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 14);
    if (touching.length === 0) return;
    const now = performance.now();
    touching.forEach((edge, index) => {
      const outward = edge.source === nodeId;
      railQueueRef.current.push({
        edgeId: edge.id,
        at: now + index * 70,
        reverse: !outward,
        speed: 1.15 + Math.random() * 0.45,
      });
      railQueueRef.current.push({
        edgeId: edge.id,
        at: now + 520 + index * 70,
        reverse: outward,
        speed: 0.72,
        color: "rgba(196, 239, 235, 0.85)",
      });
    });
    if (railQueueRef.current.length > 80) {
      railQueueRef.current = railQueueRef.current.slice(-80);
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const renderer = new CortexRenderer(context);
    const simulation = new ForceSimulation();
    const camera = new Camera();
    const signals = new SignalSystem();
    simulation.setReducedMotion(reducedRef.current);
    engineRef.current = { simulation, camera, signals, renderer };
    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sizeRef.current = { width: rect.width, height: rect.height, dpr };
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      refitRef.current();
    };
    refitRef.current = () => {
      const scene = sceneRef.current;
      if (scene.nodes.length === 0) return;
      const { width, height } = sizeRef.current;
      const current = propsRef.current;
      engineRef.current?.camera.fit(
        scene.nodes,
        width,
        height,
        computeInsets(
          width,
          current.drawerOpen ?? false,
          current.sheetOpen ?? false
        )
      );
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    window.addEventListener("resize", resize);
    const onWheelNative = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = canvas.getBoundingClientRect();
      const ox = event.clientX - rect.left;
      const oy = event.clientY - rect.top;
      const { width, height } = sizeRef.current;
      camera.zoomByWheel(ox, oy, event.deltaY, width, height);
    };
    canvas.addEventListener("wheel", onWheelNative, { passive: false });
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const { width, height, dpr } = sizeRef.current;
      simulation.setHovering(hoverRef.current != null);
      simulation.tick(dt);
      camera.update(dt);
      signals.update(dt);
      if (railQueueRef.current.length > 0) {
        const ready = railQueueRef.current.filter((item) => item.at <= now);
        if (ready.length > 0) {
          railQueueRef.current = railQueueRef.current.filter(
            (item) => item.at > now
          );
          for (const item of ready) {
            signals.spawn(item.edgeId, {
              reverse: item.reverse,
              speed: item.speed,
              color: item.color,
            });
          }
        }
      }
      const current = propsRef.current;
      const highlighted = new Set(current.highlightedIds);
      renderer.render(
        sceneRef.current,
        camera,
        signals,
        {
          layout: current.layout,
          reducedMotion: reducedRef.current,
          highlightedIds: highlighted,
          selectedId: current.selectedId,
          focusedId: current.focusedId,
          retrieving: current.retrieving,
          pulseIds: new Set(current.pulseIds),
          hover: hoverRef.current,
          showLabels: true,
          time: now,
          dpr,
        },
        width,
        height
      );
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("wheel", onWheelNative);
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const scene = buildScene(props.nodes, props.edges);
    const oldById = sceneRef.current.nodeById;
    for (const node of scene.nodes) {
      const old = oldById.get(node.id);
      if (!old) continue;
      node.x = old.x;
      node.y = old.y;
      node.fx = old.fx;
      node.fy = old.fy;
      node.held = old.held;
      node.orbitAngle = old.orbitAngle;
      node.orbitRadius = old.orbitRadius;
      node.orbitSpeed = old.orbitSpeed;
    }
    sceneRef.current = scene;
    engine.simulation.setData(scene.nodes, scene.edges);
    engine.signals.setEdges(scene.edges);
    const structure = `${scene.nodes
      .map((node) => node.id)
      .join("|")}@@${scene.edges.map((edge) => edge.id).join("|")}`;
    if (structure !== structureRef.current) {
      structureRef.current = structure;
      railQueueRef.current = [];
      applyCurrentLayout();
    }
    if (!hasInitialFitRef.current && scene.nodes.length > 0) {
      hasInitialFitRef.current = true;
      const { width, height } = sizeRef.current;
      const current = propsRef.current;
      const focusNode = current.focusedId
        ? scene.nodeById.get(current.focusedId)
        : undefined;
      const insets = computeInsets(
        width,
        current.drawerOpen ?? false,
        current.sheetOpen ?? false
      );
      if (focusNode) {
        if ((focusNode.kind ?? "concept") === "concept") {
          engine.camera.focusOn(focusNode, 1.5);
        } else {
          engine.camera.focusNode(focusNode, width, height, insets, 0.55);
        }
      } else {
        engine.camera.fit(scene.nodes, width, height, insets);
      }
    }
  }, [props.nodes, props.edges]);

  useEffect(() => {
    layoutRef.current = props.layout;
    sceneModeRef.current = props.sceneMode ?? "graph";
    const engine = engineRef.current;
    if (!engine || sceneRef.current.nodes.length === 0) return;
    for (const node of sceneRef.current.nodes) {
      node.held = false;
      node.fx = null;
      node.fy = null;
    }
    applyCurrentLayout();
    const { width, height } = sizeRef.current;
    engine.camera.fit(
      sceneRef.current.nodes,
      width,
      height,
      computeInsets(
        width,
        props.drawerOpen ?? false,
        props.sheetOpen ?? false
      )
    );
  }, [props.layout, props.sceneMode]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (!props.focusedId) return;
    const node = sceneRef.current.nodeById.get(props.focusedId);
    if (!node) return;
    const { width, height } = sizeRef.current;
    const insets = computeInsets(
      width,
      props.drawerOpen ?? false,
      props.sheetOpen ?? false
    );
    if ((node.kind ?? "concept") === "concept") {
      engine.camera.focusOn(node, 1.6);
    } else {
      engine.camera.focusNode(node, width, height, insets, 0.55);
    }
    fireRails(node.id);
  }, [props.focusedId]);

  useEffect(() => {
    refitRef.current();
  }, [props.fitSignal]);

  const pickNode = (
    ox: number,
    oy: number,
    touch: boolean
  ): GraphNode | null => {
    const engine = engineRef.current;
    if (!engine) return null;
    const { width, height } = sizeRef.current;
    const world = engine.camera.screenToWorld(ox, oy, width, height);
    return findNodeAt(
      sceneRef.current.nodes,
      world.x,
      world.y,
      engine.camera.zoom,
      { touch }
    );
  };

  const pointerDist = (): { dist: number; cx: number; cy: number; angle: number } | null => {
    const points = [...pointersRef.current.values()];
    if (points.length < 2) return null;
    const dx = points[0].x - points[1].x;
    const dy = points[0].y - points[1].y;
    return {
      dist: Math.hypot(dx, dy),
      cx: (points[0].x + points[1].x) / 2,
      cy: (points[0].y + points[1].y) / 2,
      angle: Math.atan2(dy, dx),
    };
  };

  const releaseDrag = () => {
    const drag = dragNodeRef.current;
    if (!drag) return;
    drag.held = grabWasHeldRef.current;
    if (!grabHadPinRef.current) {
      drag.fx = null;
      drag.fy = null;
    }
    dragNodeRef.current = null;
  };

  const startConceptDrag = (node: GraphNode, ox: number, oy: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    dragNodeRef.current = node;
    grabHadPinRef.current = node.fx != null;
    grabWasHeldRef.current = Boolean(node.held);
    grabScreenRef.current = { x: ox, y: oy };
    grabWorldRef.current = { x: node.x, y: node.y };
    node.held = true;
    node.fx = node.x;
    node.fy = node.y;
    hoverRef.current = null;
    if (canvasRef.current) canvasRef.current.style.cursor = "grabbing";
  };

  const handleNodeTap = (node: GraphNode, _touch: boolean) => {
    console.log("3-NODE_TAP", node.id, node.label, node.kind);
    const current = propsRef.current;
    const kind = node.kind ?? "concept";
    fireRails(node.id);
    if (kind === "core") {
      if (current.onCoreClick) current.onCoreClick();
      else current.onNodeClick?.(node);
      return;
    }
    if (kind === "domain") {
      if (current.onDomainClick) current.onDomainClick(node);
      else current.onNodeClick?.(node);
      return;
    }
    if (kind === "document") {
      if (current.selectedId === node.id && current.onDocumentOpen) {
        current.onDocumentOpen(node);
        return;
      }
      if (current.onDocumentClick) current.onDocumentClick(node);
      else current.onNodeClick?.(node);
      return;
    }
    if (current.onConceptClick) current.onConceptClick(node);
    else current.onNodeClick?.(node);
  };

  const handlePointerDown = (
    event: CanvasPointerEvent<HTMLCanvasElement>
  ) => {
    console.log("1-POINTER_DOWN", event.pointerType, event.clientX, event.clientY);
    const engine = engineRef.current;
    if (!engine) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = (event.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const ox = event.clientX - rect.left;
    const oy = event.clientY - rect.top;
    const touch = event.pointerType === "touch";
    pointersRef.current.set(event.pointerId, { x: ox, y: oy });
    lastSingleRef.current = { x: ox, y: oy };
    if (pointersRef.current.size === 2) {
      pinchRef.current = pointerDist();
      downRef.current = null;
      releaseDrag();
      return;
    }

    const node = pickNode(ox, oy, touch);
    console.log("2-PICK_RESULT", node?.id ?? "NULL", "screen:", ox, oy, "world:", engine.camera.screenToWorld(ox, oy, sizeRef.current.width, sizeRef.current.height), "size:", sizeRef.current.width, sizeRef.current.height, "zoom:", engine.camera.zoom);
    downRef.current = {
      x: ox,
      y: oy,
      t: performance.now(),
      node,
      moved: false,
      touch,
    };
    dragNodeRef.current = null;
    if (node) {
      hoverRef.current = null;
      if (canvasRef.current) canvasRef.current.style.cursor = "pointer";
    }
  };

  const handlePointerMove = (
    event: CanvasPointerEvent<HTMLCanvasElement>
  ) => {
    const engine = engineRef.current;
    if (!engine) return;
    const rect = (event.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const ox = event.clientX - rect.left;
    const oy = event.clientY - rect.top;
    const { width, height } = sizeRef.current;
    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, { x: ox, y: oy });
    }
    if (pointersRef.current.size >= 2) {
      const current = pointerDist();
      const previous = pinchRef.current;
      if (current && previous) {
        const rawFactor = current.dist / (previous.dist || 1);
        const factor = 1 + (rawFactor - 1) * 0.7;
        engine.camera.zoomAt(
          current.cx,
          current.cy,
          factor,
          width,
          height
        );
        engine.camera.panBy(
          (current.cx - previous.cx) * 0.6,
          (current.cy - previous.cy) * 0.6
        );
        let angleDelta = current.angle - previous.angle;
        if (angleDelta > Math.PI) angleDelta -= Math.PI * 2;
        if (angleDelta < -Math.PI) angleDelta += Math.PI * 2;
        engine.camera.rotateBy(angleDelta);
      }
      pinchRef.current = current;
      if (downRef.current) downRef.current.moved = true;
      releaseDrag();
      return;
    }
    const drag = dragNodeRef.current;
    if (drag) {
      const world = engine.camera.screenToWorld(ox, oy, width, height);
      drag.held = true;
      drag.x = world.x;
      drag.y = world.y;
      drag.fx = world.x;
      drag.fy = world.y;
      lastSingleRef.current = { x: ox, y: oy };
      return;
    }
    const down = downRef.current;
    if (down?.node && (down.node.kind ?? "concept") === "concept" && !down.moved) {
      const dsx = ox - down.x;
      const dsy = oy - down.y;
      const threshold = down.touch ? TOUCH_TAP_THRESHOLD : MOUSE_TAP_THRESHOLD;
      if (Math.abs(dsx) + Math.abs(dsy) > threshold) {
        down.moved = true;
        startConceptDrag(down.node, down.x, down.y);
        const world = engine.camera.screenToWorld(ox, oy, width, height);
        down.node.x = world.x;
        down.node.y = world.y;
        down.node.fx = world.x;
        down.node.fy = world.y;
      }
      lastSingleRef.current = { x: ox, y: oy };
      return;
    }
    const pressing =
      event.buttons !== 0 || event.pointerType === "touch";
    if (pressing) {
      const last = lastSingleRef.current;
      if (last) {
        const dx = ox - last.x;
        const dy = oy - last.y;
        const moveThreshold = down?.touch ? TOUCH_TAP_THRESHOLD : MOUSE_TAP_THRESHOLD;
        if (Math.abs(dx) + Math.abs(dy) > moveThreshold) {
          if (down) down.moved = true;
          engine.camera.panBy(dx, dy);
        }
      }
      lastSingleRef.current = { x: ox, y: oy };
      return;
    }
    const node = pickNode(ox, oy, false);
    hoverRef.current = node
      ? { nodeId: node.id, x: ox, y: oy }
      : null;
    if (canvasRef.current) {
      canvasRef.current.style.cursor = node ? "pointer" : "grab";
    }
  };

  const endPointer = (
    event: CanvasPointerEvent<HTMLCanvasElement>
  ) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 1) {
      const remaining = [...pointersRef.current.values()][0];
      lastSingleRef.current = { ...remaining };
    }
    if (pointersRef.current.size !== 0) return;
    const down = downRef.current;
    downRef.current = null;
    lastSingleRef.current = null;
    const drag = dragNodeRef.current;
    dragNodeRef.current = null;
    if (canvasRef.current) canvasRef.current.style.cursor = "grab";
    if (drag) {
      if (down?.moved) {
        drag.held = true;
        hoverRef.current = null;
      } else {
        drag.held = grabWasHeldRef.current;
        if (!grabHadPinRef.current) {
          drag.fx = null;
          drag.fy = null;
        }
        hoverRef.current = {
          nodeId: drag.id,
          x: down?.x ?? 0,
          y: down?.y ?? 0,
        };
        handleNodeTap(drag, down?.touch ?? false);
      }
      return;
    }
    if (!down) return;
    const isTap =
      !down.moved &&
      performance.now() - down.t < (down.touch ? TOUCH_TAP_TIME : MOUSE_TAP_TIME);
    if (!isTap) return;
    if (down.node) {
      handleNodeTap(down.node, down.touch);
      return;
    }
    hoverRef.current = null;
    propsRef.current.onBackgroundClick();
  };

  const handlePointerUp = (
    event: CanvasPointerEvent<HTMLCanvasElement>
  ) => endPointer(event);

  const handlePointerCancel = (
    event: CanvasPointerEvent<HTMLCanvasElement>
  ) => endPointer(event);

  const handlePointerLeave = (
    event: CanvasPointerEvent<HTMLCanvasElement>
  ) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (event.pointerType === "mouse") {
      hoverRef.current = null;
    }
  };

  const handleDoubleClick = (
    event: CanvasMouseEvent<HTMLCanvasElement>
  ) => {
    const engine = engineRef.current;
    if (!engine) return;
    const rect = (event.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const ox = event.clientX - rect.left;
    const oy = event.clientY - rect.top;
    const current = propsRef.current;
    const node = pickNode(ox, oy, false);
    if (node) {
      const kind = node.kind ?? "concept";
      if (kind === "domain" && current.onDomainClick) {
        current.onDomainClick(node);
        return;
      }
      if (kind === "document" && current.onDocumentOpen) {
        current.onDocumentOpen(node);
        return;
      }
      if (kind === "core" && current.onCoreClick) {
        current.onCoreClick();
        return;
      }
      engine.camera.focusOn(node, 1.6);
      return;
    }
    const { width, height } = sizeRef.current;
    engine.camera.resetRotation();
    engine.camera.fit(
      sceneRef.current.nodes,
      width,
      height,
      computeInsets(
        width,
        current.drawerOpen ?? false,
        current.sheetOpen ?? false
      )
    );
  };

  return (
    <div
      ref={containerRef}
      className="cortex-root absolute inset-0 overflow-hidden"
    >
      <canvas
        ref={canvasRef}
        className="h-full w-full"
        style={{ cursor: "grab", touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={handlePointerLeave}
        onDoubleClick={handleDoubleClick}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 52%, rgba(8, 6, 5, 0.5) 100%)",
        }}
      />
      <ScanlineOverlay active={props.retrieving} />
    </div>
  );
}