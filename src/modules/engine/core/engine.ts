/**
 * VisionGuard Digital Watcher - engine core
 * Pure functions, no I/O: geometry, smoothing, the rule state machine,
 * the risk score and the anomaly score. The NestJS ingestion service calls
 * these and keeps the state in Redis. The simulator and unit tests use
 * the same code.
 */
import type { Box, Polygon, Detection, RuleRuntimeState, Severity } from "@/common/contracts";

type Pt = [number, number];

// ───────────────────────── Geometry ─────────────────────────
/** Shoelace formula. */
export function polygonArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1];
  return Math.abs(a) / 2;
}

/** Ray casting (even-odd rule). Points exactly on an edge count as inside. */
export function pointInPolygon([px, py]: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    const cross = (px - xi) * (yj - yi) - (py - yi) * (xj - xi);
    if (Math.abs(cross) < 1e-12 && px >= Math.min(xi, xj) && px <= Math.max(xi, xj)
        && py >= Math.min(yi, yj) && py <= Math.max(yi, yj)) return true;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Sutherland-Hodgman: clip a polygon by an axis-aligned box, return the area of the result. */
export function polygonBoxIntersectionArea(poly: Pt[], [x, y, w, h]: Box): number {
  const clipEdge = (pts: Pt[], inside: (p: Pt) => boolean, cut: (a: Pt, b: Pt) => Pt): Pt[] => {
    const out: Pt[] = [];
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i], prev = pts[(i + pts.length - 1) % pts.length];
      const ci = inside(cur), pi = inside(prev);
      if (ci) { if (!pi) out.push(cut(prev, cur)); out.push(cur); }
      else if (pi) out.push(cut(prev, cur));
    }
    return out;
  };
  const atX = (X: number) => (a: Pt, b: Pt): Pt => [X, a[1] + ((b[1] - a[1]) * (X - a[0])) / (b[0] - a[0])];
  const atY = (Y: number) => (a: Pt, b: Pt): Pt => [a[0] + ((b[0] - a[0]) * (Y - a[1])) / (b[1] - a[1]), Y];
  let p = poly;
  p = clipEdge(p, (q) => q[0] >= x, atX(x));         if (p.length < 3) return 0;
  p = clipEdge(p, (q) => q[0] <= x + w, atX(x + w)); if (p.length < 3) return 0;
  p = clipEdge(p, (q) => q[1] >= y, atY(y));         if (p.length < 3) return 0;
  p = clipEdge(p, (q) => q[1] <= y + h, atY(y + h)); if (p.length < 3) return 0;
  return polygonArea(p);
}

export const footPoint = ([x, y, w, h]: Box): Pt => [x + w / 2, y + h];
export const centerPoint = ([x, y, w, h]: Box): Pt => [x + w / 2, y + h / 2];
/** Share of the BOX that lies inside the polygon (intersection over box area). */
export const boxInsideRatio = (poly: Pt[], b: Box): number =>
  b[2] * b[3] > 0 ? polygonBoxIntersectionArea(poly, b) / (b[2] * b[3]) : 0;
/** Intersection over union of a box and a polygon (for region-like objects such as piles). */
export function boxPolygonIoU(poly: Pt[], b: Box): number {
  const inter = polygonBoxIntersectionArea(poly, b);
  const union = polygonArea(poly) + b[2] * b[3] - inter;
  return union > 0 ? inter / union : 0;
}

export type Anchor = 'foot' | 'center' | 'overlap';
/**
 * Zone membership.
 *  foot    : bottom-centre point inside, OR box overlap >= minOverlap (feet hidden or cut off).
 *            For things that stand on the ground: people, animals, vehicles.
 *  center  : centre point inside. For things that do not stand on the zone surface.
 *  overlap : box overlap >= minOverlap. For shelves, stacks, piles.
 */
export function inZone(poly: Pt[], box: Box, anchor: Anchor, minOverlap = 0.35): boolean {
  if (anchor === 'foot') return pointInPolygon(footPoint(box), poly) || boxInsideRatio(poly, box) >= minOverlap;
  if (anchor === 'center') return pointInPolygon(centerPoint(box), poly);
  return boxInsideRatio(poly, box) >= minOverlap;
}

