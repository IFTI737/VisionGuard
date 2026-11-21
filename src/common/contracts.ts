/**
 * VisionGuard Digital Watcher - shared contracts (the same file is copied into visionguard-ui)
 * One source of truth for: the device ingestion API, JSONB column shapes,
 * and WebSocket events. Import these types in the API, the web app,
 * the camera client and the simulator.
 */

// ───────────────────────── Basics ─────────────────────────
export type Uuid = string;
export type IsoTime = string; // ISO 8601 with offset, e.g. 2026-11-13T22:54:05+06:00
export type Severity = 'low' | 'medium' | 'high' | 'critical';
/** Normalised box: top-left x, y, width, height, all 0..1 of the frame. */
export type Box = [x: number, y: number, w: number, h: number];
/** Normalised polygon, 3 to 32 points, 0..1 of the frame. */
export type Polygon = Array<[x: number, y: number]>;
export type ClassCode = string; // object_class.code: 'person', 'cow', 'sheep', 'brick_stack', ...

// ───────────────── 1. Device ingestion contract ─────────────────
// The backend does not know or care whether a device is a browser camera
// client, the simulator, an edge gateway or a cloud stream worker.
// Auth on every call:  Authorization: Device vgk_<prefix>_<secret>

export interface Detection {
  cls: ClassCode;
  conf: number; // 0..1
  box: Box;
  /** Attributes from a second-stage model, as probabilities 0..1. */
  attrs?: Record<string, number>; // { helmet: 0.93, vest: 0.12 }
  /** Stable id while the same object stays in view (optional tracker). */
  track?: number;
}

/** A value measured on a whole zone (region of interest), not on one box. */
export interface Measure {
  zoneId: Uuid;
  key: 'fill_ratio' | 'stock_count' | string;
  value: number;
  conf?: number;
}

/** Cheap frame statistics used for tamper (camera blinded) detection. */
export interface FrameStats {
  brightness: number; // mean luma 0..1
  sharpness: number; // variance of Laplacian, normalised 0..1
  sceneChange: number; // 0..1 difference from the reference frame
}

export interface Reading {
  cameraId: Uuid;
  /** Increases by 1 per reading per camera. Used to drop duplicates. */
  seq: number;
  capturedAt: IsoTime;
  model: { code: string; version: string };
  frame: { w: number; h: number };
  detections: Detection[]; // max 200
  measures?: Measure[];
  frameStats?: FrameStats;
}

/** POST /v1/device/readings  (or WS event "reading") */
export interface ReadingsRequest {
  readings: Reading[]; // max 50 per call
}
export interface ReadingsResponse {
  accepted: number;
  rejected: Array<{ seq: number; cameraId: Uuid; reason: 'duplicate' | 'too_old' | 'unknown_camera' | 'invalid' }>;
  configVersion: number; // refetch config when this changes
  serverTime: IsoTime;
}

/** POST /v1/device/heartbeat  every 30 s */
export interface HeartbeatRequest {
  swVersion: string;
  uptimeS: number;
  cameras: Array<{ cameraId: Uuid; state: 'ok' | 'no_signal'; fps?: number; lastFrameAt?: IsoTime }>;
  sys?: { cpu?: number; mem?: number; diskFreeGb?: number };
}
export interface HeartbeatResponse {
  serverTime: IsoTime;
  configVersion: number;
  /** Commands for devices that have no WebSocket (simulator, Postman). */
  commands: DeviceCommand[];
}
export type DeviceCommand =
  | { type: 'config.changed' }
  | { type: 'snapshot.request'; cameraId: Uuid; requestId: Uuid }
  | { type: 'clip.upload'; cameraId: Uuid; from: IsoTime; to: IsoTime } // edge-stored segments
  | { type: 'live.request'; cameraId: Uuid; sessionId: Uuid; iceServers: IceServer[] }
  | { type: 'live.stop'; sessionId: Uuid };
export interface IceServer { urls: string[]; username?: string; credential?: string }

/** GET /v1/device/config  (ETag = configVersion) */
export interface DeviceConfig {
  configVersion: number;
  heartbeatS: number; // 30
  cameras: Array<{
    cameraId: Uuid;
    recording: { mode: 'off' | 'continuous' | 'incident_only'; segmentS: number }; // 60
    snapshotEveryS: number; // periodic snapshot interval, 0 = off
    models: Array<{
      code: string;
      version: string;
      task: 'detect' | 'classify' | 'pose' | 'segment' | 'count';
      stage: 1 | 2;
      triggerClass?: ClassCode; // stage 2 runs on crops of this class
      artifactUrl: string;
      inputSize: number;
      activeWhen: 'always' | 'day' | 'night' | 'lowlight';
      frameIntervalMs: number;
      /** Send only detections at or above these thresholds. */
      conf: Record<ClassCode, number>;
    }>;
    /** Regions the device must measure itself (shelf fill, stock count). */
    rois: Array<{ zoneId: Uuid; polygon: Polygon; measure: string; everyS: number }>;
    /** Zones where a second-stage model is worth running (saves compute). */
    stage2Zones: Array<{ zoneId: Uuid; polygon: Polygon; attrs: string[] }>;
  }>;
}

