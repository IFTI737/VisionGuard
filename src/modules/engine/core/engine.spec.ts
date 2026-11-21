import assert from "node:assert/strict";
import * as E from "@/modules/engine/core/engine";
import type { RuleRuntimeState, Box } from "@/common/contracts";

// The same checks that proved the reference engine, now run by jest (pnpm test).
test("engine: geometry, smoothing, state machine, risk and anomaly scores", () => {

  const sq: [number, number][] = [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]];
  const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

  // geometry
  near(E.polygonArea(sq), 0.36);
  assert.equal(E.pointInPolygon([0.5, 0.5], sq), true);
  assert.equal(E.pointInPolygon([0.1, 0.5], sq), false);
  near(E.polygonBoxIntersectionArea(sq, [0.0, 0.0, 0.5, 0.5]), 0.09);
  near(E.boxInsideRatio(sq, [0.0, 0.0, 0.5, 0.5]), 0.36);
  // concave L-shape, area 0.75; box covering the missing corner overlaps nothing
  const L: [number, number][] = [[0, 0], [1, 0], [1, 0.5], [0.5, 0.5], [0.5, 1], [0, 1]];
  near(E.polygonArea(L), 0.75);
  near(E.polygonBoxIntersectionArea(L, [0.6, 0.6, 0.3, 0.3]), 0);
  near(E.polygonBoxIntersectionArea(L, [0.25, 0.25, 0.5, 0.5]), 0.1875);
  // person standing with feet in the zone but body mostly above it -> inside by foot
  const person: Box = [0.45, 0.0, 0.1, 0.3];
  assert.equal(E.inZone(sq, person, 'foot'), true);
  assert.equal(E.inZone(sq, person, 'center'), false);
  // feet cut off below the zone, 40 % of the body inside -> inside by overlap fallback
  assert.equal(E.inZone(sq, [0.45, 0.6, 0.1, 0.5], 'foot'), true);
  near(E.boxPolygonIoU(sq, [0.2, 0.2, 0.6, 0.6]), 1);
  const mask = E.zoneMask(sq);
  near(E.zoneCoverage(mask, [[0.2, 0.2, 0.3, 0.6]]), 0.5, 0.03);
  near(E.proximity([0.4, 0.4, 0.1, 0.2], [0.5, 0.4, 0.1, 0.2]), 0.5);

  // smoothing: one-frame flicker removed by median, occlusion hidden by max
  const s = [10, 10, 7, 10, 10].map((v, i) => ({ t: i * 1000, v }));
  assert.equal(E.rollingMedian(s, 4000, 10), 10);
  assert.equal(E.rollingMax(s, 4000, 60), 10);

  // state machine: 10 cows expected, 9 seen. sustain 10 s, clear 5 s, cooldown 60 s. 1 reading per second.
  const T = { sustainS: 10, clearS: 5, cooldownS: 60 };
  let st: RuleRuntimeState = { state: 'ok', samples: 0, violating: 0 };
  const log: string[] = [];
  const feed = (t: number, v: boolean) => { const r = E.stepRule(st, v, t * 1000, T); st = r.state; if (r.transition !== 'none') log.push(`${t}:${r.transition}`); };
  for (let t = 0; t <= 4; t++) feed(t, true);
  feed(5, false); feed(6, false);            // 2 s flicker: tolerated (drop tolerance 3.33 s)
  for (let t = 7; t <= 12; t++) feed(t, true); // fires at t=10 (sustain reached, ratio 9/11 >= 0.8)
  assert.equal(st.state, 'firing');
  for (let t = 13; t <= 18; t++) feed(t, false); // ok for 5 s after last violation at 12 -> clear at 17
  assert.equal(st.state, 'cooldown');
  feed(30, true);                              // back within cooldown -> same incident
  assert.equal(st.state, 'firing');
  for (let t = 31; t <= 36; t++) feed(t, false);
  feed(200, false);                            // cooldown over and ok -> rearm
  assert.deepEqual(log, ['0:pending', '10:fire', '17:clear', '30:refire', '35:clear', '200:rearm']);
  // a short blip never fires
  st = { state: 'ok', samples: 0, violating: 0 }; log.length = 0;
  feed(0, true); feed(1, true); for (let t = 2; t <= 8; t++) feed(t, false);
  assert.deepEqual(log, ['0:pending', '5:reset']);

  // risk: missing cow at night, high severity, 9 of 10, 15 minutes, confident, no false alarms
  const r = E.riskScore({ severity: 'high', timeContext: 1, magnitude: 0.1, durationS: 900, sustainS: 600, anomaly: 0, avgConf: 0.87, fpRate7d: 0, sensitivity: 2 });
  assert.equal(r.score, 74); assert.equal(E.riskAction(r.score), 'alert');
  // intruder on the rooftop at night, critical, sure detection, high sensitivity -> urgent
  const r2 = E.riskScore({ severity: 'critical', timeContext: 1, magnitude: 1, durationS: 20, sustainS: 5, anomaly: 0, avgConf: 0.9, fpRate7d: 0, sensitivity: 3 });
  assert.equal(E.riskAction(r2.score), 'urgent');
  // low severity daytime with many false alarms -> stays in the app
  const r3 = E.riskScore({ severity: 'low', timeContext: 0, magnitude: 0.2, durationS: 30, sustainS: 30, anomaly: 0, avgConf: 0.5, fpRate7d: 0.6, sensitivity: 1 });
  assert.equal(E.riskAction(r3.score), 'log');

  // anomaly: usually 2 people at this hour (MAD 1), now 12 -> strong anomaly; 3 -> none; young baseline -> off
  const a = E.anomalyScore(12, { median: 2, mad: 1, nWeeks: 4 }, 2, 'above');
  assert.ok(a.violating && a.score > 0.9);
  assert.equal(E.anomalyScore(3, { median: 2, mad: 1, nWeeks: 4 }, 2, 'above').violating, false);
  assert.equal(E.anomalyScore(12, { median: 2, mad: 1, nWeeks: 2 }, 2, 'above').violating, false);
});
