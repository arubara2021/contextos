import type { ReactNode } from "react";

interface AuthLayoutProps {
  brand: ReactNode;
  children: ReactNode;
}

export function AuthLayout({ brand, children }: AuthLayoutProps) {
  return (
    <div className="fixed inset-0 overflow-y-auto overflow-x-hidden overscroll-contain bg-void text-bone">
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(1100px 700px at 72% -14%, rgb(255 138 61 / 0.16), transparent 58%), radial-gradient(820px 560px at 6% 18%, rgb(143 216 210 / 0.08), transparent 56%), radial-gradient(1000px 700px at 50% 118%, rgb(255 138 61 / 0.12), transparent 60%), linear-gradient(180deg, #120e0b 0%, var(--void) 44%, var(--void-2) 100%)",
        }}
      />

      <div className="relative z-10 mx-auto grid min-h-full w-full lg:grid-cols-[1.05fr_minmax(460px,720px)]">
        <div className="relative hidden lg:block">{brand}</div>

        <div className="relative flex min-h-full flex-col">
          <div
            className="mx-auto my-auto w-full max-w-[560px] px-5 pb-24 pt-12 sm:px-8 lg:px-14 lg:py-16"
            style={{
              paddingBottom: "calc(6rem + env(safe-area-inset-bottom, 0px))",
            }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}