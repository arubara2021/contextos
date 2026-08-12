import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { Icon, type IconName } from "../components/shared/Icon";
import { ProfileSettings } from "../components/settings/ProfileSettings";
import { ApiSettings } from "../components/settings/ApiSettings";
import { ConnectedTools } from "../components/settings/ConnectedTools";
import { MemoryPreferences } from "../components/settings/MemoryPreferences";
import { NotificationSettings } from "../components/settings/NotificationSettings";
import { StorageSettings } from "../components/settings/StorageSettings";

interface SectionMeta {
  id: string;
  label: string;
  icon: IconName;
}

const SECTIONS: SectionMeta[] = [
  { id: "profile", label: "Profile", icon: "user" },
  { id: "backend", label: "Backend link", icon: "graph" },
  { id: "tools", label: "Connected tools", icon: "layers" },
  { id: "memory", label: "Memory & decay", icon: "cortex" },
  { id: "notify", label: "Notifications", icon: "bell" },
  { id: "storage", label: "Storage & export", icon: "database" },
];

const PANELS: Record<string, ReactElement> = {
  profile: <ProfileSettings />,
  backend: <ApiSettings />,
  tools: <ConnectedTools />,
  memory: <MemoryPreferences />,
  notify: <NotificationSettings />,
  storage: <StorageSettings />,
};

export function SettingsPage() {
  const pageRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  const [indicator, setIndicator] = useState({ top: 0, height: 0 });

  useLayoutEffect(() => {
    const measure = () => {
      const el = itemRefs.current[active];
      if (el) setIndicator({ top: el.offsetTop, height: el.offsetHeight });
    };
    measure();
    const timer = window.setTimeout(measure, 350);
    window.addEventListener("resize", measure);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", measure);
    };
  }, [active]);

  useEffect(() => {
    const root = pageRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = (entry.target as HTMLElement).dataset.section;
            if (id) setActive(id);
          }
        }
      },
      { root, rootMargin: "-30% 0px -60% 0px", threshold: 0 }
    );
    for (const el of Object.values(sectionRefs.current)) {
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  const goTo = (id: string) => {
    sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(id);
  };

  return (
    <div className="page" ref={pageRef}>
      <span className="page-glow" aria-hidden="true" />
      <div className="relative z-10 mx-auto w-full max-w-[1180px]">
        <header className="page-head">
          <p className="kicker">Control room</p>
          <h1 className="page-title">
            Tune the <em>machine.</em>
          </h1>
          <p className="page-sub hidden sm:block">
            Six modules, one instrument cluster. Every dial writes to the live session — the decay
            engine, the relevance scorer, the link to your backend.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[200px_1fr] lg:items-start lg:gap-8">
          <aside className="hidden lg:block">
            <div className="sticky top-[calc(var(--hud-height)+8px)] flex flex-col gap-4">
              <div className="px-1">
                <p className="t-mono text-[9px] uppercase tracking-[0.28em] text-ember">Modules</p>
                <p className="mt-1.5 text-[12px] font-light leading-relaxed text-stone">
                  Jump to a panel — the rail tracks where you are.
                </p>
              </div>
              <nav className="settings-rail" ref={navRef}>
                <span
                  className="settings-indicator"
                  style={{ top: indicator.top, height: indicator.height }}
                />
                {SECTIONS.map((section, index) => (
                  <button
                    key={section.id}
                    ref={(el) => {
                      itemRefs.current[section.id] = el;
                    }}
                    className={`settings-rail-item ${active === section.id ? "active" : ""}`}
                    onClick={() => goTo(section.id)}
                  >
                    <Icon name={section.icon} className="settings-rail-ic" />
                    <span>{section.label}</span>
                    <span className="settings-rail-num">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </button>
                ))}
              </nav>
              <p className="t-mono px-2 text-[8.5px] uppercase leading-relaxed tracking-[0.2em] text-stone/50">
                runtime changes apply to this session only
              </p>
            </div>
          </aside>

          <div className="flex flex-col gap-5">
            {SECTIONS.map((section, index) => (
              <section
                key={section.id}
                id={section.id}
                data-section={section.id}
                ref={(el) => {
                  sectionRefs.current[section.id] = el;
                }}
                className="fx-rise"
                style={{ "--rise-delay": `${index * 0.06}s` } as CSSProperties}
              >
                {PANELS[section.id]}
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}