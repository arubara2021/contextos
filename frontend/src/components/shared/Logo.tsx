import { useId } from "react";

interface LogoProps {
  size?: number;
  animated?: boolean;
}

export function Logo({ size = 34, animated = true }: LogoProps) {
  const id = useId();
  const gradientId = `logo-ring-${id}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-label="ContextOS"
      role="img"
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="12"
          y1="52"
          x2="52"
          y2="12"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#C8551F" />
          <stop offset="1" stopColor="#FFB15C" />
        </linearGradient>
      </defs>
      <path
        d="M50.5 40.5A21 21 0 1 1 46 17"
        stroke={`url(#${gradientId})`}
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="47.5" cy="14.5" r="4" fill="#FFB15C">
        {animated && (
          <animate
            attributeName="opacity"
            values="1;0.65;1"
            dur="3s"
            repeatCount="indefinite"
          />
        )}
      </circle>
      <circle cx="55.5" cy="33" r="2.8" fill="#FF8A3D" opacity="0.8" />
      <circle
        cx="17.5"
        cy="51"
        r="2.2"
        fill="#FF5C49"
        opacity="0.55"
        className={animated ? "fx-flicker" : ""}
      />
      <circle
        cx="58"
        cy="9.5"
        r="1.6"
        fill="#8FD8D2"
        opacity="0.9"
        className={animated ? "fx-breathe" : ""}
      />
    </svg>
  );
}