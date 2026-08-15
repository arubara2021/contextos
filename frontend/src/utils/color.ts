import {
  CONCEPT_TYPES,
  RELATIONSHIP_TYPES,
  STRENGTH_CATEGORIES,
} from "../constants";
import type { ConceptType, RelationshipType, StrengthCategory } from "../types";

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function lerpScalar(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function hexToRgb(hex: string): RGB {
  let cleaned = hex.replace("#", "");
  if (cleaned.length === 3) {
    cleaned = cleaned
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const value = parseInt(cleaned, 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function toHex2(n: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(n)));
  return clamped.toString(16).padStart(2, "0");
}

export function rgbToHex(rgb: RGB): string {
  return `#${toHex2(rgb.r)}${toHex2(rgb.g)}${toHex2(rgb.b)}`;
}

export function rgbToCss(rgb: RGB, alpha = 1): string {
  return alpha >= 1
    ? `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`
    : `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.round(clamp01(alpha) * 1000) / 1000})`;
}

export function withAlpha(hex: string, alpha: number): string {
  return rgbToCss(hexToRgb(hex), alpha);
}

export function mixHex(a: string, b: string, t: number): RGB {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const clamped = clamp01(t);
  return {
    r: Math.round(lerpScalar(ca.r, cb.r, clamped)),
    g: Math.round(lerpScalar(ca.g, cb.g, clamped)),
    b: Math.round(lerpScalar(ca.b, cb.b, clamped)),
  };
}

const STRENGTH_STOPS: Array<{ at: number; hex: string }> = [
  { at: 0, hex: "#46505B" },
  { at: 0.04, hex: "#6E4A45" },
  { at: 0.1, hex: "#FF5C49" },
  { at: 0.25, hex: "#C23A2C" },
  { at: 0.4, hex: "#C45A28" },
  { at: 0.55, hex: "#E07530" },
  { at: 0.7, hex: "#FF8A3D" },
  { at: 0.85, hex: "#FFBE4A" },
  { at: 1, hex: "#FFE6A8" },
];

export function strengthColor(strength: number): string {
  const s = clamp01(strength);
  for (let i = 0; i < STRENGTH_STOPS.length - 1; i++) {
    const from = STRENGTH_STOPS[i];
    const to = STRENGTH_STOPS[i + 1];
    if (s >= from.at && s <= to.at) {
      const t = to.at === from.at ? 0 : (s - from.at) / (to.at - from.at);
      return rgbToHex(mixHex(from.hex, to.hex, t));
    }
  }
  return STRENGTH_STOPS[STRENGTH_STOPS.length - 1].hex;
}

export function strengthGlow(strength: number, alphaScale = 1): string {
  const alpha = (0.18 + clamp01(strength) * 0.56) * alphaScale;
  return withAlpha(strengthColor(strength), alpha);
}

export interface NodePalette {
  core: string;
  rim: string;
  glow: string;
  label: string;
}

export function nodePalette(strength: number, conceptType?: string): NodePalette {
  const s = clamp01(strength);
  const heat = strengthColor(s);
  const rim = conceptType
    ? rgbToHex(mixHex(heat, typeColor(conceptType as ConceptType), 0.28))
    : heat;
  const coreTarget = s > 0.4 ? "#FFF1CC" : "#0E0B09";
  const coreMix = 0.12 + s * 0.3;
  return {
    core: rgbToCss(mixHex(rim, coreTarget, coreMix)),
    rim,
    glow: withAlpha(rim, 0.2 + s * 0.58),
    label: "#ECE5DA",
  };
}

export function nodeRadius(importance: number): number {
  return 18 + Math.max(1, Math.min(10, importance)) * 3.5;
}

export function categoryColor(category: StrengthCategory): string {
  return STRENGTH_CATEGORIES[category].color;
}

export function categoryGlow(category: StrengthCategory, alpha = 0.4): string {
  return withAlpha(STRENGTH_CATEGORIES[category].color, alpha);
}

export function typeColor(type: ConceptType): string {
  return CONCEPT_TYPES[type]?.color ?? "#A29384";
}

export function typeGlow(type: ConceptType, alpha = 0.4): string {
  return withAlpha(typeColor(type), alpha);
}

export function relationshipColor(type: RelationshipType): string {
  return RELATIONSHIP_TYPES[type]?.color ?? "rgba(236, 229, 218, 0.16)";
}
