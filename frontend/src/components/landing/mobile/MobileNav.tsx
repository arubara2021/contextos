import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useAuthContext } from "../../../auth/AuthProvider";
import { ROUTES } from "../../../constants";
import { Logo } from "../../shared/Logo";

export function MobileNav() {
    const { isAuthenticated, initializing } = useAuthContext();
    const authed = isAuthenticated && !initializing;
    const headRef = useRef<HTMLElement | null>(null);
    useEffect(() => {
        const el = headRef.current;
        if (!el) return;
        const scroller = el.closest(".ml-page") as HTMLElement | null;
        if (!scroller) return;
        const onScroll = () => {
            el.classList.toggle("ml-nav-scrolled", scroller.scrollTop > 10);
        };
        onScroll();
        scroller.addEventListener("scroll", onScroll, { passive: true });
        return () => scroller.removeEventListener("scroll", onScroll);
    }, []);
    return (
        <header ref={headRef} className="ml-nav">
            <div className="ml-nav-top">
                <Link to="/" className="ml-brand" aria-label="ContextOS home">
                    <Logo size={26} />
                    <span className="ml-wordmark">
                        Context<span className="ml-wordmark-accent">OS</span>
                    </span>
                </Link>
                <div className="ml-nav-actions">
                    {authed ? (
                        <Link to={ROUTES.dive} className="ml-btn ml-btn-primary ml-btn-nav">
                            Enter Dive
                        </Link>
                    ) : (
                        <>
                            <Link to={ROUTES.login} className="ml-btn ml-btn-ghost ml-btn-nav">
                                Sign in
                            </Link>
                            <Link to={ROUTES.signup} className="ml-btn ml-btn-primary ml-btn-nav">
                                Start free
                            </Link>
                        </>
                    )}
                </div>
            </div>
        </header>
    );
}