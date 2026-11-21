import type { Detection, FrameStats } from "@/common/contracts";
import { anomalyScore, proximity, rollingMax, rollingMedian, Sample } from "@/modules/engine/core/engine";

/**
 * "Is this rule violated right now?"  One function per rule kind.
 * Pure code: it gets what the zone looks like and answers. It does not know
 * about Redis, the database or HTTP, so the same code runs in the API,
 * in unit tests and in the simulator.
 */

/** What one zone looks like at one moment. */
export interface ZoneFrame {
  now: number; // epoch ms, device time
  dets: Detection[]; // detections inside the zone
  counts: Record<string, number>; // per class, parents included (cow also counts as animal)
  measures: Record<string, number>; // zone measures in this reading (fill_ratio, stock_count)
  samples: Record<string, Sample[]>; // recent history per metric: "count.cow", "measure.fill_ratio"
  frameStats?: FrameStats; // camera-level, for tamper checks
}

export interface EvalOptions {
  wasViolating: boolean; // for rules with two thresholds
  sensitivity: 1 | 2 | 3;
  baseline?: { median: number; mad: number; nWeeks: number } | null;
}

export interface EvalResult {
  violating: boolean;
  value: number; // the number compared with the rule
  unit: "count" | "ratio" | "z" | "pairs" | "seconds";
  magnitude: number; // how far past the limit, 0..1 (feeds the risk score)
  subject: string; // what the rule is about; part of the incident's dedup key
  boxes: Detection[]; // up to 10 detections that caused the violation
  avgConf: number;
  baseline?: { median: number; mad: number; z: number };
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const conf = (dets: Detection[]) => (dets.length ? avg(dets.map((d) => d.conf)) : 1);
const isClass = (d: Detection, cls: string, parents: Record<string, string | null>) => d.cls === cls || parents[d.cls] === cls;

/** Returns null when the reading has no data for this rule (the rule keeps its state). */
export function evaluateRule(kind: string, p: any, f: ZoneFrame, o: EvalOptions, parents: Record<string, string | null> = {}): EvalResult | null {
  switch (kind) {
    case "presence": {
      const hits = f.dets.filter((d) => p.subjects.some((s: string) => isClass(d, s, parents)));
      return { violating: hits.length >= p.min, value: hits.length, unit: "count", magnitude: clamp01(hits.length / 3), subject: p.subjects.join("+"), boxes: hits.slice(0, 10), avgConf: conf(hits) };
    }

    case "count_range": {
      const samples = f.samples[`count.${p.subject}`] ?? [];
      if (!samples.length) return null;
      // max hides animals covering each other (used with a minimum);
      // median hides one-frame false detections (used with a maximum)
      const value = p.estimator === "median" ? rollingMedian(samples, f.now, p.windowS) : rollingMax(samples, f.now, p.windowS);
      const below = p.min !== undefined && value < p.min;
      const above = p.max !== undefined && value > p.max;
      const magnitude = below ? (p.min - value) / Math.max(p.min, 1) : above ? (value - p.max) / Math.max(p.max, 1) : 0;
      const boxes = f.dets.filter((d) => isClass(d, p.subject, parents));
      return { violating: below || above, value, unit: "count", magnitude: clamp01(magnitude), subject: p.subject, boxes: boxes.slice(0, 10), avgConf: conf(boxes) };
    }

    case "attribute_missing": {
      // only subjects the second-stage model looked at (attrs present) can be judged
      const subjects = f.dets.filter((d) => isClass(d, p.subject, parents) && d.attrs);
      const missing = (d: Detection, a: string) => (d.attrs?.[a] ?? 0) < p.attrThreshold;
      const violators = subjects.filter((d) => (p.mode === "all" ? p.required.every((a: string) => missing(d, a)) : p.required.some((a: string) => missing(d, a))));
      return { violating: violators.length >= p.minViolators, value: violators.length, unit: "count", magnitude: clamp01(violators.length / Math.max(subjects.length, 1)), subject: `${p.subject}:${p.required.join("+")}`, boxes: violators.slice(0, 10), avgConf: conf(violators) };
    }

    case "proximity": {
      const as = f.dets.filter((d) => isClass(d, p.a, parents));
      const bs = f.dets.filter((d) => isClass(d, p.b, parents));
      let pairs = 0;
      let closest = Infinity;
      const boxes: Detection[] = [];
      for (const a of as)
        for (const b of bs) {
          const dist = proximity(a.box, b.box);
          if (dist <= p.maxDist) {
            pairs++;
            closest = Math.min(closest, dist);
            if (boxes.length < 10) boxes.push(a, b);
          }
        }
      return { violating: pairs >= p.minPairs, value: pairs, unit: "pairs", magnitude: pairs ? clamp01(1 - closest / p.maxDist) : 0, subject: `${p.a}~${p.b}`, boxes: boxes.slice(0, 10), avgConf: conf(boxes) };
    }

    case "measure_threshold": {
      const value = f.measures[p.measure];
      if (value === undefined) return null;
      // two thresholds: starts at "on", ends only after crossing "off" (no flapping around one value)
      const on = p.op === "lt" ? value < p.on : value > p.on;
      const stillOn = p.op === "lt" ? value < p.off : value > p.off;
      const violating = on || (o.wasViolating && stillOn);
      return { violating, value, unit: "ratio", magnitude: clamp01(Math.abs(p.on - value) / Math.max(Math.abs(p.on), 0.01)), subject: p.measure, boxes: [], avgConf: 1 };
    }

    case "delta": {
      const samples = (f.samples[p.metric] ?? []).filter((s) => f.now - s.t <= p.windowS * 1000);
      if (samples.length < 2) return null;
      const start = samples[0].v;
      const current = samples[samples.length - 1].v;
      const change = p.direction === "down" ? start - current : current - start;
      const absOk = p.minAbs === undefined || change >= p.minAbs;
      const pctOk = p.minPct === undefined || (start > 0 && change / start >= p.minPct);
      const limit = p.minAbs ?? start * (p.minPct ?? 1);
      return { violating: change > 0 && absOk && pctOk, value: change, unit: "count", magnitude: clamp01(change / Math.max(2 * limit, 1)), subject: p.metric, boxes: [], avgConf: 1 };
    }

    case "anomaly": {
      const samples = (f.samples[p.metric] ?? []).filter((s) => f.now - s.t <= p.windowS * 1000);
      if (!samples.length || !o.baseline) return null; // no baseline yet = the rule sleeps
      const value = avg(samples.map((s) => s.v));
      const a = anomalyScore(value, o.baseline, o.sensitivity, p.direction, p.zOn);
      return { violating: a.violating, value: a.z, unit: "z", magnitude: a.score, subject: p.metric, boxes: [], avgConf: 1, baseline: { median: o.baseline.median, mad: o.baseline.mad, z: a.z } };
    }

    case "device_health": {
      if (p.check !== "tamper" || !f.frameStats) return null; // "offline" is found by the sweeper job
      const s = f.frameStats;
      const violating = s.brightness < p.darkBelow || s.sharpness < p.blurBelow || s.sceneChange > p.sceneChangeAbove;
      return { violating, value: violating ? 1 : 0, unit: "count", magnitude: violating ? 1 : 0, subject: "tamper", boxes: [], avgConf: 1 };
    }

    default:
      return null;
  }
}
