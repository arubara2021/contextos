import { useEffect, useRef } from "react";

interface Star {
  nx: number;
  ny: number;
  s: number;
  seed: number;
  cold: boolean;
}

interface Stream {
  ax: number;
  ay: number;
  cx: number;
  cy: number;
  bx: number;
  by: number;
  color: string;
  alpha: number;
  sparks: Array<{ offset: number; speed: number }>;
}

interface Satellite {
  ring: number;
  phase: number;
  speed: number;
  size: number;
  color: string;
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
    let streams: Stream[] = [];
    let pointerX = 0.5;
    let pointerY = 0.5;
    let visible = true;
    let raf = 0;

    const satellites: Satellite[] = [
      { ring: 0, phase: 0.6, speed: 0.9, size: 2.6, color: "255,177,92" },
      { ring: 1, phase: 2.8, speed: 0.55, size: 2.2, color: "143,216,210" },
      { ring: 1, phase: 4.4, speed: 0.55, size: 1.8, color: "255,138,61" },
      { ring: 2, phase: 1.7, speed: 0.34, size: 2.0, color: "255,92,73" },
    ];

    const build = () => {
      const rect = wrap.getBoundingClientRect();
      W = Math.max(1, rect.width);
      H = Math.max(1, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);

      const rnd = mulberry32(20260807);
      const starCount = W < 640 ? 48 : 90;
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

      streams = [
        {
          ax: -0.05, ay: 0.62, cx: 0.3, cy: 0.44, bx: 0.72, by: 0.5,
          color: "255,138,61", alpha: 0.1,
          sparks: [{ offset: 0.15, speed: 0.5 }, { offset: 0.6, speed: 0.42 }],
        },
        {
          ax: -0.04, ay: 0.24, cx: 0.42, cy: 0.36, bx: 1.04, by: 0.3,
          color: "143,216,210", alpha: 0.09,
          sparks: [{ offset: 0.35, speed: 0.46 }],
        },
        {
          ax: 0.2, ay: 1.05, cx: 0.55, cy: 0.7, bx: 1.05, by: 0.62,
          color: "255,177,92", alpha: 0.07,
          sparks: [{ offset: 0.8, speed: 0.38 }],
        },
      ];
    };

    const quad = (s: Stream, t: number) => {
      const u = 1 - t;
      return {
        x: (u * u * s.ax + 2 * u * t * s.cx + t * t * s.bx) * W,
        y: (u * u * s.ay + 2 * u * t * s.cy + t * t * s.by) * H,
      };
    };

    const draw = (time: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const parX = coarse ? 0 : (pointerX - 0.5) * 10;
      const parY = coarse ? 0 : (pointerY - 0.5) * 8;

      const ribbons = [
        { x: 0.22, y: 0.2, r: 0.62, c: "255,138,61", a: 0.075, ph: 0 },
        { x: 0.78, y: 0.34, r: 0.55, c: "143,216,210", a: 0.05, ph: 2.1 },
        { x: 0.55, y: 0.9, r: 0.7, c: "200,85,31", a: 0.06, ph: 4.2 },
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

      for (const s of streams) {
        ctx.strokeStyle = `rgba(${s.color},${s.alpha})`;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        const a = quad(s, 0);
        const m = quad(s, 0.5);
        const b = quad(s, 1);
        ctx.moveTo(a.x + parX, a.y + parY);
        ctx.quadraticCurveTo(m.x + parX, m.y + parY, b.x + parX, b.y + parY);
        ctx.stroke();

        if (!reduced) {
          for (const sp of s.sparks) {
            const t = (time * 0.000045 * sp.speed + sp.offset) % 1;
            for (let k = 0; k < 3; k++) {
              const tt = t - k * 0.02;
              if (tt < 0) continue;
              const p = quad(s, tt);
              const fade = (1 - k / 3) * Math.sin(Math.PI * t);
              const rg = ctx.createRadialGradient(
                p.x + parX, p.y + parY, 0,
                p.x + parX, p.y + parY, 5 - k
              );
              rg.addColorStop(0, `rgba(${s.color},${0.85 * fade})`);
              rg.addColorStop(1, `rgba(${s.color},0)`);
              ctx.fillStyle = rg;
              ctx.beginPath();
              ctx.arc(p.x + parX, p.y + parY, 5 - k, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      }

      const portrait = H > W * 0.9;
      const cx = (portrait ? 0.5 : 0.68) * W + parX;
      const cy = (portrait ? 0.34 : 0.44) * H + parY;
      const R = Math.min(W, H) * (portrait ? 0.2 : 0.17);

      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 3.1);
      halo.addColorStop(0, "rgba(255,138,61,0.16)");
      halo.addColorStop(0.5, "rgba(255,138,61,0.05)");
      halo.addColorStop(1, "rgba(255,138,61,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 3.1, 0, Math.PI * 2);
      ctx.fill();

      const rings = [1, 1.45, 1.9];
      rings.forEach((mult, i) => {
        ctx.strokeStyle = `rgba(236,229,218,${0.1 - i * 0.025})`;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 7]);
        ctx.lineDashOffset = reduced ? 0 : time * 0.012 * (i % 2 === 0 ? 1 : -1);
        ctx.beginPath();
        ctx.arc(cx, cy, R * mult, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.setLineDash([]);

      for (const sat of satellites) {
        const ang = sat.phase + (reduced ? 0 : time * 0.00022 * sat.speed);
        const rr = R * rings[sat.ring];
        const x = cx + Math.cos(ang) * rr;
        const y = cy + Math.sin(ang) * rr;
        const g = ctx.createRadialGradient(x, y, 0, x, y, sat.size * 4);
        g.addColorStop(0, `rgba(${sat.color},0.9)`);
        g.addColorStop(1, `rgba(${sat.color},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, sat.size * 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(${sat.color},1)`;
        ctx.beginPath();
        ctx.arc(x, y, sat.size * 0.8, 0, Math.PI * 2);
        ctx.fill();
      }

      const breathe = reduced ? 1 : 1 + 0.05 * Math.sin(time * 0.0012);
      const coreR = R * 0.34 * breathe;
      const core = ctx.createRadialGradient(
        cx - coreR * 0.3, cy - coreR * 0.35, coreR * 0.1,
        cx, cy, coreR
      );
      core.addColorStop(0, "#FFF1CC");
      core.addColorStop(0.55, "#FFB15C");
      core.addColorStop(1, "#C8551F");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "rgba(255,177,92,0.35)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR + 7, 0, Math.PI * 2);
      ctx.stroke();
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