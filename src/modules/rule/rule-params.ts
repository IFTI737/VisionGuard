import { BadRequestException } from "@nestjs/common";
import { z } from "zod";

// One zod schema per rule kind. rules.params is JSONB, so the database cannot
// check its shape; these schemas do, with a clear message for Postman and the form.
const cls = z.string().min(1);

export const RULE_PARAM_SCHEMAS = {
  // something of these classes is in the zone (intrusion, danger zone, stranger at night)
  presence: z.object({ subjects: z.array(cls).min(1), min: z.number().int().min(1).default(1) }).strict(),
  // the count of one class is outside [min, max] (missing animals, empty guard post, overcrowding)
  count_range: z
    .object({
      subject: cls,
      min: z.number().int().min(0).optional(),
      max: z.number().int().min(0).optional(),
      estimator: z.enum(["max", "median"]).default("max"),
      windowS: z.number().int().min(1).max(3600).default(60),
    })
    .strict()
    .refine((p) => p.min !== undefined || p.max !== undefined, { message: "give min, max, or both" }),
  // a subject lacks required attributes (worker without helmet or vest)
  attribute_missing: z
    .object({
      subject: cls,
      required: z.array(cls).min(1),
      mode: z.enum(["any", "all"]).default("any"),
      attrThreshold: z.number().min(0).max(1).default(0.5),
      minViolators: z.number().int().min(1).default(1),
    })
    .strict(),
  // class A is close to class B (person near cow at night)
  proximity: z.object({ a: cls, b: cls, maxDist: z.number().positive().default(1), minPairs: z.number().int().min(1).default(1) }).strict(),
  // a zone measure crosses a threshold, with a second threshold to switch back (no flapping)
  measure_threshold: z.object({ measure: cls, op: z.enum(["lt", "gt"]), on: z.number(), off: z.number() }).strict(),
  // a metric changed too much inside a time window (brick stock dropped)
  delta: z
    .object({
      metric: cls, // "measure.stock_count" | "count.cow"
      direction: z.enum(["down", "up"]),
      windowS: z.number().int().min(10).max(3600),
      minAbs: z.number().positive().optional(),
      minPct: z.number().min(0).max(1).optional(),
    })
    .strict()
    .refine((p) => p.minAbs !== undefined || p.minPct !== undefined, { message: "give minAbs, minPct, or both" }),
  // the metric is far from what is normal for this hour of the week
  anomaly: z
    .object({ metric: cls, direction: z.enum(["above", "below", "both"]).default("both"), zOn: z.number().positive().default(3), windowS: z.number().int().min(60).max(3600).default(900) })
    .strict(),
  // camera-level checks; bound to a camera, not a zone
  device_health: z
    .object({
      check: z.enum(["offline", "tamper"]),
      offlineS: z.number().int().min(30).default(90),
      darkBelow: z.number().min(0).max(1).default(0.06),
      blurBelow: z.number().min(0).max(1).default(0.05),
      sceneChangeAbove: z.number().min(0).max(1).default(0.6),
    })
    .strict(),
} as const;

export type RuleKindName = keyof typeof RULE_PARAM_SCHEMAS;

/** Template defaults first, then what the user sent. Throws 400 listing each wrong field. */
export function validateRuleParams(kind: string, defaults: object, given: object | undefined) {
  const schema = RULE_PARAM_SCHEMAS[kind as RuleKindName];
  if (!schema) throw new BadRequestException(`Unknown rule kind "${kind}"`);
  const result = schema.safeParse({ ...defaults, ...(given ?? {}) });
  if (!result.success)
    throw new BadRequestException({
      statusCode: 400,
      code: "invalid_rule_params",
      message: result.error.issues.map((issue) => `params.${issue.path.join(".") || "(root)"}: ${issue.message}`),
    });
  return result.data;
}

/** Schedule: null = always. Times are site local, "22:00" -> "06:00" wraps midnight. dow 0 = Monday. */
export const scheduleSchema = z
  .object({
    windows: z
      .array(z.object({ dow: z.array(z.number().int().min(0).max(6)).min(1), from: z.string().regex(/^\d{2}:\d{2}$/), to: z.string().regex(/^\d{2}:\d{2}$/) }))
      .min(1),
  })
  .strict();

export function validateSchedule(schedule: unknown) {
  if (schedule === null || schedule === undefined) return null;
  const result = scheduleSchema.safeParse(schedule);
  if (!result.success)
    throw new BadRequestException({ statusCode: 400, code: "invalid_schedule", message: result.error.issues.map((i) => `schedule.${i.path.join(".")}: ${i.message}`) });
  return result.data;
}
