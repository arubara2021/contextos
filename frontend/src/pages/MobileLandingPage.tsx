import { MobileNav } from "../components/landing/mobile/MobileNav";
import { MobileHero } from "../components/landing/mobile/MobileHero";
import { MobileShowcase } from "../components/landing/mobile/MobileShowcase";
import { MobileSurfaces } from "../components/landing/mobile/MobileSurfaces";
import { MobileOutro } from "../components/landing/mobile/MobileOutro";

export function MobileLandingPage() {
    return (
        <div className="ml-page">
            <span className="ml-page-aura" aria-hidden="true" />
            <MobileNav />
            <main id="ml-main" className="ml-main">
                <MobileHero />
                <MobileShowcase />
                <MobileSurfaces />
                <MobileOutro />
            </main>
        </div>
    );
}