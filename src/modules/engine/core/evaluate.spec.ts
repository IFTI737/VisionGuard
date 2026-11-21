import type { Detection } from "@/common/contracts";
import { evaluateRule, ZoneFrame } from "@/modules/engine/core/evaluate";
import { isWithinSchedule } from "@/modules/engine/core/schedule";
import { validateRuleParams } from "@/modules/rule/rule-params";

const cow = (i: number): Detection => ({ cls: "cow", conf: 0.9, box: [0.1 + i * 0.05, 0.3, 0.05, 0.1] });
const person = (attrs?: Record<string, number>): Detection => ({ cls: "person", conf: 0.8, box: [0.4, 0.3, 0.1, 0.3], attrs });
const frame = (over: Partial<ZoneFrame>): ZoneFrame => ({ now: 600_000, dets: [], counts: {}, measures: {}, samples: {}, ...over });
const opts = { wasViolating: false, sensitivity: 2 as const };

describe("evaluateRule", () => {
  test("count_range: 9 cows when 10 are expected is a violation; 10 is not", () => {
    const params = validateRuleParams("count_range", {}, { subject: "cow", min: 10 });
    const nine = evaluateRule("count_range", params, frame({ samples: { "count.cow": [{ t: 590_000, v: 9 }, { t: 600_000, v: 9 }] } }), opts);
    expect(nine).toMatchObject({ violating: true, value: 9 });
    // one frame hid a cow, but the highest count in the window is still 10: no alarm
    const occluded = evaluateRule("count_range", params, frame({ samples: { "count.cow": [{ t: 560_000, v: 10 }, { t: 600_000, v: 9 }] } }), opts);
    expect(occluded?.violating).toBe(false);
  });

  test("presence: a cow also counts as an animal (parent class)", () => {
    const result = evaluateRule("presence", { subjects: ["animal"], min: 1 }, frame({ dets: [cow(0)] }), opts, { cow: "animal" });
    expect(result?.violating).toBe(true);
  });

  test("attribute_missing: a worker without a helmet", () => {
    const params = validateRuleParams("attribute_missing", {}, { subject: "person", required: ["helmet", "vest"] });
    expect(evaluateRule("attribute_missing", params, frame({ dets: [person({ helmet: 0.1, vest: 0.9 })] }), opts)?.violating).toBe(true);
    expect(evaluateRule("attribute_missing", params, frame({ dets: [person({ helmet: 0.9, vest: 0.9 })] }), opts)?.violating).toBe(false);
    // no second-stage result for this person: we do not guess
    expect(evaluateRule("attribute_missing", params, frame({ dets: [person()] }), opts)?.violating).toBe(false);
  });

  test("measure_threshold: starts below 0.4, ends only above 0.5", () => {
    const params = { measure: "fill_ratio", op: "lt", on: 0.4, off: 0.5 };
    expect(evaluateRule("measure_threshold", params, frame({ measures: { fill_ratio: 0.45 } }), opts)?.violating).toBe(false);
    expect(evaluateRule("measure_threshold", params, frame({ measures: { fill_ratio: 0.45 } }), { ...opts, wasViolating: true })?.violating).toBe(true);
    expect(evaluateRule("measure_threshold", params, frame({ measures: {} }), opts)).toBeNull();
  });

  test("delta: brick stock fell by 80 inside the window", () => {
    const params = { metric: "measure.stock_count", direction: "down", windowS: 3600, minAbs: 50 };
    const result = evaluateRule("delta", params, frame({ samples: { "measure.stock_count": [{ t: 0, v: 500 }, { t: 600_000, v: 420 }] } }), opts);
    expect(result).toMatchObject({ violating: true, value: 80 });
  });

  test("anomaly: sleeps without a baseline, fires far above it", () => {
    const params = { metric: "count.person", direction: "above", zOn: 3, windowS: 900 };
    const f = frame({ samples: { "count.person": [{ t: 600_000, v: 12 }] } });
    expect(evaluateRule("anomaly", params, f, opts)).toBeNull();
    expect(evaluateRule("anomaly", params, f, { ...opts, baseline: { median: 2, mad: 1, nWeeks: 4 } })?.violating).toBe(true);
  });
});

describe("rule params and schedules", () => {
  test("wrong params are refused with the field name", () => {
    expect(() => validateRuleParams("count_range", {}, { subject: "cow", min: "ten" })).toThrow();
    expect(() => validateRuleParams("count_range", {}, { subject: "cow" })).toThrow(); // neither min nor max
  });

  test("a night window 22:00-06:00 continues after midnight (Asia/Dhaka)", () => {
    const night = { windows: [{ dow: [0, 1, 2, 3, 4, 5, 6] as any, from: "22:00", to: "06:00" }] };
    expect(isWithinSchedule(night, Date.parse("2026-11-16T23:30:00+06:00"), "Asia/Dhaka")).toBe(true);
    expect(isWithinSchedule(night, Date.parse("2026-11-17T05:59:00+06:00"), "Asia/Dhaka")).toBe(true);
    expect(isWithinSchedule(night, Date.parse("2026-11-17T14:00:00+06:00"), "Asia/Dhaka")).toBe(false);
  });
});
