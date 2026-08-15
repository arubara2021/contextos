import {
    useEffect,
    useRef,
    useState,
    type CSSProperties,
    type ReactNode,
    type RefObject,
} from "react";

export function usePrefersReducedMotion() {
    const [reduced, setReduced] = useState(false);
    useEffect(() => {
        const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
        setReduced(mq.matches);
        const onChange = (event: MediaQueryListEvent) => {
            setReduced(event.matches);
        };
        mq.addEventListener("change", onChange);
        return () => mq.removeEventListener("change", onChange);
    }, []);
    return reduced;
}

export function useInView<T extends HTMLElement>(
    threshold = 0.15
): [RefObject<T>, boolean] {
    const ref = useRef<T>(null);
    const [inView, setInView] = useState(false);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const scroller = el.closest(".ml-page") as HTMLElement | null;
        const io = new IntersectionObserver(
            (entries) => {
                setInView(entries[0]?.isIntersecting ?? false);
            },
            { root: scroller, threshold }
        );
        io.observe(el);
        return () => io.disconnect();
    }, [threshold]);
    return [ref as RefObject<T>, inView];
}

export function scrollToId(id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
}

export function Reveal({
    children,
    delay = 0,
    variant = "up",
    className = "",
}: {
    children: ReactNode;
    delay?: number;
    variant?: "up" | "left" | "right" | "scale" | "fade";
    className?: string;
}) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const scroller = el.closest(".ml-page") as HTMLElement | null;
        const io = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        el.classList.add("is-in");
                        io.disconnect();
                    }
                }
            },
            { root: scroller, threshold: 0.08, rootMargin: "0px 0px -8% 0px" }
        );
        io.observe(el);
        const fallback = window.setTimeout(() => {
            const rect = el.getBoundingClientRect();
            if (rect.top < window.innerHeight * 0.95 && rect.bottom > 0) {
                el.classList.add("is-in");
                io.disconnect();
            }
        }, 1200);
        return () => {
            io.disconnect();
            window.clearTimeout(fallback);
        };
    }, []);
    return (
        <div
            ref={ref}
            className={`ml-reveal ml-rv-${variant} ${className}`.trim()}
            style={{ "--rd": `${delay}s` } as CSSProperties}
        >
            {children}
        </div>
    );
}

export function CountUp({ value, suffix = "" }: { value: number; suffix?: string }) {
    const reduced = usePrefersReducedMotion();
    const [ref, inView] = useInView<HTMLSpanElement>(0.4);
    const [display, setDisplay] = useState(0);
    useEffect(() => {
        if (!inView) return;
        if (reduced) {
            setDisplay(value);
            return;
        }
        const duration = 1500;
        const start = performance.now();
        let raf = 0;
        const tick = (now: number) => {
            const t = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            setDisplay(Math.round(value * eased));
            if (t < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [inView, value, reduced]);
    return (
        <span ref={ref}>
            {display.toLocaleString("en-US")}
            {suffix}
        </span>
    );
}

export function Typed({
    text,
    play,
    speed = 26,
    onDone,
}: {
    text: string;
    play: boolean;
    speed?: number;
    onDone?: () => void;
}) {
    const spanRef = useRef<HTMLSpanElement>(null);
    const caretRef = useRef<HTMLSpanElement>(null);
    const doneRef = useRef(onDone);
    doneRef.current = onDone;
    useEffect(() => {
        const span = spanRef.current;
        if (!span) return;
        const caret = caretRef.current;
        if (!play) {
            span.textContent = text;
            if (caret) caret.style.display = "none";
            const t = window.setTimeout(() => doneRef.current?.(), 80);
            return () => window.clearTimeout(t);
        }
        let i = 0;
        span.textContent = "";
        if (caret) caret.style.display = "inline-block";
        const id = window.setInterval(() => {
            i += 1;
            span.textContent = text.slice(0, i);
            if (i >= text.length) {
                window.clearInterval(id);
                if (caret) caret.style.display = "none";
                doneRef.current?.();
            }
        }, speed);
        return () => window.clearInterval(id);
    }, [play, text, speed]);
    return (
        <>
            <span ref={spanRef} />
            {play ? <span ref={caretRef} className="type-caret" /> : null}
        </>
    );
}

const SCRAMBLE_GLYPHS = "▚▞▟◧◨01·+×";

export function ScrambleText({
    text,
    className = "",
    duration = 800,
}: {
    text: string;
    className?: string;
    duration?: number;
}) {
    const ref = useRef<HTMLSpanElement>(null);
    const reduced = usePrefersReducedMotion();
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        if (reduced) {
            el.textContent = text;
            return;
        }
        el.textContent = text;
        const scroller = el.closest(".ml-page") as HTMLElement | null;
        let raf = 0;
        let started = false;
        const io = new IntersectionObserver(
            (entries) => {
                if (!entries[0]?.isIntersecting || started) return;
                started = true;
                io.disconnect();
                const start = performance.now();
                const tick = (now: number) => {
                    const t = Math.min(1, (now - start) / duration);
                    const revealCount = Math.floor(t * text.length);
                    let out = text.slice(0, revealCount);
                    for (let i = revealCount; i < text.length; i++) {
                        out += text[i] === " " ? " " : SCRAMBLE_GLYPHS[(Math.random() * SCRAMBLE_GLYPHS.length) | 0];
                    }
                    el.textContent = out;
                    if (t < 1) {
                        raf = requestAnimationFrame(tick);
                    } else {
                        el.textContent = text;
                    }
                };
                raf = requestAnimationFrame(tick);
            },
            { root: scroller, threshold: 0.4 }
        );
        io.observe(el);
        return () => {
            io.disconnect();
            cancelAnimationFrame(raf);
        };
    }, [text, reduced, duration]);
    return <span ref={ref} className={className} />;
}

export function Tilt({
    children,
    className = "",
    max = 5,
}: {
    children: ReactNode;
    className?: string;
    max?: number;
}) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        if (window.matchMedia("(pointer: coarse)").matches) return;
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        let raf = 0;
        const onMove = (event: PointerEvent) => {
            const rect = el.getBoundingClientRect();
            const px = (event.clientX - rect.left) / rect.width - 0.5;
            const py = (event.clientY - rect.top) / rect.height - 0.5;
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => {
                el.style.transform = `perspective(900px) rotateX(${(-py * max).toFixed(2)}deg) rotateY(${(px * max).toFixed(2)}deg) translateY(-2px)`;
            });
        };
        const onLeave = () => {
            cancelAnimationFrame(raf);
            el.style.transform = "";
        };
        el.addEventListener("pointermove", onMove);
        el.addEventListener("pointerleave", onLeave);
        return () => {
            el.removeEventListener("pointermove", onMove);
            el.removeEventListener("pointerleave", onLeave);
            cancelAnimationFrame(raf);
        };
    }, [max]);
    return <div ref={ref} className={`ml-tilt ${className}`.trim()}>{children}</div>;
}