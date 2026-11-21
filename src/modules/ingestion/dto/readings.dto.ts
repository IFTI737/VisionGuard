import { z } from "zod";

// The device ingestion contract (see src/common/contracts.ts).
// Deeply nested arrays are easier to read and check with zod than with decorators.
const unit = z.number().min(0).max(1);
const box = z.tuple([z.number().min(-0.05).max(1.05), z.number().min(-0.05).max(1.05), z.number().min(0).max(1.1), z.number().min(0).max(1.1)]);

const detection = z.object({
  cls: z.string().min(1),
  conf: unit,
  box, // [x, y, width, height], each 0..1 of the picture
  attrs: z.record(z.string(), unit).optional(), // { helmet: 0.93, vest: 0.12 }
  track: z.number().int().optional(),
});

const reading = z.object({
  cameraId: z.string().uuid(),
  seq: z.number().int().nonnegative(), // increases per camera; a repeated seq is dropped
  capturedAt: z.string().datetime({ offset: true }),
  model: z.object({ code: z.string(), version: z.string() }),
  frame: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
  detections: z.array(detection).max(200),
  measures: z.array(z.object({ zoneId: z.string().uuid(), key: z.string().min(1), value: z.number(), conf: unit.optional() })).optional(),
  frameStats: z.object({ brightness: unit, sharpness: unit, sceneChange: unit }).optional(),
});

export const readingsRequestSchema = z.object({ readings: z.array(reading).min(1).max(50) });
export type ReadingInput = z.infer<typeof reading>;

export const heartbeatSchema = z.object({
  swVersion: z.string().default("unknown"),
  uptimeS: z.number().nonnegative().default(0),
  cameras: z.array(z.object({ cameraId: z.string().uuid(), state: z.enum(["ok", "no_signal"]), fps: z.number().optional(), lastFrameAt: z.string().optional() })).default([]),
  sys: z.object({ cpu: z.number().optional(), mem: z.number().optional(), diskFreeGb: z.number().optional() }).optional(),
});