/** Precompute once per zone: which cells of an N x N grid have their centre inside the polygon. */
export function zoneMask(poly: Pt[], n = 64): Uint8Array {
  const m = new Uint8Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++)
    if (pointInPolygon([(c + 0.5) / n, (r + 0.5) / n], poly)) m[r * n + c] = 1;
  return m;
}
/** Share of the ZONE covered by the union of the boxes (occupancy / fill ratio from boxes). */
export function zoneCoverage(mask: Uint8Array, boxes: Box[], n = 64): number {
  let total = 0, covered = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!mask[r * n + c]) continue;
    total++;
    const px = (c + 0.5) / n, py = (r + 0.5) / n;
    if (boxes.some(([x, y, w, h]) => px >= x && px <= x + w && py >= y && py <= y + h)) covered++;
  }
  return total ? covered / total : 0;
}

/** Scale-free distance between two standing objects: foot distance / mean box height. */
export function proximity(a: Box, b: Box): number {
  const [ax, ay] = footPoint(a), [bx, by] = footPoint(b);
  const meanH = (a[3] + b[3]) / 2;
  return meanH > 0 ? Math.hypot(ax - bx, ay - by) / meanH : Infinity;
}

/** Fallback when a model sends helmets as separate boxes instead of attrs:
 *  a helmet belongs to a person if its centre is in the top third of the person box. */
export function attachHeadItem(person: Box, item: Box): boolean {
  const [cx, cy] = centerPoint(item);
  return cx >= person[0] && cx <= person[0] + person[2] && cy >= person[1] && cy <= person[1] + person[3] / 3;
}

