interface NeuralSpinnerProps {
  size?: number;
  label?: string;
}

export function NeuralSpinner({ size = 48, label }: NeuralSpinnerProps) {
  return (
    <div className="flex flex-col items-center gap-4">
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        style={{ animation: "spin-slow 3.2s linear infinite" }}
        aria-hidden="true"
      >
        <circle cx="32" cy="32" r="20" stroke="rgba(236, 229, 218, 0.14)" strokeWidth="1.4" strokeDasharray="3 6" />
        <path
          d="M32 15.5V27M46.5 40l-10-5.5M17.5 40l10-5.5"
          stroke="rgba(236, 229, 218, 0.25)"
          strokeWidth="1.2"
        />
        <circle cx="32" cy="32" r="5" fill="#FF8A3D" style={{ filter: "drop-shadow(0 0 8px rgba(255, 138, 61, 0.7))" }} />
        <circle cx="32" cy="12" r="3.4" fill="#FFB15C" />
        <circle cx="49.3" cy="42" r="2.8" fill="#8FD8D2" />
        <circle cx="14.7" cy="42" r="2.4" fill="#FF5C49" opacity="0.8" />
      </svg>
      {label && (
        <p className="t-mono text-[9.5px] uppercase tracking-[0.3em] text-stone">{label}</p>
      )}
    </div>
  );
}