import { dataSourceOptions } from "@/config/database.config";
import * as argon2 from "argon2";
import { DataSource } from "typeorm";
import { PostgresConnectionOptions } from "typeorm/driver/postgres/PostgresConnectionOptions";

/**
 * Fills the catalog: what VisionGuard can detect and sell.
 *   pnpm seed
 * Safe to run again at any time: every INSERT is an upsert (ON CONFLICT ... DO UPDATE).
 * A new pack or rule template is a change in this file, not a migration.
 */

const NIGHT = { windows: [{ dow: [0, 1, 2, 3, 4, 5, 6], from: "22:00", to: "06:00" }] };

const OBJECT_CLASSES = [
  // code, kind, parent, English, Bangla
  ["person", "object", null, "Person", "মানুষ"],
  ["vehicle", "object", null, "Vehicle", "যানবাহন"],
  ["animal", "object", null, "Animal", "প্রাণী"],
  ["cow", "object", "animal", "Cow", "গরু"],
  ["sheep", "object", "animal", "Sheep", "ভেড়া"],
  ["goat", "object", "animal", "Goat", "ছাগল"],
  ["brick_stack", "object", null, "Brick stack", "ইটের স্তূপ"],
  ["helmet", "attribute", null, "Helmet", "হেলমেট"],
  ["vest", "attribute", null, "Safety vest", "সেফটি ভেস্ট"],
  ["fill_ratio", "measure", null, "Shelf fill ratio", "তাক পূর্ণতার হার"],
  ["stock_count", "measure", null, "Stock count", "মজুদ সংখ্যা"],
] as const;

const MODELS = [
  // code, version, task, runtime, stage, trigger, output, classes
  { code: "core-detect", version: "1.0", task: "detect", runtime: "onnx_web", stage: 1, trigger: null, output: "boxes", classes: ["person", "vehicle"] },
  { code: "farm-detect", version: "1.0", task: "detect", runtime: "onnx_web", stage: 1, trigger: null, output: "boxes", classes: ["person", "cow", "sheep", "goat"] },
  { code: "ppe-classify", version: "1.0", task: "classify", runtime: "onnx_web", stage: 2, trigger: "person", output: "attrs", classes: ["helmet", "vest"] },
  { code: "brick-count", version: "1.0", task: "count", runtime: "onnx", stage: 1, trigger: null, output: "measure", classes: ["stock_count", "brick_stack"] },
  { code: "shelf-fill", version: "1.0", task: "segment", runtime: "onnx", stage: 1, trigger: null, output: "measure", classes: ["fill_ratio"] },
];

const PACKS = [
  { code: "core", name: "Core Security", description: "Intrusion, night strangers, camera health. Part of every plan.", isDefault: true, price: 0, models: ["core-detect"] },
  { code: "farm", name: "Farm", description: "Count cows, sheep and goats. Know when one is missing.", isDefault: false, price: 30000, models: ["farm-detect"] },
  { code: "construction", name: "Construction", description: "Helmet and vest checks, danger zones, brick stock.", isDefault: false, price: 50000, models: ["core-detect", "ppe-classify", "brick-count"] },
  { code: "shop", name: "Shop", description: "Empty shelves and people after closing time.", isDefault: false, price: 30000, models: ["core-detect", "shelf-fill"] },
  { code: "workplace", name: "Workplace", description: "Unusual crowding compared with a normal week.", isDefault: false, price: 30000, models: ["core-detect"] },
];

