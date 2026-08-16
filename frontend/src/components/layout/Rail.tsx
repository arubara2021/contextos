import { useEffect, useRef, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { Icon } from "../shared/Icon";
import { Logo } from "../shared/Logo";
import { ROUTES } from "../../constants";

const NAV_ITEMS = [
  { to: ROUTES.cortex, label: "Cortex", icon: "cortex" as const },
  { to: ROUTES.dive, label: "Dive", icon: "dive" as const },
  { to: ROUTES.archive, label: "Archive", icon: "archive" as const },
  { to: ROUTES.settings, label: "Settings", icon: "settings" as const },
];

function useMobileNavVisibility(): boolean {
  const [hidden, setHidden] = useState(false);
  const hiddenRef = useRef(false);
  const lastY = useRef(0);
  const idleTimer = useRef(0);

  useEffect(() => {
    hiddenRef.current = hidden;
  }, [hidden]);

  useEffect(() => {
    if (window.innerWidth >= 1024) return;

    const show = () => {
      if (hiddenRef.current) setHidden(false);
    };
    const hide = () => {
      if (!hiddenRef.current) setHidden(true);
    };
    const startIdleTimer = () => {
      window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(hide, 4000);
    };

    const onTouch = () => {
      show();
      startIdleTimer();
    };

    let raf = 0;
    const onScroll = (event: Event) => {
      const raw = event.target;
      const el =
        raw instanceof Element &&
          raw.scrollHeight > raw.clientHeight + 40
          ? raw
          : null;
      if (!el) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const scrollTop = el.scrollTop;
        const delta = scrollTop - lastY.current;
        lastY.current = scrollTop;
        if (delta > 6 && scrollTop > 60) {
          hide();
        } else if (delta < -6) {
          show();
          startIdleTimer();
        }
      });
    };

    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement;
      if (
        t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.contentEditable === "true"
      ) {
        hide();
        window.clearTimeout(idleTimer.current);
      }
    };
    const onFocusOut = () => {
      setTimeout(() => {
        const a = document.activeElement as HTMLElement | null;
        const stillFocused =
          !!a &&
          (a.tagName === "INPUT" ||
            a.tagName === "TEXTAREA" ||
            a.contentEditable === "true");
        if (!stillFocused) {
          show();
          startIdleTimer();
        }
      }, 150);
    };

    document.addEventListener("touchstart", onTouch, { passive: true });
    document.addEventListener("scroll", onScroll, { passive: true, capture: true });
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    startIdleTimer();
    return () => {
      window.clearTimeout(idleTimer.current);
      cancelAnimationFrame(raf);
      document.removeEventListener("touchstart", onTouch);
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
    };
  }, []);

  return hidden;
}

interface RailProps {
  immersive?: boolean;
}

export function Rail({ immersive = false }: RailProps) {
  const hidden = useMobileNavVisibility();
  return (
    <>
      <aside
        className={[
          "fixed inset-y-0 left-0 z-[45] hidden w-[72px] flex-col items-center border-r border-line bg-[linear-gradient(180deg,#15100d_0%,#100c0a_100%)] px-3 pb-4 pt-5 lg:flex",
          immersive ? "opacity-95" : "opacity-100",
        ].join(" ")}
      >
        <Link
          to="/"
          className="grid h-11 w-11 place-items-center rounded-xl border border-line-strong bg-coal/70 transition-transform duration-700 hover:rotate-180"
          aria-label="Back to landing page"
        >
          <Logo size={24} />
        </Link>
        <div className="mt-4 h-px w-8 bg-line-strong" />
        <nav className="mt-4 flex flex-1 flex-col items-center justify-center gap-2">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} className="group relative flex">
              {({ isActive }) => (
                <span
                  className={[
                    "relative grid h-11 w-11 place-items-center rounded-xl border transition-all duration-300",
                    isActive
                      ? "border-ember/40 bg-ember-faint text-ember-hi"
                      : "border-transparent text-stone hover:bg-soot hover:text-bone",
                  ].join(" ")}
                >
                  {isActive && (
                    <span className="absolute -left-[14px] top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-gradient-to-b from-ember-hi to-ember-deep shadow-ember" />
                  )}
                  <Icon name={item.icon} size={20} />
                  <span className="pointer-events-none absolute left-full ml-4 whitespace-nowrap rounded-lg border border-line-strong bg-bark px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-bone opacity-0 shadow-lift transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100">
                    {item.label}
                  </span>
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>
      <nav
        aria-label="Primary"
        className={`dock-mobile${hidden ? " is-hidden" : ""}`}
      >
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} className="dock-link">
            {({ isActive }) => (
              <span className={`dock-item${isActive ? " is-active" : ""}`}>
                <span className="dock-icon">
                  <Icon name={item.icon} size={20} />
                </span>
                <span className="dock-label">{item.label}</span>
              </span>
            )}
          </NavLink>
        ))}
      </nav>
    </>
  );
}