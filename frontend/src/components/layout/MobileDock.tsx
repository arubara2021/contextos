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

export function MobileDock() {
    const [hidden, setHidden] = useState(false);
    const hiddenRef = useRef(false);
    const lastYRef = useRef(0);
    const location = useLocation();

    useEffect(() => {
        hiddenRef.current = false;
        setHidden(false);
        lastYRef.current = 0;
    }, [location.pathname]);

    useEffect(() => {
        const onScroll = (event: Event) => {
            const target = event.target;
            const y =
                target instanceof Element ? (target as Element).scrollTop : window.scrollY;
            const delta = y - lastYRef.current;
            lastYRef.current = y;
            if (Math.abs(delta) < 6) return;
            if (delta > 0 && y > 140 && !hiddenRef.current) {
                hiddenRef.current = true;
                setHidden(true);
            } else if (delta < 0 && hiddenRef.current) {
                hiddenRef.current = false;
                setHidden(false);
            }
        };
        document.addEventListener("scroll", onScroll, true);
        return () => document.removeEventListener("scroll", onScroll, true);
    }, []);

    return (
        <nav className={`dock-mobile${hidden ? " is-hidden" : ""}`} aria-label="Primary">
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
    );
}