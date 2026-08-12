import { useEffect, useRef } from "react";
import { CONCEPT_TYPES } from "../../constants";

interface MiniNode {
  nx: number;
  ny: number;
  r: number;
  color: string;
  phase: number;
}

interface MiniPulse {
  node: number;
  t: number;
}

const PALETTE = Object.values(CONCEPT_TYPES).map((type) => type.color);

const NODES_INIT: Array<{ nx: number; ny: number; r: number; ci: number }> = [
  { nx: 0.5, ny: 0.5, r: 13, ci: 0 },
  { nx: 0.22, ny: 0.28, r: 9, ci: 2 },
  { nx: 0.8, ny: 0.3, r: 10, ci: 1 },
  { nx: 0.28, ny: 0.76, r: 8, ci: 3 },
  { nx: 0.76, ny: 0.74, r: 9, ci: 4 },
  { nx: 0.5, ny: 0.14, r: 7, ci: 5 },
];

const EDGES: Array<[number, number]> = [
  [0, 1],
  [0, 2],
  [0, 3],
  [0, 4],
  [0, 5],
  [1, 5],
  [2, 4],
];

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function MiniGraph() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    canvas.style.touchAction = "none";

    let W = 1;
    let H = 1;
    let dpr = 1;
    let drag = -1;
    let moved = false;
    let visible = true;
    let raf = 0;

    const nodes: MiniNode[] = NODES_INIT.map((node) => ({
      nx: node.nx,
      ny: node.ny,
      r: node.r,
      color: PALETTE[node.ci % PALETTE.length],
      phase: Math.random() * Math.PI * 2,
    }));

    const pulses: MiniPulse[] = [];

    const px = (node: MiniNode) => node.nx * W;
    const py = (node: MiniNode) => node.ny * H;

    const draw = (time: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      for (const [a, b] of EDGES) {
        ctx.strokeStyle = "rgba(236, 229, 218, 0.12)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px(nodes[a]), py(nodes[a]));
        ctx.lineTo(px(nodes[b]), py(nodes[b]));
        ctx.stroke();
      }

      for (let i = pulses.length - 1; i >= 0; i--) {
        const pulse = pulses[i];
        pulse.t += 0.022;
        if (pulse.t > 1) {
          pulses.splice(i, 1);
          continue;
        }
        const node = nodes[pulse.node];
        const x = px(node);
        const y = py(node);
        ctx.beginPath();
        ctx.arc(x, y, node.r + pulse.t * 34, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 177, 92, ${0.6 * (1 - pulse.t)})`;
        ctx.lineWidth = 2 * (1 - pulse.t) + 0.5;
        ctx.stroke();
      }

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const breathe = reduced ? 1 : 1 + 0.06 * Math.sin(time * 0.0016 + node.phase);
        const r = node.r * breathe * (i === drag ? 1.18 : 1);
        const x = px(node);
        const y = py(node);

        const glow = ctx.createRadialGradient(x, y, r * 0.3, x, y, r * 3);
        glow.addColorStop(0, node.color);
        glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.globalAlpha = 0.32;
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, r * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        const core = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
        core.addColorStop(0, "#FFF1CC");
        core.addColorStop(1, node.color);
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = i === drag ? "rgba(236,229,218,0.9)" : "rgba(236,229,218,0.25)";
        ctx.lineWidth = i === drag ? 1.6 : 1;
        ctx.stroke();
      }
    };

    const renderStatic = () => draw(0);

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      W = Math.max(1, rect.width);
      H = Math.max(1, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      if (reduced) renderStatic();
    };

    const localXY = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
    };

    const hit = (x: number, y: number) => {
      let best = -1;
      let bestDistance = Infinity;
      for (let i = 0; i < nodes.length; i++) {
        const distance = Math.hypot(px(nodes[i]) - x, py(nodes[i]) - y);
        const threshold = nodes[i].r + 16;
        if (distance < threshold && distance < bestDistance) {
          bestDistance = distance;
          best = i;
        }
      }
      return best;
    };

    const onDown = (event: PointerEvent) => {
      canvas.setPointerCapture(event.pointerId);
      const { x, y } = localXY(event);
      moved = false;
      const target = hit(x, y);
      if (target >= 0) {
        drag = target;
        canvas.style.cursor = "grabbing";
        if (reduced) renderStatic();
      }
    };

    const onMove = (event: PointerEvent) => {
      const { x, y } = localXY(event);
      if (drag >= 0) {
        nodes[drag].nx = clamp(x / W, 0.05, 0.95);
        nodes[drag].ny = clamp(y / H, 0.07, 0.93);
        moved = true;
        if (reduced) renderStatic();
      } else {
        canvas.style.cursor = hit(x, y) >= 0 ? "grab" : "default";
      }
    };

    const onUp = () => {
      if (drag >= 0) {
        if (!moved && !reduced) {
          pulses.push({ node: drag, t: 0 });
        }
        drag = -1;
        canvas.style.cursor = "grab";
        if (reduced) renderStatic();
      }
    };

    const loop = (now: number) => {
      if (visible && !document.hidden) {
        draw(now);
      }
      raf = requestAnimationFrame(loop);
    };

    resize();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(wrap);

    const intersectionObserver = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? true;
    });
    intersectionObserver.observe(wrap);

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);

    if (!reduced) {
      raf = requestAnimationFrame(loop);
    } else {
      renderStatic();
    }

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
    };
  }, []);

  return (
    <div ref={wrapRef} className="mini-orbit">
      <canvas
        ref={canvasRef}
        aria-label="Interactive memory graph. Drag a node to move it, tap a node to send a pulse."
      />
      <span className="mini-orbit-hint">drag nodes · tap to pulse</span>
    </div>
  );
}