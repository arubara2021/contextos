import type { CSSProperties, ReactNode } from "react";

export type IconName =
  | "archive"
  | "back"
  | "bell"
  | "check"
  | "chevron"
  | "close"
  | "copy"
  | "cortex"
  | "database"
  | "dive"
  | "download"
  | "edit"
  | "graph"
  | "history"
  | "layers"
  | "logout"
  | "panel"
  | "plus"
  | "refresh"
  | "search"
  | "send"
  | "settings"
  | "spark"
  | "trash"
  | "upload"
  | "user";

const ACC: CSSProperties = { fill: "var(--ember)", stroke: "none" };

const ICONS: Record<IconName, ReactNode> = {
  archive: (
    <>
      <path d="M3.5 4.5h17v4h-17z" />
      <path d="M5.5 8.5v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9" />
      <path d="M10 12.5h4" />
      <circle cx="12" cy="16.8" r="1.3" style={ACC} />
    </>
  ),
  back: (
    <>
      <path d="M19 12H5" />
      <path d="m11 6-6 6 6 6" />
      <circle cx="19" cy="12" r="1.4" style={ACC} />
    </>
  ),
  bell: (
    <>
      <path d="M18 9.5a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6" />
      <path d="M10 19.5a2.2 2.2 0 0 0 4 0" />
      <circle cx="12" cy="2.8" r="1.3" style={ACC} />
    </>
  ),
  check: (
    <>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
      <circle cx="5" cy="12.5" r="1.4" style={ACC} />
    </>
  ),
  chevron: (
    <>
      <path d="m6 9.5 6 6 6-6" />
      <circle cx="12" cy="5.5" r="1.1" style={ACC} />
    </>
  ),
  close: (
    <>
      <path d="M6 6l12 12M18 6 6 18" />
      <circle cx="19.5" cy="4.5" r="1.3" style={ACC} />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2.4" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
      <circle cx="14.5" cy="14.5" r="1.3" style={ACC} />
    </>
  ),
  cortex: (
    <>
      <circle cx="6" cy="6.5" r="2.4" />
      <circle cx="18" cy="8" r="2.4" />
      <circle cx="9" cy="17.5" r="2.4" />
      <path d="M8.3 7.2l7.4.6M7 8.7l1.4 6.6M16.9 10.2l-6.1 5.5" />
      <circle cx="18.5" cy="18" r="1.5" style={ACC} />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" />
      <path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13" />
      <path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" />
      <circle cx="12" cy="18.2" r="1.2" style={ACC} />
    </>
  ),
  dive: (
    <>
      <path d="M20.5 11.5a8 8 0 0 1-11.6 7.1L4 20l1.4-4.6a8 8 0 1 1 15.1-3.9Z" />
      <circle cx="8.7" cy="11.5" r="1.1" style={ACC} />
      <circle cx="12.2" cy="11.5" r="1.1" fill="currentColor" stroke="none" opacity="0.55" />
      <circle cx="15.7" cy="11.5" r="1.1" fill="currentColor" stroke="none" opacity="0.3" />
    </>
  ),
  download: (
    <>
      <path d="M12 4.5V15" />
      <path d="m7.5 11 4.5 4.5L16.5 11" />
      <path d="M4.5 19.5h15" />
      <circle cx="12" cy="4" r="1.3" style={ACC} />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4L19.5 8.5a2.12 2.12 0 0 0-3-3L5 17v3Z" />
      <path d="m13.5 6.5 3 3" />
      <circle cx="19.5" cy="19.5" r="1.3" style={ACC} />
    </>
  ),
  graph: (
    <>
      <path d="M4 19.5h16" />
      <path d="M5 15.5l4-5 3.5 3 5-6.5" />
      <circle cx="9" cy="10.5" r="1.2" />
      <circle cx="12.5" cy="13.5" r="1.2" />
      <circle cx="17.8" cy="6.6" r="1.6" style={ACC} />
    </>
  ),
  history: (
    <>
      <path d="M4.5 5.5V10H9" />
      <path d="M5.2 14a7 7 0 1 0 1.2-6.8L4.5 10" />
      <path d="M12 8.5V13l3 2" />
      <circle cx="12" cy="13" r="1.2" style={ACC} />
    </>
  ),
  layers: (
    <>
      <path d="m12 3.5 8.5 4.5L12 12.5 3.5 8 12 3.5Z" />
      <path d="m4.5 12.5 7.5 4 7.5-4" />
      <path d="m4.5 16.5 7.5 4 7.5-4" />
      <circle cx="12" cy="8" r="1.2" style={ACC} />
    </>
  ),
  logout: (
    <>
      <path d="M9.5 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3.5" />
      <path d="m15 8 4 4-4 4" />
      <path d="M19 12H9.5" />
      <circle cx="12" cy="12" r="1.2" style={ACC} />
    </>
  ),
  panel: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.4" />
      <path d="M9.5 4.5v15" />
      <path d="M12.5 9h5M12.5 12h5" />
      <circle cx="6.5" cy="8" r="1.1" style={ACC} />
    </>
  ),
  plus: (
    <>
      <path d="M12 5.5v13M5.5 12h13" />
      <circle cx="19.5" cy="4.5" r="1.6" style={ACC} />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 3.6V8h-4.4" />
      <circle cx="12" cy="12" r="1.6" style={ACC} />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.4-4.4" />
      <circle cx="9" cy="9" r="1.2" style={ACC} />
    </>
  ),
  send: (
    <>
      <path d="M20.5 3.5 3.5 10.8l6.2 2.5 2.5 6.2 8.3-16Z" />
      <path d="M9.7 13.3 20.5 3.5" />
      <circle cx="11.5" cy="9.5" r="1.1" style={ACC} />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h16M4 12h16M4 17h16" />
      <circle cx="15" cy="7" r="2.1" style={ACC} />
      <circle cx="9" cy="12" r="2.1" style={ACC} />
      <circle cx="17" cy="17" r="2.1" style={ACC} />
    </>
  ),
  spark: (
    <>
      <path d="M12 3c.9 5.2 3.8 8.1 9 9-5.2.9-8.1 3.8-9 9-.9-5.2-3.8-8.1-9-9 5.2-.9 8.1-3.8 9-9Z" />
      <circle cx="19.2" cy="4.8" r="1.7" style={ACC} />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 6.5h15" />
      <path d="M9 6.5V4.8a1.3 1.3 0 0 1 1.3-1.3h3.4A1.3 1.3 0 0 1 15 4.8v1.7" />
      <path d="m6.5 6.5.8 12a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-12" />
      <path d="M10 10.5v6M14 10.5v6" />
      <circle cx="12" cy="20.3" r="1" style={ACC} />
    </>
  ),
  upload: (
    <>
      <path d="M12 15V4.5" />
      <path d="M7.5 8.5 12 4l4.5 4.5" />
      <path d="M4.5 15.5V18a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2.5" />
      <circle cx="12" cy="4" r="1.3" style={ACC} />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5c1.3-3.6 4.1-5.5 7.5-5.5s6.2 1.9 7.5 5.5" />
      <circle cx="18.5" cy="5.5" r="1.4" style={ACC} />
    </>
  ),
};

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}

export function Icon({ name, size = 20, className, strokeWidth = 1.6 }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}