// ───────────────────────── Smoothing ─────────────────────────
export interface Sample { t: number; v: number }
const inWindow = (s: Sample[], now: number, windowS: number) => s.filter((x) => now - x.t <= windowS * 1000);
/** Middle value in the window: removes one-frame false detections. */
export function rollingMedian(s: Sample[], now: number, windowS: number): number {
  const v = inWindow(s, now, windowS).map((x) => x.v).sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
/** Highest value in the window: hides animals covering each other when checking a minimum count. */
export function rollingMax(s: Sample[], now: number, windowS: number): number {
  const v = inWindow(s, now, windowS);
  return v.length ? Math.max(...v.map((x) => x.v)) : 0;
}

// ───────────────────────── Rule state machine ─────────────────────────
export interface RuleTiming { sustainS: number; clearS: number; cooldownS: number; dropToleranceS?: number; minRatio?: number }
export type Transition = 'none' | 'pending' | 'reset' | 'fire' | 'refire' | 'clear' | 'rearm';

/**
 * One step. `violating` is the rule condition on the SMOOTHED value at device time `now` (ms).
 *   ok       --violating-->                               pending
 *   pending  --ok for longer than dropTolerance-->        ok       (reset)
 *   pending  --sustainS reached and ratio >= minRatio-->  firing   (fire: open incident)
 *   firing   --ok for clearS-->                           cooldown (clear: condition ended)
 *   cooldown --violating before cooldownUntil-->          firing   (refire: SAME incident, no new alert)
 *   cooldown --cooldownUntil passed and ok-->             ok       (rearm)
 */
export function stepRule(s: RuleRuntimeState, violating: boolean, now: number, t: RuleTiming):
  { state: RuleRuntimeState; transition: Transition } {
  const drop = (t.dropToleranceS ?? Math.min(5, Math.max(1, t.sustainS / 3))) * 1000;
  const minRatio = t.minRatio ?? 0.8;
  const n: RuleRuntimeState = { ...s };
  switch (s.state) {
    case 'ok':
      if (!violating) return { state: n, transition: 'none' };
      Object.assign(n, { state: 'pending', firstViolatedAt: now, lastViolatedAt: now, samples: 1, violating: 1 });
      if (t.sustainS === 0) { n.state = 'firing'; return { state: n, transition: 'fire' }; }
      return { state: n, transition: 'pending' };
    case 'pending': {
      n.samples = s.samples + 1;
      if (violating) { n.violating = s.violating + 1; n.lastViolatedAt = now; }
      else if (now - (s.lastViolatedAt ?? now) > drop)
        return { state: { state: 'ok', samples: 0, violating: 0 }, transition: 'reset' };
      const longEnough = now - (s.firstViolatedAt ?? now) >= t.sustainS * 1000;
      if (violating && longEnough && n.violating / n.samples >= minRatio) { n.state = 'firing'; return { state: n, transition: 'fire' }; }
      return { state: n, transition: 'none' };
    }
    case 'firing':
      if (violating) { n.lastViolatedAt = now; return { state: n, transition: 'none' }; }
      if (now - (s.lastViolatedAt ?? now) >= t.clearS * 1000) {
        n.state = 'cooldown'; n.cooldownUntil = now + t.cooldownS * 1000;
        return { state: n, transition: 'clear' };
      }
      return { state: n, transition: 'none' };
    case 'cooldown':
      if (violating && now < (s.cooldownUntil ?? 0)) { n.state = 'firing'; n.lastViolatedAt = now; return { state: n, transition: 'refire' }; }
      if (now >= (s.cooldownUntil ?? 0)) {
        if (!violating) return { state: { state: 'ok', samples: 0, violating: 0 }, transition: 'rearm' };
        return { state: { state: 'pending', firstViolatedAt: now, lastViolatedAt: now, samples: 1, violating: 1 }, transition: 'pending' };
      }
      return { state: n, transition: 'none' };
  }
}

// ───────────────────────── Scores ─────────────────────────
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const SEVERITY_BASE: Record<Severity, number> = { low: 20, medium: 40, high: 60, critical: 80 };
export const SENSITIVITY: Record<1 | 2 | 3, number> = { 1: 0.85, 2: 1.0, 3: 1.15 };

export interface RiskInput {
  severity: Severity;
  /** 1 if the incident starts at night (22:00-06:00 site time) or inside the rule's restricted window. */
  timeContext: 0 | 1;
  /** How far past the limit, 0..1 (see blueprint section 2.5 for each rule kind). */
  magnitude: number;
  durationS: number; sustainS: number;
  /** Anomaly score 0..1 from anomalyScore(), 0 when there is no baseline. */
  anomaly: number;
  avgConf: number;             // mean detection confidence 0..1
  fpRate7d: number;            // false alarms / incidents of this rule in the last 7 days, 0..1
  sensitivity: 1 | 2 | 3;      // site.sensitivity
}
/**
 * R = clamp( round( k_s * (0.6 + 0.4 c) * (1 - 0.3 f) * (B + 15 T + 15 M + 10 D + 10 A) ), 0, 100 )
 *   D = min(1, (duration - sustain) / (4 * max(sustain, 15)))
 * Actions: R < 20 log only | 20-49 in-app only | 50-79 escalation from step 1 | >= 80 urgent (call at once)
 */
export function riskScore(i: RiskInput) {
  const base = SEVERITY_BASE[i.severity];
  const time = 15 * i.timeContext;
  const magnitude = 15 * clamp(i.magnitude, 0, 1);
  const duration = 10 * clamp((i.durationS - i.sustainS) / (4 * Math.max(i.sustainS, 15)), 0, 1);
  const anomaly = 10 * clamp(i.anomaly, 0, 1);
  const confFactor = 0.6 + 0.4 * clamp(i.avgConf, 0, 1);
  const fpFactor = 1 - 0.3 * clamp(i.fpRate7d, 0, 1);
  const sensitivity = SENSITIVITY[i.sensitivity];
  const score = clamp(Math.round(sensitivity * confFactor * fpFactor * (base + time + magnitude + duration + anomaly)), 0, 100);
  return { score, parts: { base, time, magnitude, duration, anomaly, confFactor, fpFactor, sensitivity } };
}
export const riskAction = (r: number) => (r >= 80 ? 'urgent' : r >= 50 ? 'alert' : r >= 20 ? 'inapp' : 'log');

/**
 * Robust z-score against the hour-of-week baseline.
 *   sigma = max(1.4826 * MAD, 0.5 * sqrt(median + 1))      (floor stops tiny baselines from exploding)
 *   z     = (value - median) / sigma
 *   zOn   = 3.0 / k_s ,  score = clamp((|z| - zOn) / 3, 0, 1)
 * Returns score 0 when the baseline has fewer than 3 weeks of data.
 */
export function anomalyScore(value: number, b: { median: number; mad: number; nWeeks: number },
                             sensitivity: 1 | 2 | 3, direction: 'above' | 'below' | 'both' = 'both', zOnBase = 3.0) {
  if (b.nWeeks < 3) return { z: 0, score: 0, violating: false };
  const sigma = Math.max(1.4826 * b.mad, 0.5 * Math.sqrt(b.median + 1));
  const z = (value - b.median) / sigma;
  const zOn = zOnBase / SENSITIVITY[sensitivity];
  const signed = direction === 'above' ? z : direction === 'below' ? -z : Math.abs(z);
  return { z, score: clamp((signed - zOn) / 3, 0, 1), violating: signed >= zOn };
}

/** Count detections of the wanted classes that are in the zone. */
export function countInZone(poly: Pt[], dets: Detection[], classes: string[], anchor: Anchor, minOverlap = 0.35): number {
  return dets.filter((d) => classes.includes(d.cls) && inZone(poly, d.box, anchor, minOverlap)).length;
}
export type { Polygon };