interface Template {
  pack: string; code: string; name: string; description: string; kind: string; params: object;
  severity: string; schedule?: object | null; sustain: number; clear: number; cooldown: number;
  zoneKinds: string[]; classes: string[]; auto?: boolean; en: string; bn: string;
}
const TEMPLATES: Template[] = [
  { pack: "core", code: "intrusion", name: "Person in a restricted zone", description: "Someone is inside a zone where nobody should be.", kind: "presence", params: { subjects: ["person"], min: 1 }, severity: "high", sustain: 5, clear: 30, cooldown: 300, zoneKinds: ["restricted", "general"], classes: ["person"], auto: true, en: "Person in {zone}", bn: "{zone}-এ মানুষ দেখা গেছে" },
  { pack: "core", code: "night_stranger", name: "Person at night", description: "Someone is in the zone between 22:00 and 06:00.", kind: "presence", params: { subjects: ["person"], min: 1 }, severity: "high", schedule: NIGHT, sustain: 5, clear: 30, cooldown: 300, zoneKinds: ["general", "entrance", "shed", "stock"], classes: ["person"], en: "Person at night in {zone}", bn: "রাতে {zone}-এ মানুষ" },
  { pack: "core", code: "guard_post_empty", name: "Guard post empty", description: "Nobody is at the guard post.", kind: "count_range", params: { subject: "person", min: 1, estimator: "max", windowS: 60 }, severity: "medium", sustain: 120, clear: 30, cooldown: 600, zoneKinds: ["guard_post"], classes: ["person"], en: "Guard post {zone} is empty", bn: "গার্ড পোস্ট {zone} খালি" },
  { pack: "core", code: "overcrowding", name: "Too many people", description: "More people than the limit are in the zone.", kind: "count_range", params: { subject: "person", max: 10, estimator: "median", windowS: 10 }, severity: "medium", sustain: 30, clear: 30, cooldown: 600, zoneKinds: ["general", "entrance", "work"], classes: ["person"], en: "Too many people in {zone}", bn: "{zone}-এ অতিরিক্ত মানুষ" },
  { pack: "core", code: "camera_offline", name: "Camera offline", description: "The camera stopped sending data.", kind: "device_health", params: { check: "offline", offlineS: 90 }, severity: "medium", sustain: 0, clear: 0, cooldown: 300, zoneKinds: [], classes: [], auto: true, en: "Camera {camera} is offline", bn: "ক্যামেরা {camera} অফলাইন" },
  { pack: "core", code: "camera_tamper", name: "Camera covered or moved", description: "The picture went dark, blurred, or the scene changed suddenly.", kind: "device_health", params: { check: "tamper", darkBelow: 0.06, blurBelow: 0.05, sceneChangeAbove: 0.6 }, severity: "high", sustain: 10, clear: 30, cooldown: 300, zoneKinds: [], classes: [], auto: true, en: "Camera {camera} may be covered or moved", bn: "ক্যামেরা {camera} ঢেকে দেওয়া বা সরানো হয়েছে" },
  { pack: "farm", code: "animal_missing", name: "Animal missing", description: "Fewer animals than expected in the shed.", kind: "count_range", params: { subject: "cow", min: 10, estimator: "max", windowS: 60 }, severity: "high", sustain: 600, clear: 60, cooldown: 900, zoneKinds: ["shed"], classes: ["cow"], en: "Fewer {subject} than expected in {zone}", bn: "{zone}-এ প্রত্যাশার চেয়ে কম {subject}" },
  { pack: "farm", code: "person_near_animals_night", name: "Person near animals at night", description: "A person is close to the animals between 22:00 and 06:00.", kind: "proximity", params: { a: "person", b: "cow", maxDist: 1.0, minPairs: 1 }, severity: "critical", schedule: NIGHT, sustain: 5, clear: 30, cooldown: 300, zoneKinds: ["shed"], classes: ["person", "cow"], en: "Person near animals at night in {zone}", bn: "রাতে {zone}-এ পশুর কাছে মানুষ" },
  { pack: "farm", code: "animal_count_anomaly", name: "Unusual animal count", description: "The count is far from what is normal for this hour of the week.", kind: "anomaly", params: { metric: "count.cow", direction: "below", zOn: 3, windowS: 900 }, severity: "medium", sustain: 300, clear: 60, cooldown: 1800, zoneKinds: ["shed"], classes: ["cow"], en: "Unusual animal count in {zone}", bn: "{zone}-এ অস্বাভাবিক পশু সংখ্যা" },
  { pack: "construction", code: "ppe_missing", name: "Helmet or vest missing", description: "A worker is in the zone without a helmet or a vest.", kind: "attribute_missing", params: { subject: "person", required: ["helmet", "vest"], mode: "any", attrThreshold: 0.5, minViolators: 1 }, severity: "high", sustain: 10, clear: 30, cooldown: 600, zoneKinds: ["work"], classes: ["person", "helmet", "vest"], en: "Worker without safety gear in {zone}", bn: "{zone}-এ নিরাপত্তা সরঞ্জাম ছাড়া কর্মী" },
  { pack: "construction", code: "danger_zone", name: "Person in a danger zone", description: "Someone entered a zone marked dangerous.", kind: "presence", params: { subjects: ["person"], min: 1 }, severity: "critical", sustain: 3, clear: 20, cooldown: 300, zoneKinds: ["restricted"], classes: ["person"], en: "Person in danger zone {zone}", bn: "বিপজ্জনক জোন {zone}-এ মানুষ" },
  { pack: "construction", code: "brick_stock_drop", name: "Brick stock dropped", description: "The brick count fell quickly, which may mean theft.", kind: "delta", params: { metric: "measure.stock_count", direction: "down", windowS: 3600, minAbs: 50 }, severity: "high", sustain: 0, clear: 60, cooldown: 1800, zoneKinds: ["stock"], classes: ["stock_count"], en: "Brick stock dropped in {zone}", bn: "{zone}-এ ইটের মজুদ কমে গেছে" },
  { pack: "shop", code: "shelf_empty", name: "Shelf nearly empty", description: "The shelf is emptier than the limit.", kind: "measure_threshold", params: { measure: "fill_ratio", op: "lt", on: 0.4, off: 0.5 }, severity: "low", sustain: 120, clear: 60, cooldown: 1800, zoneKinds: ["shelf"], classes: ["fill_ratio"], en: "Shelf {zone} is nearly empty", bn: "তাক {zone} প্রায় খালি" },
  { pack: "shop", code: "after_hours_person", name: "Person after closing", description: "Someone is in the shop after closing time.", kind: "presence", params: { subjects: ["person"], min: 1 }, severity: "high", schedule: NIGHT, sustain: 5, clear: 30, cooldown: 300, zoneKinds: ["general", "entrance", "shelf"], classes: ["person"], en: "Person in {zone} after closing", bn: "বন্ধের পর {zone}-এ মানুষ" },
  { pack: "workplace", code: "occupancy_anomaly", name: "Unusual crowd", description: "Far more people than normal for this hour of the week.", kind: "anomaly", params: { metric: "count.person", direction: "above", zOn: 3, windowS: 900 }, severity: "medium", sustain: 300, clear: 60, cooldown: 1800, zoneKinds: ["general", "work", "entrance"], classes: ["person"], en: "Unusual crowd in {zone}", bn: "{zone}-এ অস্বাভাবিক ভিড়" },
];

