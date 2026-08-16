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
  const lastYRef = useRef(0);
  const lastTargetRef = useRef<EventTarget | null>(null);
  const idleTimer = useRef(0);
  const isMobile = useRef(false);

  useEffect(() => {
    hiddenRef.current = hidden;
  }, [hidden]);

  useEffect(() => {
    isMobile.current = window.innerWidth < 1024;
    if (!isMobile.current) return;

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
    const isTyping = () => {
      const a = document.activeElement as HTMLElement | null;
      return (
        !!a &&
        (a.tagName === "INPUT" ||
          a.tagName === "TEXTAREA" ||
          a.isContentEditable === true)
      );
    };

    const onTouch = () => {
      if (isTyping()) return;
      show();
      startIdleTimer();
    };

    let raf = 0;
    const onScroll = (event: Event) => {
      const raw = event.target;
      const el =
        raw instanceof HTMLElement
          ? raw
          : raw === document
            ? (document.scrollingElement as HTMLElement | null)
            : null;
      if (!el) return;
      const maxScroll = el.scrollHeight - el.clientHeight;
      if (maxScroll < 40) return;
      const scrollTop = el.scrollTop;
      if (lastTargetRef.current !== el) {
        lastTargetRef.current = el;
        lastYRef.current = scrollTop;
        return;
      }
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const delta = scrollTop - lastYRef.current;
        lastYRef.current = scrollTop;
        if (isTyping()) return;
        if (scrollTop <= 4) {
          show();
          startIdleTimer();
          return;
        }
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
        window.clearTimeout(idleTimer.current);
        hide();
      }
    };
    const onFocusOut = () => {
      window.setTimeout(() => {
        if (!isTyping()) {
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

  return !isMobile.current ? false : hidden;
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
        className={[
          "fixed inset-x-3 z-[45] transition-all duration-500 lg:hidden",
          hidden
            ? "translate-y-[calc(100%+32px)] opacity-0"
            : "translate-y-0 opacity-100",
        ].join(" ")}
        style={{
          bottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
          transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        <div className="relative flex items-stretch rounded-[22px] border border-white/[0.07] bg-[linear-gradient(180deg,rgba(22,17,14,0.82),rgba(14,11,9,0.92))] px-2 py-1.5 shadow-[0_-1px_0_0_rgba(255,138,61,0.08),0_8px_32px_-8px_rgba(0,0,0,0.7)] backdrop-blur-[24px]">
          <div className="pointer-events-none absolute inset-x-6 -top-px h-px bg-gradient-to-r from-transparent via-ember/20 to-transparent" />
          <div className="pointer-events-none absolute inset-0 rounded-[22px] bg-gradient-to-b from-white/[0.03] to-transparent" />

          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className="group relative flex flex-1 items-center justify-center"
            >
              {({ isActive }) => (
                <span
                  className={[
                    "relative flex flex-col items-center gap-1 rounded-[16px] py-2 transition-all duration-300",
                    isActive ? "bg-ember-faint" : "active:scale-95",
                  ].join(" ")}
                  style={{ width: "100%" }}
                >
                  {isActive && (
                    <span className="absolute -top-1.5 left-1/2 h-[3px] w-5 -translate-x-1/2 rounded-full bg-ember shadow-[0_0_10px_rgba(255,138,61,0.5)]" />
                  )}
                  <span
                    className={[
                      "transition-all duration-300",
                      isActive
                        ? "text-ember-hi drop-shadow-[0_0_8px_rgba(255,138,61,0.4)]"
                        : "text-stone/60 group-active:text-stone",
                    ].join(" ")}
                  >
                    <Icon name={item.icon} size={20} />
                  </span>
                  <span
                    className={[
                      "font-mono text-[8px] uppercase tracking-[0.14em] transition-colors duration-300",
                      isActive ? "text-ember/90" : "text-stone/40",
                    ].join(" ")}
                  >
                    {item.label}
                  </span>
                </span>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </>
  );
}