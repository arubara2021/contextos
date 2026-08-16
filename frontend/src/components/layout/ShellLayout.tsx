import { Outlet, useLocation } from "react-router-dom";
import { Rail } from "./Rail";
import { TopHud } from "./TopHud";
import { DemoBanner } from "./DemoBanner";
import { MobileDock } from "./MobileDock";
import { ROUTES } from "../../constants";

export function ShellLayout() {
  const location = useLocation();

  const immersive = location.pathname.startsWith(ROUTES.dive);
  const cortex = location.pathname.startsWith(ROUTES.cortex);
  const settings = location.pathname.startsWith(ROUTES.settings);
  const showHud = !immersive && !cortex && (!settings || window.innerWidth >= 1024);

  return (
    <div className="relative h-[100dvh] overflow-hidden bg-void text-bone">
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            "radial-gradient(1100px 700px at 50% 118%, rgb(255 138 61 / 0.08), transparent 58%), radial-gradient(820px 560px at 92% -12%, rgb(143 216 210 / 0.05), transparent 55%), radial-gradient(700px 500px at -8% 30%, rgb(255 138 61 / 0.035), transparent 60%), linear-gradient(180deg, #100d0b 0%, var(--void) 45%, var(--void-2) 100%)",
        }}
      />

      <Rail immersive={immersive} />
      <DemoBanner />

      {showHud && <TopHud />}

      <main className="relative z-10 h-full lg:pl-[72px]">
        <Outlet />
      </main>

      <MobileDock />
    </div>
  );
}