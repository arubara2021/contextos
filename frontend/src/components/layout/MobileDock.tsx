import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Icon, type IconName } from "../shared/Icon";
import { ROUTES } from "../../constants";

interface DockItem {
    to: string;
    label: string;
    icon: IconName;
}

const DOCK_ITEMS: DockItem[] = [
    { to: ROUTES.cortex, label: "Cortex", icon: "cortex" },
    { to: ROUTES.dive, label: "Dive", icon: "dive" },
    { to: ROUTES.archive, label: "Archive", icon: "archive" },
    { to: ROUTES.settings, label: "Settings", icon: "settings" },
];

const SCROLL_DELTA_PX = 6;
const SCROLL_TOP_GUARD_PX = 140;
const IDLE_SHOW_MS = 2500;
const KEYBOARD_DELTA_PX = 160;

export function MobileDock() {
    const [hidden, setHidden] = useState(false);
    const hiddenRef = useRef(false);
    const lastByTargetRef = useRef(new Map<EventTarget, number>());
    const idleTimerRef = useRef<number | null>(null);
    const location = useLocation();

    const show = () => {
        if (idleTimerRef.current !== null) {
            window.clearTimeout(idleTimerRef.current);
            idleTimerRef.current = null;
        }
        if (!hiddenRef.current) return;
        hiddenRef.current = false;
        setHidden(false);
    };

    const hide = () => {
        if (hiddenRef.current) return;
        hiddenRef.current = true;
        setHidden(true);
    };

    const scheduleShow = () => {
        if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = window.setTimeout(show, IDLE_SHOW_MS);
    };

    useEffect(() => {
        hiddenRef.current = false;
        setHidden(false);
        lastByTargetRef.current.clear();
    }, [location.pathname]);

    useEffect(() => {
        const onScroll = (event: Event) => {
            const target: EventTarget =
                event.target instanceof Element ? event.target : window;
            const y =
                event.target instanceof Element
                    ? event.target.scrollTop
                    : window.scrollY;
            const prev = lastByTargetRef.current.get(target);
            lastByTargetRef.current.set(target, y);
            if (prev === undefined) return;
            const delta = y - prev;
            if (Math.abs(delta) < SCROLL_DELTA_PX) return;
            if (delta > 0 && y > SCROLL_TOP_GUARD_PX) hide();
            else if (delta < 0) show();
        };
        document.addEventListener("scroll", onScroll, true);
        return () => document.removeEventListener("scroll", onScroll, true);
    }, []);

    useEffect(() => {
        const viewport = window.visualViewport;
        if (!viewport) return;
        const onViewport = () => {
            if (window.innerHeight - viewport.height > KEYBOARD_DELTA_PX) hide();
            else show();
        };
        viewport.addEventListener("resize", onViewport);
        viewport.addEventListener("scroll", onViewport);
        return () => {
            viewport.removeEventListener("resize", onViewport);
            viewport.removeEventListener("scroll", onViewport);
        };
    }, []);

    useEffect(() => {
        const onCanvasInteract = (event: Event) => {
            const target = event.target as HTMLElement | null;
            if (!target) return;
            if (target.closest(".dock-mobile") || target.closest(".dock-peek")) return;
            if (!target.closest(".cortex-root")) return;
            hide();
            scheduleShow();
        };
        document.addEventListener("pointerdown", onCanvasInteract, true);
        document.addEventListener("wheel", onCanvasInteract, true);
        return () => {
            document.removeEventListener("pointerdown", onCanvasInteract, true);
            document.removeEventListener("wheel", onCanvasInteract, true);
            if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
        };
    }, []);

    return (
        <>
            <nav
                className={`dock-mobile${hidden ? " is-hidden" : ""}`}
                aria-label="Primary"
            >
                {DOCK_ITEMS.map((item) => (
                    <NavLink key={item.to} to={item.to} className="dock-link">
                        {({ isActive }) => (
                            <span className={`dock-item${isActive ? " is-active" : ""}`}>
                                <span className="dock-icon">
                                    <Icon name={item.icon} size={17} />
                                </span>
                                <span className="dock-label">{item.label}</span>
                            </span>
                        )}
                    </NavLink>
                ))}
            </nav>
            {hidden && (
                <button
                    type="button"
                    className="dock-peek"
                    onClick={show}
                    aria-label="Show navigation"
                />
            )}
        </>
    );
}