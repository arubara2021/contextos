import { useEffect, type ReactNode } from "react";

type ModalWidth = "sm" | "md" | "lg" | "xl" | "full";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  kicker?: string;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: ModalWidth;
  scroll?: boolean;
  bodyClassName?: string;
}

const WIDTH_CLASS: Record<ModalWidth, string> = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-4xl",
  full: "sm:max-w-5xl",
};

export function Modal({
  open,
  onClose,
  kicker,
  title,
  children,
  footer,
  width = "md",
  scroll = true,
  bodyClassName = "px-6 py-5",
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const isSheet = width === "xl" || width === "full";
  const outerPad = isSheet ? "px-0 py-0 sm:px-5 sm:py-6" : "px-4 py-6";
  const rounded = isSheet ? "rounded-none sm:rounded-2xl" : "rounded-2xl";
  const height = isSheet
    ? "h-[100dvh] max-h-[100dvh] sm:h-auto sm:max-h-[calc(100dvh-3rem)]"
    : "max-h-[calc(100dvh-3rem)]";

  return (
    <div className={`fixed inset-0 z-veil flex items-center justify-center ${outerPad}`}>
      <div className="fx-fade absolute inset-0 bg-void/70 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`fx-rise relative flex w-full flex-col overflow-hidden border border-line-strong bg-panel shadow-lift ${rounded} ${height} ${WIDTH_CLASS[width]}`}
        role="dialog"
        aria-modal="true"
      >
        {(kicker || title) && (
          <div className="shrink-0 border-b border-line px-6 py-5">
            {kicker && <p className="kicker !mb-2">{kicker}</p>}
            {title && <h3 className="font-display text-2xl font-medium text-bone">{title}</h3>}
          </div>
        )}
        <div
          className={`relative min-h-0 flex-1 ${
            scroll ? "overflow-y-auto" : "flex flex-col overflow-hidden"
          } ${bodyClassName}`}
        >
          {children}
        </div>
        {footer && (
          <div className="flex shrink-0 justify-end gap-3 border-t border-line px-6 py-4">{footer}</div>
        )}
      </div>
    </div>
  );
}