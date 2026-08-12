import { DECAY_THRESHOLDS } from "../constants";
import type { StrengthCategory } from "../types";

export interface DecayCurvePoint {
  day: number;
  strength: number;
}

export interface StrengthSource {
  strength: number;
  decayRate: number;
  lastAccessed: string | Date;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function clampStrength(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function getDecayRate(importance: number): number {
  if (importance >= 8) return 0.1;
  if (importance >= 5) return 0.15;
  return 0.2;
}

export function computeStrength(
  initialStrength: number,
  decayRate: number,
  daysSinceAccess: number
): number {
  if (daysSinceAccess <= 0) return round4(clampStrength(initialStrength));
  const decayed = initialStrength * Math.pow(1 - decayRate, daysSinceAccess);
  return round4(clampStrength(decayed));
}

export function refreshStrength(currentStrength: number, accessBoost = 1.0): number {
  const retained = currentStrength * DECAY_THRESHOLDS.retainWeight;
  const boosted = accessBoost * DECAY_THRESHOLDS.accessBoostWeight;
  return round4(Math.min(1, retained + boosted));
}

export function categorize(strength: number): StrengthCategory {
  if (strength >= DECAY_THRESHOLDS.strong) return "strong";
  if (strength >= DECAY_THRESHOLDS.fading) return "fading";
  if (strength >= DECAY_THRESHOLDS.forgotten) return "critical";
  return "forgotten";
}

export function daysSinceAccess(lastAccessed: string | Date): number {
  const then =
    typeof lastAccessed === "string"
      ? new Date(lastAccessed).getTime()
      : lastAccessed.getTime();
  return Math.max(0, (Date.now() - then) / 86_400_000);
}

export function getCurrentStrength(source: StrengthSource): number {
  return computeStrength(
    source.strength,
    source.decayRate,
    daysSinceAccess(source.lastAccessed)
  );
}

export function getDecayCurve(
  initialStrength: number,
  decayRate: number,
  days: number
): DecayCurvePoint[] {
  const points: DecayCurvePoint[] = [];
  for (let day = 0; day <= days; day++) {
    points.push({
      day,
      strength: computeStrength(initialStrength, decayRate, day),
    });
  }
  return points;
}

export function daysUntilStrength(
  initialStrength: number,
  decayRate: number,
  targetStrength: number
): number | null {
  if (initialStrength <= targetStrength) return 0;
  if (targetStrength <= 0) return null;
  if (decayRate <= 0 || decayRate >= 1) return null;
  const days = Math.log(targetStrength / initialStrength) / Math.log(1 - decayRate);
  return Number.isFinite(days) && days > 0 ? days : null;
}

export function projectStrength(source: StrengthSource, days: number): number {
  return computeStrength(getCurrentStrength(source), source.decayRate, days);
}

export function projectToCategory(
  source: StrengthSource,
  category: StrengthCategory
): number | null {
  const targets: Record<StrengthCategory, number> = {
    strong: DECAY_THRESHOLDS.strong,
    fading: DECAY_THRESHOLDS.fading,
    critical: DECAY_THRESHOLDS.forgotten,
    forgotten: DECAY_THRESHOLDS.forgotten * 0.5,
  };
  return daysUntilStrength(getCurrentStrength(source), source.decayRate, targets[category]);
}