const PLANS = [
  // code, name, price (poisha), cameras, members, pack slots, recording days
  ["basic", "Basic", 49900, 2, 3, 0, 3],
  ["standard", "Standard", 149900, 8, 10, 1, 7],
  ["pro", "Pro", 399900, 32, null, 3, 30],
] as const;

// Staff accounts for the admin panel. Change the passwords with env variables before going live.
const STAFF = [
  ["VisionGuard Admin", "admin@visionguard.local", process.env.SEED_ADMIN_PASSWORD || "Admin@12345", "admin"],
  ["VisionGuard Support", "support@visionguard.local", process.env.SEED_SUPPORT_PASSWORD || "Support@12345", "support"],
] as const;

const seed = async () => {
  const ds = new DataSource({ ...dataSourceOptions } as PostgresConnectionOptions);
  try {
    await ds.initialize();
    await ds.transaction(async (m) => {
      for (const [code, kind, parent, en, bn] of OBJECT_CLASSES)
        await m.query(
          `INSERT INTO object_classes (code, kind, parent_code, name_en, name_bn) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (code) DO UPDATE SET kind = EXCLUDED.kind, parent_code = EXCLUDED.parent_code, name_en = EXCLUDED.name_en, name_bn = EXCLUDED.name_bn`,
          [code, kind, parent, en, bn],
        );

      const modelIds: Record<string, string> = {};
      for (const model of MODELS) {
        const [row] = await m.query(
          `INSERT INTO ai_models (code, version, task, runtime, stage, trigger_class_code, output_kind, artifact_url)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (code, version) DO UPDATE SET task = EXCLUDED.task, runtime = EXCLUDED.runtime, stage = EXCLUDED.stage,
             trigger_class_code = EXCLUDED.trigger_class_code, output_kind = EXCLUDED.output_kind
           RETURNING id`,
          [model.code, model.version, model.task, model.runtime, model.stage, model.trigger, model.output, `/models/${model.code}-${model.version}.onnx`],
        );
        modelIds[model.code] = row.id;
        for (let index = 0; index < model.classes.length; index++)
          await m.query(
            `INSERT INTO model_classes (model_id, class_code, class_index) VALUES ($1,$2,$3)
             ON CONFLICT (model_id, class_code) DO UPDATE SET class_index = EXCLUDED.class_index`,
            [row.id, model.classes[index], index],
          );
      }

      const packIds: Record<string, string> = {};
      for (const pack of PACKS) {
        const [row] = await m.query(
          `INSERT INTO packs (code, name, description, is_default, addon_price_minor) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
             is_default = EXCLUDED.is_default, addon_price_minor = EXCLUDED.addon_price_minor
           RETURNING id`,
          [pack.code, pack.name, pack.description, pack.isDefault, pack.price],
        );
        packIds[pack.code] = row.id;
        for (const modelCode of pack.models)
          await m.query(`INSERT INTO pack_models (pack_id, model_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [row.id, modelIds[modelCode]]);
      }

      for (const t of TEMPLATES)
        await m.query(
          `INSERT INTO rule_templates (pack_id, code, name, description, kind, default_params, param_schema, default_severity,
             default_schedule, default_sustain_s, default_clear_s, default_cooldown_s, zone_kinds, required_classes, auto_provision, i18n)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
           ON CONFLICT (pack_id, code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, kind = EXCLUDED.kind,
             default_params = EXCLUDED.default_params, param_schema = EXCLUDED.param_schema, default_severity = EXCLUDED.default_severity,
             default_schedule = EXCLUDED.default_schedule, default_sustain_s = EXCLUDED.default_sustain_s,
             default_clear_s = EXCLUDED.default_clear_s, default_cooldown_s = EXCLUDED.default_cooldown_s,
             zone_kinds = EXCLUDED.zone_kinds, required_classes = EXCLUDED.required_classes,
             auto_provision = EXCLUDED.auto_provision, i18n = EXCLUDED.i18n`,
          [
            packIds[t.pack], t.code, t.name, t.description, t.kind, JSON.stringify(t.params),
            JSON.stringify({ fields: Object.keys(t.params) }), // which params the rule form shows; values are checked with zod
            t.severity, t.schedule ? JSON.stringify(t.schedule) : null, t.sustain, t.clear, t.cooldown,
            t.zoneKinds, t.classes, !!t.auto, JSON.stringify({ en: { title: t.en }, bn: { title: t.bn } }),
          ],
        );

      for (const [code, name, price, cameras, members, slots, days] of PLANS)
        await m.query(
          `INSERT INTO plans (code, name, price_minor, max_cameras, max_members, pack_slots, recording_days) VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, price_minor = EXCLUDED.price_minor, max_cameras = EXCLUDED.max_cameras,
             max_members = EXCLUDED.max_members, pack_slots = EXCLUDED.pack_slots, recording_days = EXCLUDED.recording_days`,
          [code, name, price, cameras, members, slots, days],
        );

      for (const [name, email, password, role] of STAFF)
        await m.query(
          `INSERT INTO users (name, email, password_hash, platform_role, email_verified_at, locale) VALUES ($1,$2,$3,$4, now(), 'en')
           ON CONFLICT (email) DO UPDATE SET platform_role = EXCLUDED.platform_role`, // an existing password is kept
          [name, email, await argon2.hash(password), role],
        );
    });
    console.log(`seed done: ${OBJECT_CLASSES.length} classes, ${MODELS.length} models, ${PACKS.length} packs, ${TEMPLATES.length} rule templates, ${PLANS.length} plans, ${STAFF.length} staff users`);
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    if (ds.isInitialized) await ds.destroy();
  }
};

seed();