// ───────────────── 2. JSONB: schedules and preferences ─────────────────
/** rule.schedule / rule_template.default_schedule. null = always active. */
export interface Schedule {
  /** Active inside any window. Times are site local. "22:00"->"06:00" wraps midnight. */
  windows: Array<{ dow: Array<0 | 1 | 2 | 3 | 4 | 5 | 6>; from: string; to: string }>; // 0 = Monday
}

/** site_members.notify_prefs */
export interface NotifyPrefs {
  channels?: Partial<Record<'webpush' | 'telegram' | 'call', { enabled: boolean; minSeverity?: Severity }>>;
  /** During quiet hours only 'critical' alerts are delivered. */
  quiet?: { from: string; to: string };
}

// ───────────────── 3. JSONB: rules.params per template kind ─────────────────
export type RuleKind =
  | 'presence' | 'count_range' | 'attribute_missing' | 'proximity'
  | 'measure_threshold' | 'delta' | 'anomaly' | 'device_health';

/** Something of these classes is in the zone (intrusion, danger zone, stranger at night). */
export interface PresenceParams { subjects: ClassCode[]; min: number /* default 1 */ }

/** Count of one class is outside [min, max] (missing animals, empty guard post, overcrowding). */
export interface CountRangeParams {
  subject: ClassCode;
  min?: number;
  max?: number;
  /** 'max' = highest count in the window (hides occlusion, used with min).
   *  'median' = middle count in the window (hides flicker, used with max). */
  estimator?: 'max' | 'median';
  windowS?: number; // default 60 for max, 10 for median
}

/** A subject lacks required attributes (person without helmet or vest). */
export interface AttributeMissingParams {
  subject: ClassCode;
  required: string[]; // ['helmet', 'vest']
  mode: 'any' | 'all'; // violation if ANY required attr is missing, or only if ALL are
  attrThreshold?: number; // attr probability below this = missing, default 0.5
  minViolators: number; // default 1
}

/** Class A is close to class B (person near cow at night). */
export interface ProximityParams {
  a: ClassCode;
  b: ClassCode;
  /** Distance between foot points divided by the mean box height. Default 1.0. */
  maxDist: number;
  minPairs: number; // default 1
}

/** A zone measure crosses a threshold, with hysteresis (shelf emptier than 40 %). */
export interface MeasureThresholdParams {
  measure: string; // 'fill_ratio'
  op: 'lt' | 'gt';
  on: number; // violation starts when value crosses this
  off: number; // violation ends when value crosses back over this
}

/** A metric changed too much inside a window (brick stock dropped at night). */
export interface DeltaParams {
  metric: string; // 'measure.stock_count' | 'count.cow'
  direction: 'down' | 'up';
  windowS: number;
  minAbs?: number;
  minPct?: number; // 0..1 of the value at the window start
}

/** The metric is far from what is normal for this hour of the week. */
export interface AnomalyParams {
  metric: string; // 'count.person'
  direction: 'above' | 'below' | 'both';
  zOn?: number; // default 3.0 (divided by the sensitivity multiplier)
  windowS?: number; // averaging window, default 900
}

/** Camera-level checks. Bound to rule.camera_id, not to a zone. */
export interface DeviceHealthParams {
  check: 'offline' | 'tamper';
  offlineS?: number; // default 90
  darkBelow?: number; // brightness, default 0.06
  blurBelow?: number; // sharpness, default 0.05
  sceneChangeAbove?: number; // default 0.6
}

export type RuleParams =
  | ({ kind: 'presence' } & PresenceParams)
  | ({ kind: 'count_range' } & CountRangeParams)
  | ({ kind: 'attribute_missing' } & AttributeMissingParams)
  | ({ kind: 'proximity' } & ProximityParams)
  | ({ kind: 'measure_threshold' } & MeasureThresholdParams)
  | ({ kind: 'delta' } & DeltaParams)
  | ({ kind: 'anomaly' } & AnomalyParams)
  | ({ kind: 'device_health' } & DeviceHealthParams);

// ───────────────── 4. JSONB: incidents.expected / incidents.observed ─────────────────
/** A frozen copy of the rule at the moment the incident fired. */
export interface IncidentExpected {
  ruleVersion: number;
  params: RuleParams;
  schedule: Schedule | null;
  sustainS: number;
  /** One readable line, already translated, e.g. "At least 10 cows in Shed 1". */
  text: { bn: string; en: string };
}

