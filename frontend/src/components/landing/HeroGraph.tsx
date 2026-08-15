import { useEffect, useRef } from "react";

interface Star {
  nx: number;
  ny: number;
  s: number;
  seed: number;
  cold: boolean;
}
interface NodeDef {
  nx: number;
  ny: number;
  r: number;
  heat: number;
  phase: number;
}
interface EdgeDef {
  a: number;
  b: number;
  w: number;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NODES: NodeDef[] = [
  { nx: 0.5, ny: 0.34, r: 6, heat: 1, phase: 0 },
  { nx: 0.26, ny: 0.22, r: 3.6, heat: 0.85, phase: 1.1 },
  { nx: 0.74, ny: 0.2, r: 3.2, heat: 0.7, phase: 2.2 },
  { nx: 0.14, ny: 0.46, r: 2.7, heat: 0.5, phase: 3.1 },
  { nx: 0.86, ny: 0.44, r: 2.9, heat: 0.55, phase: 4.2 },
  { nx: 0.34, ny: 0.52, r: 2.5, heat: 0.42, phase: 5.1 },
  { nx: 0.66, ny: 0.54, r: 2.6, heat: 0.46, phase: 0.6 },
  { nx: 0.4, ny: 0.12, r: 2.2, heat: 0.34, phase: 1.8 },
  { nx: 0.62, ny: 0.08, r: 2, heat: 0.3, phase: 2.9 },
  { nx: 0.08, ny: 0.28, r: 1.8, heat: 0.24, phase: 3.8 },
  { nx: 0.92, ny: 0.26, r: 1.8, heat: 0.24, phase: 4.7 },
  { nx: 0.26, ny: 0.7, r: 2.1, heat: 0.3, phase: 5.6 },
  { nx: 0.74, ny: 0.72, r: 2.2, heat: 0.33, phase: 0.3 },
  { nx: 0.5, ny: 0.76, r: 1.8, heat: 0.22, phase: 1.4 },
];

const EDGES: EdgeDef[] = [
  { a: 0, b: 1, w: 0.95 },
  { a: 0, b: 2, w: 0.9 },
  { a: 0, b: 5, w: 0.75 },
  { a: 0, b: 6, w: 0.75 },
  { a: 1, b: 7, w: 0.55 },
  { a: 2, b: 8, w: 0.5 },
  { a: 1, b: 3, w: 0.6 },
  { a: 2, b: 4, w: 0.6 },
  { a: 3, b: 5, w: 0.5 },
  { a: 4, b: 6, w: 0.5 },
  { a: 5, b: 11, w: 0.42 },
  { a: 6, b: 12, w: 0.42 },
  { a: 11, b: 13, w: 0.35 },
  { a: 12, b: 13, w: 0.35 },
  { a: 7, b: 8, w: 0.4 },
  { a: 3, b: 9, w: 0.35 },
  { a: 4, b: 10, w: 0.35 },
  { a: 1, b: 2, w: 0.5 },
  { a: 5, b: 6, w: 0.45 },
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function heatRgb(heat: number): [number, number, number] {
  return [
    Math.round(lerp(143, 255, heat)),
    Math.round(lerp(216, 177, heat)),
    Math.round(lerp(210, 92, heat)),
  ];
}

export function HeroGraph() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;

    let W = 1;
    let H = 1;
    let dpr = 1;
    let stars: Star[] = [];
    let pointerX = 0.5;
    let pointerY = 0.5;
    let visible = true;
    let raf = 0;

    const build = () => {
      const rect = wrap.getBoundingClientRect();
      W = Math.max(1, rect.width);
      H = Math.max(1, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      const rnd = mulberry32(20260807);
      const starCount = W < 640 ? 54 : 96;
      stars = [];
      for (let i = 0; i < starCount; i++) {
        stars.push({
          nx: rnd(),
          ny: rnd(),
          s: 0.5 + rnd() * 1.3,
          seed: rnd() * 1000,
          cold: rnd() > 0.8,
        });
      }
    };

    const quad = (
      ax: number, ay: number,
      cx: number, cy: number,
      bx: number, by: number,
      t: number
    ) => {
      const u = 1 - t;
      return {
        x: u * u * ax + 2 * u * t * cx + t * t * bx,
        y: u * u * ay + 2 * u * t * cy + t * t * by,
      };
    };

    const draw = (time: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const parX = coarse ? 0 : (pointerX - 0.5) * 12;
      const parY = coarse ? 0 : (pointerY - 0.5) * 9;

      const ribbons = [
        { x: 0.24, y: 0.18, r: 0.62, c: "255,138,61", a: 0.08, ph: 0 },
        { x: 0.78, y: 0.3, r: 0.55, c: "143,216,210", a: 0.05, ph: 2.1 },
        { x: 0.55, y: 0.92, r: 0.7, c: "200,85,31", a: 0.06, ph: 4.2 },
      ];
      for (const rb of ribbons) {
        const ox = reduced ? 0 : Math.sin(time * 0.00006 + rb.ph) * W * 0.05;
        const oy = reduced ? 0 : Math.cos(time * 0.00005 + rb.ph) * H * 0.04;
        const R = Math.max(W, H) * rb.r;
        const g = ctx.createRadialGradient(
          rb.x * W + ox, rb.y * H + oy, 0,
          rb.x * W + ox, rb.y * H + oy, R
        );
        g.addColorStop(0, `rgba(${rb.c},${rb.a})`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }

      for (const st of stars) {
        const tw = reduced ? 0.55 : 0.3 + 0.5 * Math.sin(time * 0.0011 + st.seed);
        ctx.globalAlpha = Math.max(0.08, tw);
        ctx.fillStyle = st.cold ? "rgba(196,239,235,0.9)" : "rgba(255,214,165,0.85)";
        ctx.fillRect(st.nx * W + parX * 0.4, st.ny * H + parY * 0.4, st.s, st.s);
      }
      ctx.globalAlpha = 1;

      const pos = NODES.map((n) => {
        const fx = reduced ? 0 : Math.sin(time * 0.00042 + n.phase) * 6;
        const fy = reduced ? 0 : Math.cos(time * 0.00036 + n.phase * 1.7) * 5;
        return { x: n.nx * W + fx + parX, y: n.ny * H + fy + parY };
      });

      // ---- edges (the cords) ----
      for (let i = 0; i < EDGES.length; i++) {
        const e = EDGES[i];
        const a = pos[e.a];
        const b = pos[e.b];
        const na = NODES[e.a];
        const nb = NODES[e.b];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(Math.hypot(dx, dy), 1);
        const cx = (a.x + b.x) / 2 + (-dy / dist) * dist * 0.14;
        const cy = (a.y + b.y) / 2 + (dx / dist) * dist * 0.14;
        const [r1, g1, b1] = heatRgb(na.heat);
        const [r2, g2, b2] = heatRgb(nb.heat);
        const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
        grad.addColorStop(0, `rgba(${r1},${g1},${b1},${0.12 + e.w * 0.22})`);
        grad.addColorStop(1, `rgba(${r2},${g2},${b2},${0.12 + e.w * 0.22})`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 0.8 + e.w * 1.1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(cx, cy, b.x, b.y);
        ctx.stroke();

        if (!reduced) {
          const t = (time * 0.00005 * (0.6 + e.w) + i * 0.13) % 1;
          const p = quad(a.x, a.y, cx, cy, b.x, b.y, t);
          const fade = Math.sin(Math.PI * t);
          const pg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 6);
          pg.addColorStop(0, `rgba(255,241,204,${0.75 * fade})`);
          pg.addColorStop(0.4, `rgba(${r1},${g1},${b1},${0.35 * fade})`);
          pg.addColorStop(1, `rgba(${r1},${g1},${b1},0)`);
          ctx.fillStyle = pg;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ---- nodes ----
      for (let i = 0; i < NODES.length; i++) {
        const n = NODES[i];
        const p = pos[i];
        const [r, g, b] = heatRgb(n.heat);
        const breathe = reduced ? 1 : 1 + 0.08 * Math.sin(time * 0.0014 + n.phase);
        const rad = n.r * breathe;

        const glow = ctx.createRadialGradient(p.x, p.y, rad * 0.3, p.x, p.y, rad * 4.2);
        glow.addColorStop(0, `rgba(${r},${g},${b},0.5)`);
        glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rad * 4.2, 0, Math.PI * 2);
        ctx.fill();

        const core = ctx.createRadialGradient(
          p.x - rad * 0.3, p.y - rad * 0.35, rad * 0.1,
          p.x, p.y, rad
        );
        core.addColorStop(0, "#FFF1CC");
        core.addColorStop(1, `rgb(${r},${g},${b})`);
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(${r},${g},${b},0.35)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rad + 3, 0, Math.PI * 2);
        ctx.stroke();

        if (i === 0) {
          const rot = reduced ? 0.6 : time * 0.0004;
          ctx.strokeStyle = "rgba(143,216,210,0.35)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, rad * 2.4, rad * 0.9, rot, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = "rgba(255,225,168,0.25)";
          ctx.setLineDash([3, 6]);
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, rad * 3.1, rad * 1.2, -rot * 0.7, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    };

    const loop = (now: number) => {
      if (visible && !document.hidden) draw(now);
      raf = requestAnimationFrame(loop);
    };

    const onMove = (e: PointerEvent) => {
      if (coarse) return;
      const rect = canvas.getBoundingClientRect();
      pointerX = (e.clientX - rect.left) / rect.width;
      pointerY = (e.clientY - rect.top) / rect.height;
    };
    const onLeave = () => {
      pointerX = 0.5;
      pointerY = 0.5;
    };

    build();
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    const ro = new ResizeObserver(build);
    ro.observe(wrap);
    const io = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? true;
    });
    io.observe(wrap);

    if (reduced) {
      draw(0);
      const onResize = () => draw(0);
      window.addEventListener("resize", onResize);
      return () => {
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerleave", onLeave);
        ro.disconnect();
        io.disconnect();
        window.removeEventListener("resize", onResize);
      };
    }
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  return (
    <div ref={wrapRef} className="hero-sky-wrap">
      <canvas ref={canvasRef} className="hero-sky-canvas" aria-hidden="true" />
    </div>
  );
}