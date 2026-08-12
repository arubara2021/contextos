export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function vec(x = 0, y = 0): Vec2 {
  return { x, y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s };
}

export function addScaled(a: Vec2, b: Vec2, s: number): Vec2 {
  return { x: a.x + b.x * s, y: a.y + b.y * s };
}

export function lengthSq(a: Vec2): number {
  return a.x * a.x + a.y * a.y;
}

export function length(a: Vec2): number {
  return Math.sqrt(lengthSq(a));
}

export function distanceSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.sqrt(distanceSq(a, b));
}

export function normalize(a: Vec2): Vec2 {
  const l = length(a);
  return l > 1e-9 ? scale(a, 1 / l) : { x: 0, y: 0 };
}

export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function clampLength(a: Vec2, max: number): Vec2 {
  const l = length(a);
  return l > max && l > 1e-9 ? scale(a, max / l) : a;
}

export function rotate(a: Vec2, angle: number): Vec2 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: a.x * cos - a.y * sin, y: a.x * sin + a.y * cos };
}

export function angleOf(a: Vec2): number {
  return Math.atan2(a.y, a.x);
}

export function fromAngle(angle: number, magnitude = 1): Vec2 {
  return { x: Math.cos(angle) * magnitude, y: Math.sin(angle) * magnitude };
}

export function perpendicular(a: Vec2): Vec2 {
  return { x: -a.y, y: a.x };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function jitter(a: Vec2, amount: number): Vec2 {
  return {
    x: a.x + (Math.random() - 0.5) * amount,
    y: a.y + (Math.random() - 0.5) * amount,
  };
}

export function randomInCircle(radius: number): Vec2 {
  const angle = Math.random() * Math.PI * 2;
  const r = radius * Math.sqrt(Math.random());
  return fromAngle(angle, r);
}

export function boundsOf(points: Vec2[]): Rect {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function padRect(rect: Rect, padding: number): Rect {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  };
}

export function rectCenter(rect: Rect): Vec2 {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export function containsPoint(rect: Rect, point: Vec2): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

export function clampScalar(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerpScalar(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}