export interface IncidentObserved {
  /** The number compared with the rule: a count, a ratio, a z-score, pairs... */
  value: number;
  peak: number; // worst value seen while the incident was active
  unit: 'count' | 'ratio' | 'z' | 'pairs' | 'seconds';
  /** Smoothed counts per class in the zone at fire time. */
  counts?: Record<ClassCode, number>;
  /** Up to 10 boxes that caused the violation, for drawing on the snapshot. */
  boxes?: Array<Pick<Detection, 'cls' | 'conf' | 'box' | 'attrs'>>;
  avgConf?: number;
  /** For anomaly rules. */
  baseline?: { median: number; mad: number; z: number };
  firstViolatedAt: IsoTime;
  violationRatio: number; // share of samples in the pending window that violated
  durationS: number; // updated while active
  /** Inputs of the risk score, kept so the score can be explained. */
  risk: { base: number; time: number; magnitude: number; duration: number; anomaly: number;
          confFactor: number; fpFactor: number; sensitivity: number };
}

// ───────────────── 5. Redis state (not stored in PostgreSQL) ─────────────────
export type RuleState = 'ok' | 'pending' | 'firing' | 'cooldown';
/** Redis hash  rs:{ruleId} */
export interface RuleRuntimeState {
  state: RuleState;
  firstViolatedAt?: number; // epoch ms, device time
  lastViolatedAt?: number;
  samples: number; // samples seen since pending started
  violating: number; // samples that violated since pending started
  incidentId?: Uuid;
  cooldownUntil?: number;
  peak?: number;
}

// ───────────────── 6. WebSocket events (Socket.IO) ─────────────────
// Namespace /app  (browser dashboard; access token in the handshake: io(url, { auth: { token } })).
// The server emits "auth.expired" and disconnects when the token expires; the client
// refreshes it and reconnects.  Rooms:
//   site:{siteId}            events every member of the site may see
//   area:{areaId}            events limited by area scope
//   user:{userId}            personal events
//   conv:{conversationId}    chat
export interface ServerToApp {
  'auth.expired': { reason: 'expired' | 'logged_out' | 'disabled' };
  'zone.state': { zoneId: Uuid; at: IsoTime; counts: Record<ClassCode, number>; measures: Record<string, number>;
                  rules: Array<{ ruleId: Uuid; state: RuleState }> };
  'camera.status': { cameraId: Uuid; status: string; at: IsoTime };
  'incident.created': { id: Uuid; zoneId?: Uuid; cameraId?: Uuid; title: string; severity: Severity; riskScore: number; startedAt: IsoTime };
  'incident.updated': { id: Uuid; status: string; conditionActive: boolean; recurrence: number };
  'alert.created': { id: Uuid; title: string; severity: Severity; source: 'system' | 'manual' | 'test' };
  'alert.updated': { id: Uuid; status: string; currentStep: number; acknowledgedBy?: Uuid };
  'alert.recipient': { alertId: Uuid; memberId: Uuid; status: string };
  'message.created': { conversationId: Uuid; id: number; senderMemberId: Uuid; body: string; createdAt: IsoTime };
  'conversation.read': { conversationId: Uuid; memberId: Uuid; lastReadId: number };
  'live.offer': { sessionId: Uuid; sdp: string };
  'live.ice': { sessionId: Uuid; candidate: unknown };
  'live.ended': { sessionId: Uuid; reason: string };
  'export.ready': { id: Uuid };
}
export interface AppToServer {
  'site.subscribe': { siteId: Uuid };
  'conversation.join': { conversationId: Uuid };
  'conversation.typing': { conversationId: Uuid };
  'live.start': { cameraId: Uuid }; // ack: { sessionId, iceServers } | { error }
  'live.answer': { sessionId: Uuid; sdp: string };
  'live.ice': { sessionId: Uuid; candidate: unknown };
  'live.ping': { sessionId: Uuid }; // every 15 s
  'live.stop': { sessionId: Uuid };
}

// Namespace /device  (device key in the handshake). Room device:{deviceId}
export interface DeviceToServer {
  reading: Reading;
  heartbeat: HeartbeatRequest;
  'live.offer': { sessionId: Uuid; sdp: string };
  'live.ice': { sessionId: Uuid; candidate: unknown };
}
export interface ServerToDevice {
  command: DeviceCommand;
  'live.answer': { sessionId: Uuid; sdp: string };
  'live.ice': { sessionId: Uuid; candidate: unknown };
}

// ───────────────── 7. Incident clip manifest ─────────────────
/** GET /v1/sites/:siteId/incidents/:id/clip */
export interface ClipManifest {
  from: IsoTime;
  to: IsoTime;
  complete: boolean; // false while later segments are still uploading
  segments: Array<{
    url: string; // short-lived signed URL, supports HTTP Range
    container: 'webm' | 'mp4' | 'fmp4';
    startedAt: IsoTime;
    durationMs: number;
    /** Where playback starts and stops inside this segment. */
    playFromMs: number;
    playToMs: number;
  }>;
  hlsUrl?: string; // present only when every segment is fMP4
}
