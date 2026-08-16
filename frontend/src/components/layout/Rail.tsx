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

interface RailProps {
  immersive?: boolean;
}

export function Rail({ immersive = false }: RailProps) {
  return (
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
  );
}