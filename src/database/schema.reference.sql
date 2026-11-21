-- =====================================================================
-- VisionGuard Digital Watcher - REFERENCE schema v3 (PostgreSQL 15+, tested on 16)
-- 49 tables. Runs top to bottom on an empty database.
--
-- This file is NOT executed by the app. It is the reference the hand-written
-- TypeORM migrations are copied from (one section = one migration file, in this
-- order). CI proves the migrations and entities match it.
--
-- Conventions
--   * Table names: plural snake_case (users, sites, site_members). Exceptions:
--     media, detection_feedback (uncountable).
--   * Every constraint and index has a readable name:
--       pk_<table>  fk_<table>_<column>  uq_<table>_<what>  chk_<table>_<what>
--       idx_<table>_<what>
--   * Primary keys: uuid DEFAULT gen_random_uuid() (no uuid-ossp needed).
--   * Time: timestamptz everywhere. Money: integer minor units (poisha).
--   * Enumerations: text + named CHECK (never PostgreSQL ENUM types).
--   * Tenant = site. Every tenant table carries site_id. Child tables use
--     composite foreign keys (site_id, parent_id) -> parent(site_id, id).
--   * ON DELETE SET NULL (column) needs PostgreSQL 15+.
--   * Soft delete (deleted_at) only on sites, cameras, zones, rules.
--   * Live zone state and rule state live in Redis, not in PostgreSQL.
-- =====================================================================

-- =====================================================================
-- Migration 1790000000000-extensions   owner: Iftekhar   module: setup
-- Tables: (none)
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- name/subject search; gen_random_uuid() is built in (PG 13+)



-- =====================================================================
-- Migration 1790000001000-identity   owner: Mahir   module: auth, users
-- Tables: users, refresh_tokens, auth_codes, notification_endpoints
-- =====================================================================

CREATE TABLE users (
  id                 uuid CONSTRAINT pk_users PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  email              text NOT NULL,                      -- stored lower-case by the service
  email_verified_at  timestamptz,
  phone_number       text,                               -- E.164, +8801...
  phone_verified_at  timestamptz,
  password_hash      text NOT NULL,                      -- argon2id; entity: select: false
  two_factor_enabled boolean NOT NULL DEFAULT false,     -- email code at login (auth_codes 'login_2fa')
  token_version      integer NOT NULL DEFAULT 0,         -- +1 = every access token of this user dies
  platform_role      text NOT NULL DEFAULT 'customer'
                     CONSTRAINT chk_users_platform_role CHECK (platform_role IN ('customer','support','admin')),
  status             text NOT NULL DEFAULT 'active' CONSTRAINT chk_users_status CHECK (status IN ('active','disabled')),
  locale             text NOT NULL DEFAULT 'bn' CONSTRAINT chk_users_locale CHECK (locale IN ('bn','en')),
  last_login_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_users_email_lower CHECK (email = lower(email))
);
CREATE UNIQUE INDEX uq_users_email ON users (email);
CREATE UNIQUE INDEX uq_users_phone_number ON users (phone_number) WHERE phone_number IS NOT NULL;
CREATE INDEX idx_users_staff ON users (platform_role) WHERE platform_role <> 'customer';
CREATE INDEX idx_users_name_trgm ON users USING gin (name gin_trgm_ops);

-- One row per refresh token (= one login on one device). id = the token's jti.
-- Rotation: every refresh revokes the row and creates a new one in the same family.
-- A revoked token used again = theft -> the whole family is revoked.
CREATE TABLE refresh_tokens (
  id            uuid CONSTRAINT pk_refresh_tokens PRIMARY KEY,
  user_id       uuid NOT NULL CONSTRAINT fk_refresh_tokens_user_id REFERENCES users(id) ON DELETE CASCADE,
  family_id     uuid NOT NULL,
  token_hash    bytea NOT NULL,                          -- sha256 of the signed refresh JWT
  replaced_by   uuid CONSTRAINT fk_refresh_tokens_replaced_by REFERENCES refresh_tokens(id) ON DELETE SET NULL,
  user_agent    text,
  ip            inet,
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  revoke_reason text CONSTRAINT chk_refresh_tokens_revoke_reason
                CHECK (revoke_reason IN ('logout','rotated','reuse_detected','password_changed','admin','logout_all')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  CONSTRAINT chk_refresh_tokens_revoked CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
);
CREATE INDEX idx_refresh_tokens_user_active ON refresh_tokens (user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_refresh_tokens_family ON refresh_tokens (family_id);
CREATE INDEX idx_refresh_tokens_expiry ON refresh_tokens (expires_at);

-- Short one-time codes: email verification, phone verification, password reset,
-- and the second step of login when two-factor is on. Only the hash is stored.
CREATE TABLE auth_codes (
  id           uuid CONSTRAINT pk_auth_codes PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL CONSTRAINT fk_auth_codes_user_id REFERENCES users(id) ON DELETE CASCADE,
  purpose      text NOT NULL CONSTRAINT chk_auth_codes_purpose
               CHECK (purpose IN ('email_verify','phone_verify','password_reset','login_2fa')),
  channel      text NOT NULL CONSTRAINT chk_auth_codes_channel CHECK (channel IN ('email','sms')),
  target       text NOT NULL,                            -- the email or phone the code was sent to
  code_hash    bytea NOT NULL,                           -- sha256(code + id)
  attempts     smallint NOT NULL DEFAULT 0,
  max_attempts smallint NOT NULL DEFAULT 5,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
-- at most one usable code per user and purpose; the service consumes the old one first
CREATE UNIQUE INDEX uq_auth_codes_active ON auth_codes (user_id, purpose) WHERE consumed_at IS NULL;

-- Where a user can be reached outside the app (replaces telegram_link
-- and push_subscription).
CREATE TABLE notification_endpoints (
  id              uuid CONSTRAINT pk_notification_endpoints PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL CONSTRAINT fk_notification_endpoints_user_id REFERENCES users(id) ON DELETE CASCADE,
  kind            text NOT NULL CONSTRAINT chk_notification_endpoints_kind CHECK (kind IN ('telegram','webpush')),
  address         text NOT NULL,          -- telegram chat_id | push endpoint URL
  keys            jsonb,                  -- webpush: {"p256dh": "...", "auth": "..."}
  label           text,                   -- e.g. "Chrome on Android"
  verified_at     timestamptz,
  last_success_at timestamptz,
  fail_count      smallint NOT NULL DEFAULT 0,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_notification_endpoints_kind_address UNIQUE (kind, address),
  CONSTRAINT chk_notification_endpoints_webpush_keys CHECK (kind <> 'webpush' OR keys IS NOT NULL)
);
CREATE INDEX idx_notification_endpoints_user ON notification_endpoints (user_id) WHERE revoked_at IS NULL;



-- =====================================================================
-- Migration 1790000002000-tenancy   owner: Mahir   module: sites, members, audit
-- Tables: sites, site_members, areas, member_area_scopes, audit_logs
-- =====================================================================

CREATE TABLE sites (
  id                  uuid CONSTRAINT pk_sites PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  kind                text NOT NULL CONSTRAINT chk_sites_kind CHECK (kind IN ('home','farm','construction','shop','workplace','other')),
  timezone            text NOT NULL DEFAULT 'Asia/Dhaka',
  address             text,
  sensitivity         smallint NOT NULL DEFAULT 2 CONSTRAINT chk_sites_sensitivity CHECK (sensitivity BETWEEN 1 AND 3),
  mode                text NOT NULL DEFAULT 'armed' CONSTRAINT chk_sites_mode CHECK (mode IN ('armed','paused')),
  paused_until        timestamptz,
  digest_time         time NOT NULL DEFAULT '07:00',     -- daily summary, site local time
  share_training_data boolean NOT NULL DEFAULT false,    -- consent for the feedback loop
  status              text NOT NULL DEFAULT 'active' CONSTRAINT chk_sites_status CHECK (status IN ('active','suspended','deleted')),
  created_by          uuid CONSTRAINT fk_sites_created_by REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  CONSTRAINT chk_sites_paused_until CHECK ((mode = 'paused') = (paused_until IS NOT NULL))
);
CREATE INDEX idx_sites_status ON sites (status) WHERE status <> 'active';
CREATE INDEX idx_sites_name_trgm ON sites USING gin (name gin_trgm_ops);

-- One row per person per site. Ownership lives ONLY here (no site.owner_id).
-- A person without a login (old alert_contact) is a row with user_id NULL
-- and role 'contact'. Permissions and notification settings are columns.
CREATE TABLE site_members (
  id                uuid CONSTRAINT pk_site_members PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           uuid NOT NULL CONSTRAINT fk_site_members_site_id REFERENCES sites(id) ON DELETE CASCADE,
  user_id           uuid CONSTRAINT fk_site_members_user_id REFERENCES users(id) ON DELETE CASCADE,
  role              text NOT NULL CONSTRAINT chk_site_members_role CHECK (role IN ('owner','manager','guard','viewer','contact')),
  status            text NOT NULL DEFAULT 'active' CONSTRAINT chk_site_members_status CHECK (status IN ('invited','active','removed')),
  display_name      text NOT NULL,
  phone             text,                               -- E.164; required when there is no user
  permissions       text[] NOT NULL DEFAULT '{}',       -- extra grants on top of the role preset
  all_areas         boolean NOT NULL DEFAULT true,      -- false => member_area_scope rows apply
  call_priority     smallint CONSTRAINT chk_site_members_call_priority CHECK (call_priority > 0), -- position in the call list; NULL = never called
  notify_prefs      jsonb NOT NULL DEFAULT '{}',        -- see contracts.ts NotifyPrefs
  invited_by        uuid CONSTRAINT fk_site_members_invited_by REFERENCES site_members(id) ON DELETE SET NULL,
  invite_token_hash bytea,
  invited_at        timestamptz,
  joined_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_site_members_site_id_id UNIQUE (site_id, id),
  CONSTRAINT chk_site_members_user_or_phone CHECK (user_id IS NOT NULL OR phone IS NOT NULL),
  CONSTRAINT chk_site_members_owner_has_user CHECK (role <> 'owner' OR user_id IS NOT NULL),
  CONSTRAINT chk_site_members_contact_no_user CHECK (role <> 'contact' OR user_id IS NULL)
);
CREATE UNIQUE INDEX uq_site_members_one_owner ON site_members (site_id) WHERE role = 'owner' AND status = 'active';
CREATE UNIQUE INDEX uq_site_members_user ON site_members (site_id, user_id) WHERE user_id IS NOT NULL AND status <> 'removed';
CREATE UNIQUE INDEX uq_site_members_phone ON site_members (site_id, phone)   WHERE phone IS NOT NULL AND status <> 'removed';
CREATE UNIQUE INDEX uq_site_members_call ON site_members (site_id, call_priority) WHERE call_priority IS NOT NULL AND status = 'active';
CREATE INDEX idx_site_members_by_user ON site_members (user_id) WHERE status = 'active';

CREATE TABLE areas (
  id         uuid CONSTRAINT pk_areas PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id    uuid NOT NULL CONSTRAINT fk_areas_site_id REFERENCES sites(id) ON DELETE CASCADE,
  name       text NOT NULL,
  sort_order smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_areas_site_id_id UNIQUE (site_id, id),
  CONSTRAINT uq_areas_site_id_name UNIQUE (site_id, name)
);

CREATE TABLE member_area_scopes (
  site_id   uuid NOT NULL,
  member_id uuid NOT NULL,
  area_id   uuid NOT NULL,
  CONSTRAINT pk_member_area_scopes PRIMARY KEY (member_id, area_id),
  CONSTRAINT fk_member_area_scopes_member_id FOREIGN KEY (site_id, member_id) REFERENCES site_members(site_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_member_area_scopes_area_id FOREIGN KEY (site_id, area_id)   REFERENCES areas(site_id, id)        ON DELETE CASCADE
);
CREATE INDEX idx_member_area_scopes_area ON member_area_scopes (area_id);

-- No foreign keys on purpose: the log must survive deletion of what it describes.
-- Plain table (not partitioned): a daily job deletes rows older than 12 months in batches.
CREATE TABLE audit_logs (
  id          bigint GENERATED ALWAYS AS IDENTITY CONSTRAINT pk_audit_logs PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  site_id     uuid,
  actor_kind  text NOT NULL CONSTRAINT chk_audit_logs_actor_kind CHECK (actor_kind IN ('user','staff','device','system')),
  actor_id    uuid,
  action      text NOT NULL,            -- 'member.invite', 'rule.update', 'admin.site.view', ...
  entity_type text,
  entity_id   uuid,
  ip          inet,
  data        jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_audit_logs_site ON audit_logs (site_id, created_at DESC);
CREATE INDEX idx_audit_logs_entity ON audit_logs (entity_type, entity_id);
CREATE INDEX idx_audit_logs_created ON audit_logs (created_at);



-- =====================================================================
-- Migration 1790000003000-devices-cameras   owner: Iftekhar   module: devices, cameras, zones
-- Tables: devices, device_credentials, cameras, zones
-- =====================================================================

-- A device is anything that produces readings: a browser camera client,
-- the simulator, an on-site gateway box, or a cloud stream worker.
CREATE TABLE devices (
  id             uuid CONSTRAINT pk_devices PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id        uuid NOT NULL CONSTRAINT fk_devices_site_id REFERENCES sites(id) ON DELETE CASCADE,
  kind           text NOT NULL CONSTRAINT chk_devices_kind CHECK (kind IN ('browser','simulator','gateway','cloud_worker')),
  name           text NOT NULL,
  status         text NOT NULL DEFAULT 'pending' CONSTRAINT chk_devices_status CHECK (status IN ('pending','active','disabled')),
  time_mode      text NOT NULL DEFAULT 'wall' CONSTRAINT chk_devices_time_mode CHECK (time_mode IN ('wall','event')), -- 'event' only for simulators
  sw_version     text,
  capabilities   jsonb NOT NULL DEFAULT '{}',
  config_version integer NOT NULL DEFAULT 1,
  last_seen_at   timestamptz,
  last_ip        inet,
  created_by     uuid CONSTRAINT fk_devices_created_by REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_devices_site_id_id UNIQUE (site_id, id),
  CONSTRAINT chk_devices_event_time_simulator_only CHECK (time_mode = 'wall' OR kind = 'simulator')
);
CREATE INDEX idx_devices_site ON devices (site_id);

-- Key format given to the device once:  vgk_<key_prefix>_<secret>
-- Only sha256(secret) is stored. Several keys may be valid during rotation.
CREATE TABLE device_credentials (
  id           uuid CONSTRAINT pk_device_credentials PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id    uuid NOT NULL CONSTRAINT fk_device_credentials_device_id REFERENCES devices(id) ON DELETE CASCADE,
  key_prefix   text NOT NULL CONSTRAINT uq_device_credentials_key_prefix UNIQUE,
  key_hash     bytea NOT NULL,
  label        text,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  last_used_at timestamptz,
  created_by   uuid CONSTRAINT fk_device_credentials_created_by REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_device_credentials_device ON device_credentials (device_id) WHERE revoked_at IS NULL;

CREATE TABLE cameras (
  id             uuid CONSTRAINT pk_cameras PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id        uuid NOT NULL CONSTRAINT fk_cameras_site_id REFERENCES sites(id) ON DELETE CASCADE,
  area_id        uuid NOT NULL,
  device_id      uuid,
  name           text NOT NULL,
  source_kind    text NOT NULL CONSTRAINT chk_cameras_source_kind CHECK (source_kind IN ('browser','rtsp','simulator')),
  source_ref     text,                 -- encrypted RTSP URL / channel number (production)
  recording_mode text NOT NULL DEFAULT 'incident_only'
                 CONSTRAINT chk_cameras_recording_mode CHECK (recording_mode IN ('off','continuous','incident_only')),
  status         text NOT NULL DEFAULT 'pending'
                 CONSTRAINT chk_cameras_status CHECK (status IN ('pending','online','offline','no_signal','tampered','disabled')),
  last_seen_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  CONSTRAINT uq_cameras_site_id_id UNIQUE (site_id, id),
  CONSTRAINT fk_cameras_area_id FOREIGN KEY (site_id, area_id)   REFERENCES areas(site_id, id)   ON DELETE RESTRICT,
  CONSTRAINT fk_cameras_device_id FOREIGN KEY (site_id, device_id) REFERENCES devices(site_id, id) ON DELETE SET NULL (device_id)
);
CREATE UNIQUE INDEX uq_cameras_name ON cameras (site_id, name) WHERE deleted_at IS NULL;
CREATE INDEX idx_cameras_area ON cameras (area_id)   WHERE deleted_at IS NULL;
CREATE INDEX idx_cameras_device ON cameras (device_id) WHERE deleted_at IS NULL;

CREATE TABLE zones (
  id          uuid CONSTRAINT pk_zones PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     uuid NOT NULL,
  camera_id   uuid NOT NULL,
  name        text NOT NULL,
  kind        text NOT NULL DEFAULT 'general'
              CONSTRAINT chk_zones_kind CHECK (kind IN ('general','restricted','shed','work','shelf','stock','entrance','guard_post')),
  polygon     jsonb NOT NULL,          -- [[x,y],...] normalised 0..1, 3 to 32 points
  anchor      text NOT NULL DEFAULT 'foot' CONSTRAINT chk_zones_anchor CHECK (anchor IN ('foot','center','overlap')),
  min_overlap real NOT NULL DEFAULT 0.35 CONSTRAINT chk_zones_min_overlap CHECK (min_overlap > 0 AND min_overlap <= 1),
  enabled     boolean NOT NULL DEFAULT true,
  muted_until timestamptz,
  version     integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  CONSTRAINT uq_zones_site_id_id UNIQUE (site_id, id),
  CONSTRAINT fk_zones_camera_id FOREIGN KEY (site_id, camera_id) REFERENCES cameras(site_id, id) ON DELETE CASCADE,
  CONSTRAINT chk_zones_polygon_shape CHECK (jsonb_typeof(polygon) = 'array' AND jsonb_array_length(polygon) BETWEEN 3 AND 32)
);
CREATE UNIQUE INDEX uq_zones_name ON zones (camera_id, name) WHERE deleted_at IS NULL;
CREATE INDEX idx_zones_camera ON zones (camera_id) WHERE deleted_at IS NULL;



-- =====================================================================
-- Migration 1790000004000-catalog   owner: Mahir   module: catalog
-- Tables: object_classes, ai_models, model_classes, packs, pack_models, rule_templates
-- =====================================================================

CREATE TABLE object_classes (
  code        text CONSTRAINT pk_object_classes PRIMARY KEY,        -- 'person', 'cow', 'helmet', 'fill_ratio'
  kind        text NOT NULL CONSTRAINT chk_object_classes_kind CHECK (kind IN ('object','attribute','measure')),
  parent_code text CONSTRAINT fk_object_classes_parent_code REFERENCES object_classes(code) ON DELETE SET NULL, -- cow -> animal
  name_en     text NOT NULL,
  name_bn     text NOT NULL
);

CREATE TABLE ai_models (
  id                 uuid CONSTRAINT pk_ai_models PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL,
  version            text NOT NULL,
  task               text NOT NULL CONSTRAINT chk_ai_models_task CHECK (task IN ('detect','classify','pose','segment','count')),
  runtime            text NOT NULL CONSTRAINT chk_ai_models_runtime CHECK (runtime IN ('onnx_web','onnx','tensorrt','openvino','remote')),
  stage              smallint NOT NULL DEFAULT 1 CONSTRAINT chk_ai_models_stage CHECK (stage IN (1,2)),
  trigger_class_code text CONSTRAINT fk_ai_models_trigger_class_code REFERENCES object_classes(code) ON DELETE RESTRICT, -- stage 2: crops of this class
  output_kind        text NOT NULL CONSTRAINT chk_ai_models_output_kind CHECK (output_kind IN ('boxes','attrs','measure')),
  artifact_url       text,
  artifact_sha256    text,
  input_size         integer NOT NULL DEFAULT 640,
  default_conf       real NOT NULL DEFAULT 0.35 CONSTRAINT chk_ai_models_default_conf CHECK (default_conf > 0 AND default_conf < 1),
  default_interval_ms integer NOT NULL DEFAULT 1000 CONSTRAINT chk_ai_models_default_interval_ms CHECK (default_interval_ms >= 100),
  status             text NOT NULL DEFAULT 'active' CONSTRAINT chk_ai_models_status CHECK (status IN ('planned','active','retired')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_ai_models_code_version UNIQUE (code, version),
  CONSTRAINT chk_ai_models_stage_trigger CHECK ((stage = 2) = (trigger_class_code IS NOT NULL) OR output_kind = 'measure')
);

CREATE TABLE model_classes (
  model_id     uuid NOT NULL CONSTRAINT fk_model_classes_model_id REFERENCES ai_models(id) ON DELETE CASCADE,
  class_code   text NOT NULL CONSTRAINT fk_model_classes_class_code REFERENCES object_classes(code) ON DELETE RESTRICT,
  class_index  smallint NOT NULL,      -- index in the model's output
  default_conf real CONSTRAINT chk_model_classes_default_conf CHECK (default_conf > 0 AND default_conf < 1),
  CONSTRAINT pk_model_classes PRIMARY KEY (model_id, class_code),
  CONSTRAINT uq_model_classes_model_id_class_index UNIQUE (model_id, class_index)
);

CREATE TABLE packs (
  id                uuid CONSTRAINT pk_packs PRIMARY KEY DEFAULT gen_random_uuid(),
  code              text NOT NULL CONSTRAINT uq_packs_code UNIQUE,   -- 'core','farm','construction','shop','workplace','custom_<n>'
  name              text NOT NULL,
  description       text,
  is_default        boolean NOT NULL DEFAULT false,  -- Core Security: every site gets it
  custom_site_id    uuid CONSTRAINT fk_packs_custom_site_id REFERENCES sites(id) ON DELETE CASCADE, -- set => private custom pack
  addon_price_minor integer NOT NULL DEFAULT 0 CONSTRAINT chk_packs_addon_price_minor CHECK (addon_price_minor >= 0),
  manifest          jsonb NOT NULL DEFAULT '{}',     -- metrics, zone presets, onboarding text
  status            text NOT NULL DEFAULT 'active' CONSTRAINT chk_packs_status CHECK (status IN ('draft','active','retired')),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pack_models (
  pack_id  uuid NOT NULL CONSTRAINT fk_pack_models_pack_id REFERENCES packs(id) ON DELETE CASCADE,
  model_id uuid NOT NULL CONSTRAINT fk_pack_models_model_id REFERENCES ai_models(id) ON DELETE RESTRICT,
  required boolean NOT NULL DEFAULT true,
  CONSTRAINT pk_pack_models PRIMARY KEY (pack_id, model_id)
);

CREATE TABLE rule_templates (
  id                 uuid CONSTRAINT pk_rule_templates PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id            uuid NOT NULL CONSTRAINT fk_rule_templates_pack_id REFERENCES packs(id) ON DELETE CASCADE,
  code               text NOT NULL,
  name               text NOT NULL,
  description        text,
  kind               text NOT NULL CONSTRAINT chk_rule_templates_kind CHECK (kind IN ('presence','count_range','attribute_missing','proximity',
                                                   'measure_threshold','delta','anomaly','device_health')),
  default_params     jsonb NOT NULL,
  param_schema       jsonb NOT NULL,          -- JSON Schema: validates rule.params and drives the form
  default_severity   text NOT NULL CONSTRAINT chk_rule_templates_default_severity CHECK (default_severity IN ('low','medium','high','critical')),
  default_schedule   jsonb,                   -- NULL = always
  default_sustain_s  integer NOT NULL DEFAULT 10  CONSTRAINT chk_rule_templates_default_sustain_s CHECK (default_sustain_s  >= 0),
  default_clear_s    integer NOT NULL DEFAULT 30  CONSTRAINT chk_rule_templates_default_clear_s CHECK (default_clear_s    >= 0),
  default_cooldown_s integer NOT NULL DEFAULT 300 CONSTRAINT chk_rule_templates_default_cooldown_s CHECK (default_cooldown_s >= 0),
  zone_kinds         text[] NOT NULL DEFAULT '{}',  -- zone kinds this template fits
  required_classes   text[] NOT NULL DEFAULT '{}',  -- object_class codes the models must provide
  auto_provision     boolean NOT NULL DEFAULT false, -- created automatically by zone quickstart
  i18n               jsonb NOT NULL DEFAULT '{}',   -- alert title/body templates {bn:{...}, en:{...}}
  status             text NOT NULL DEFAULT 'active' CONSTRAINT chk_rule_templates_status CHECK (status IN ('draft','active','retired')),
  CONSTRAINT uq_rule_templates_pack_id_code UNIQUE (pack_id, code)
);



-- =====================================================================
-- Migration 1790000005000-rules   owner: Iftekhar   module: rules
-- Tables: model_assignments, rules
-- =====================================================================

-- Per-camera tuning of a model. Rows are created automatically when a pack
-- becomes active or a camera is added; owners rarely touch them.
CREATE TABLE model_assignments (
  id                uuid CONSTRAINT pk_model_assignments PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           uuid NOT NULL,
  camera_id         uuid NOT NULL,
  model_id          uuid NOT NULL CONSTRAINT fk_model_assignments_model_id REFERENCES ai_models(id) ON DELETE RESTRICT,
  active_when       text NOT NULL DEFAULT 'always' CONSTRAINT chk_model_assignments_active_when CHECK (active_when IN ('always','day','night','lowlight')),
  frame_interval_ms integer NOT NULL DEFAULT 1000 CONSTRAINT chk_model_assignments_frame_interval_ms CHECK (frame_interval_ms >= 100),
  conf_overrides    jsonb NOT NULL DEFAULT '{}',   -- {"person": 0.45}
  enabled           boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_model_assignments_camera_id FOREIGN KEY (site_id, camera_id) REFERENCES cameras(site_id, id) ON DELETE CASCADE,
  CONSTRAINT uq_model_assignments_camera_id_model_id_active_when UNIQUE (camera_id, model_id, active_when)
);

-- A rule is bound to exactly one zone, or to one camera (device health).
-- Multi-class and spatial logic lives in params, validated against the
-- template's param_schema. Expected counts (old watch_target) are rules.
CREATE TABLE rules (
  id          uuid CONSTRAINT pk_rules PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     uuid NOT NULL CONSTRAINT fk_rules_site_id REFERENCES sites(id) ON DELETE CASCADE,
  zone_id     uuid,
  camera_id   uuid,
  template_id uuid NOT NULL CONSTRAINT fk_rules_template_id REFERENCES rule_templates(id) ON DELETE RESTRICT,
  name        text NOT NULL,
  params      jsonb NOT NULL,
  severity    text NOT NULL CONSTRAINT chk_rules_severity CHECK (severity IN ('low','medium','high','critical')),
  schedule    jsonb,                              -- NULL = always; see contracts.ts Schedule
  sustain_s   integer NOT NULL CONSTRAINT chk_rules_sustain_s CHECK (sustain_s  >= 0),
  clear_s     integer NOT NULL CONSTRAINT chk_rules_clear_s CHECK (clear_s    >= 0),
  cooldown_s  integer NOT NULL CONSTRAINT chk_rules_cooldown_s CHECK (cooldown_s >= 0),
  enabled     boolean NOT NULL DEFAULT true,
  muted_until timestamptz,
  version     integer NOT NULL DEFAULT 1,
  created_by  uuid CONSTRAINT fk_rules_created_by REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  CONSTRAINT uq_rules_site_id_id UNIQUE (site_id, id),
  CONSTRAINT fk_rules_zone_id FOREIGN KEY (site_id, zone_id)   REFERENCES zones(site_id, id)   ON DELETE CASCADE,
  CONSTRAINT fk_rules_camera_id FOREIGN KEY (site_id, camera_id) REFERENCES cameras(site_id, id) ON DELETE CASCADE,
  CONSTRAINT chk_rules_one_target CHECK (num_nonnulls(zone_id, camera_id) = 1)
);
CREATE INDEX idx_rules_zone ON rules (zone_id)   WHERE deleted_at IS NULL AND enabled;
CREATE INDEX idx_rules_camera ON rules (camera_id) WHERE deleted_at IS NULL AND enabled;
CREATE INDEX idx_rules_site ON rules (site_id)   WHERE deleted_at IS NULL;



-- =====================================================================
-- Migration 1790000006000-time-series   owner: Iftekhar   module: analytics
-- Tables: zone_metric_minutes, zone_metric_hours, zone_baselines
-- =====================================================================

-- metric_key examples:
--   count.person, count.cow, attr_missing.person.helmet,
--   measure.fill_ratio, measure.stock_count
CREATE TABLE zone_metric_minutes (
  site_id    uuid NOT NULL,
  zone_id    uuid NOT NULL,
  metric_key text NOT NULL,
  bucket     timestamptz NOT NULL,       -- start of the minute
  n          smallint NOT NULL,          -- samples in the minute
  sum        double precision NOT NULL,
  min        real NOT NULL,
  max        real NOT NULL,
  sumsq      double precision NOT NULL,
  CONSTRAINT pk_zone_metric_minutes PRIMARY KEY (zone_id, metric_key, bucket),
  CONSTRAINT fk_zone_metric_minutes_zone_id FOREIGN KEY (site_id, zone_id) REFERENCES zones(site_id, id) ON DELETE CASCADE
) PARTITION BY RANGE (bucket);
-- Daily partitions, kept 48 hours. The maintenance job creates the next 3 days
-- and drops days older than 48 h. The DEFAULT partition is a safety net: if the
-- job ever misses a day, inserts still succeed (health check alerts when it has rows).
CREATE OR REPLACE FUNCTION vg_ensure_minute_partition(day date) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE part text := 'zone_metric_minutes_' || to_char(day, 'YYYYMMDD');
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF zone_metric_minutes FOR VALUES FROM (%L) TO (%L)',
    part, day::timestamptz, (day + 1)::timestamptz);
END $$;
CREATE TABLE zone_metric_minutes_default PARTITION OF zone_metric_minutes DEFAULT;
SELECT vg_ensure_minute_partition(current_date + d) FROM generate_series(0, 2) AS d;

CREATE TABLE zone_metric_hours (
  site_id    uuid NOT NULL,
  zone_id    uuid NOT NULL,
  metric_key text NOT NULL,
  bucket     timestamptz NOT NULL,       -- start of the hour
  n          integer NOT NULL,
  sum        double precision NOT NULL,
  min        real NOT NULL,
  max        real NOT NULL,
  sumsq      double precision NOT NULL,
  CONSTRAINT pk_zone_metric_hours PRIMARY KEY (zone_id, metric_key, bucket),
  CONSTRAINT fk_zone_metric_hours_zone_id FOREIGN KEY (site_id, zone_id) REFERENCES zones(site_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_zone_metric_hours_site ON zone_metric_hours (site_id, bucket);

CREATE TABLE zone_baselines (
  zone_id      uuid NOT NULL CONSTRAINT fk_zone_baselines_zone_id REFERENCES zones(id) ON DELETE CASCADE,
  metric_key   text NOT NULL,
  hour_of_week smallint NOT NULL CONSTRAINT chk_zone_baselines_hour_of_week CHECK (hour_of_week BETWEEN 0 AND 167), -- site local time, 0 = Mon 00:00
  n_weeks      smallint NOT NULL,
  median       real NOT NULL,
  mad          real NOT NULL,            -- median absolute deviation
  mean         real NOT NULL,
  std          real NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_zone_baselines PRIMARY KEY (zone_id, metric_key, hour_of_week)
);



-- =====================================================================
-- Migration 1790000007000-alerts   owner: Abid   module: alerts, delivery
-- Tables: escalation_policies, escalation_steps, alerts, alert_recipients, delivery_attempts
-- =====================================================================

CREATE TABLE escalation_policies (
  id           uuid CONSTRAINT pk_escalation_policies PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      uuid NOT NULL CONSTRAINT fk_escalation_policies_site_id REFERENCES sites(id) ON DELETE CASCADE,
  name         text NOT NULL,
  is_default   boolean NOT NULL DEFAULT false,
  min_severity text NOT NULL DEFAULT 'low' CONSTRAINT chk_escalation_policies_min_severity CHECK (min_severity IN ('low','medium','high','critical')),
  repeat_count smallint NOT NULL DEFAULT 0 CONSTRAINT chk_escalation_policies_repeat_count CHECK (repeat_count BETWEEN 0 AND 3),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_escalation_policies_site_id_id UNIQUE (site_id, id)
);
CREATE UNIQUE INDEX uq_escalation_policies_default ON escalation_policies (site_id) WHERE is_default;

CREATE TABLE escalation_steps (
  id             uuid CONSTRAINT pk_escalation_steps PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id      uuid NOT NULL CONSTRAINT fk_escalation_steps_policy_id REFERENCES escalation_policies(id) ON DELETE CASCADE,
  step_no        smallint NOT NULL CONSTRAINT chk_escalation_steps_step_no CHECK (step_no >= 1),
  wait_s         integer NOT NULL CONSTRAINT chk_escalation_steps_wait_s CHECK (wait_s >= 0),     -- delay after the previous step
  channels       text[] NOT NULL CONSTRAINT chk_escalation_steps_channels CHECK (channels <@ ARRAY['inapp','webpush','telegram','call']
                                        AND cardinality(channels) > 0),
  audience       text NOT NULL CONSTRAINT chk_escalation_steps_audience CHECK (audience IN ('all_members','role','call_list')),
  role           text CONSTRAINT chk_escalation_steps_role CHECK (role IN ('owner','manager','guard','viewer','contact')),
  call_count     smallint NOT NULL DEFAULT 1 CONSTRAINT chk_escalation_steps_call_count CHECK (call_count BETWEEN 1 AND 5), -- people tried from the call list
  ring_timeout_s smallint NOT NULL DEFAULT 30 CONSTRAINT chk_escalation_steps_ring_timeout_s CHECK (ring_timeout_s BETWEEN 10 AND 60),
  CONSTRAINT uq_escalation_steps_policy_id_step_no UNIQUE (policy_id, step_no),
  CONSTRAINT chk_escalation_steps_role_audience CHECK ((audience = 'role') = (role IS NOT NULL))
);

CREATE TABLE alerts (
  id                 uuid CONSTRAINT pk_alerts PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id            uuid NOT NULL CONSTRAINT fk_alerts_site_id REFERENCES sites(id) ON DELETE CASCADE,
  source             text NOT NULL CONSTRAINT chk_alerts_source CHECK (source IN ('system','manual','test')),
  sender_member_id   uuid,
  policy_id          uuid,
  title              text NOT NULL,
  body               text,
  severity           text NOT NULL CONSTRAINT chk_alerts_severity CHECK (severity IN ('low','medium','high','critical')),
  risk_score         smallint CONSTRAINT chk_alerts_risk_score CHECK (risk_score BETWEEN 0 AND 100),
  status             text NOT NULL DEFAULT 'active' CONSTRAINT chk_alerts_status CHECK (status IN ('active','acknowledged','exhausted','cancelled')),
  current_step       smallint NOT NULL DEFAULT 0,
  client_request_id  text,                      -- idempotency key from the sender's device
  acknowledged_by    uuid,                      -- site_member.id
  acknowledged_via   text CONSTRAINT chk_alerts_acknowledged_via CHECK (acknowledged_via IN ('app','telegram','webpush','call')),
  acknowledged_at    timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  closed_at          timestamptz,
  CONSTRAINT uq_alerts_site_id_id UNIQUE (site_id, id),
  CONSTRAINT fk_alerts_sender_member_id FOREIGN KEY (site_id, sender_member_id) REFERENCES site_members(site_id, id) ON DELETE SET NULL (sender_member_id),
  CONSTRAINT fk_alerts_acknowledged_by FOREIGN KEY (site_id, acknowledged_by)  REFERENCES site_members(site_id, id) ON DELETE SET NULL (acknowledged_by),
  CONSTRAINT fk_alerts_policy_id FOREIGN KEY (site_id, policy_id)        REFERENCES escalation_policies(site_id, id) ON DELETE SET NULL (policy_id),
  CONSTRAINT chk_alerts_manual_sender CHECK (source <> 'manual' OR sender_member_id IS NOT NULL OR status <> 'active')
);
CREATE UNIQUE INDEX uq_alerts_idempotency ON alerts (site_id, sender_member_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE INDEX idx_alerts_site_time ON alerts (site_id, created_at DESC);
CREATE INDEX idx_alerts_site_active ON alerts (site_id) WHERE status = 'active';

-- Exactly one kind of recipient: a site_member (contacts are members too).
CREATE TABLE alert_recipients (
  id             uuid CONSTRAINT pk_alert_recipients PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id       uuid NOT NULL CONSTRAINT fk_alert_recipients_alert_id REFERENCES alerts(id) ON DELETE CASCADE,
  site_id        uuid NOT NULL,
  member_id      uuid NOT NULL,
  step_no        smallint NOT NULL,
  status         text NOT NULL DEFAULT 'pending'
                 CONSTRAINT chk_alert_recipients_status CHECK (status IN ('pending','notified','seen','acknowledged','unreachable','skipped')),
  ack_token_hash bytea,                -- one-time token for Telegram / push / call acknowledgement
  notified_at    timestamptz,
  seen_at        timestamptz,
  acked_at       timestamptz,
  CONSTRAINT uq_alert_recipients_alert_id_member_id UNIQUE (alert_id, member_id),
  CONSTRAINT fk_alert_recipients_member_id FOREIGN KEY (site_id, member_id) REFERENCES site_members(site_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_alert_recipients_member ON alert_recipients (member_id, status);
CREATE UNIQUE INDEX uq_alert_recipients_token ON alert_recipients (ack_token_hash) WHERE ack_token_hash IS NOT NULL;

-- One row per send or call attempt (replaces notification + call_attempt).
CREATE TABLE delivery_attempts (
  id           uuid CONSTRAINT pk_delivery_attempts PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL CONSTRAINT fk_delivery_attempts_recipient_id REFERENCES alert_recipients(id) ON DELETE CASCADE,
  channel      text NOT NULL CONSTRAINT chk_delivery_attempts_channel CHECK (channel IN ('inapp','webpush','telegram','call')),
  endpoint_id  uuid CONSTRAINT fk_delivery_attempts_endpoint_id REFERENCES notification_endpoints(id) ON DELETE SET NULL,
  attempt_no   smallint NOT NULL DEFAULT 1,
  status       text NOT NULL DEFAULT 'queued'
               CONSTRAINT chk_delivery_attempts_status CHECK (status IN ('queued','sent','delivered','failed','ringing','answered','no_answer','busy','cancelled')),
  provider     text,
  provider_ref text,                   -- message id / call id from the provider
  error        text,
  meta         jsonb NOT NULL DEFAULT '{}',   -- call: {"duration_s": 12, "dtmf": "1"}
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT uq_delivery_attempts_recipient_id_channel_attempt_no UNIQUE (recipient_id, channel, attempt_no)
);
CREATE UNIQUE INDEX uq_delivery_attempts_provider ON delivery_attempts (provider, provider_ref)
  WHERE provider_ref IS NOT NULL;



-- =====================================================================
-- Migration 1790000008000-media   owner: Musa   module: media
-- Tables: media
-- =====================================================================

CREATE TABLE media (
  id         uuid CONSTRAINT pk_media PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id    uuid CONSTRAINT fk_media_site_id REFERENCES sites(id) ON DELETE CASCADE,   -- NULL = platform file (ticket attachment)
  kind       text NOT NULL CONSTRAINT chk_media_kind CHECK (kind IN ('image','video','file')),
  storage    text NOT NULL CONSTRAINT chk_media_storage CHECK (storage IN ('local','r2')),
  object_key text NOT NULL CONSTRAINT uq_media_object_key UNIQUE,
  mime       text NOT NULL,
  bytes      bigint NOT NULL CONSTRAINT chk_media_bytes CHECK (bytes >= 0),
  status     text NOT NULL DEFAULT 'ready' CONSTRAINT chk_media_status CHECK (status IN ('pending','ready','purging')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);
CREATE INDEX idx_media_expiry ON media (expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_media_pending ON media (created_at) WHERE status <> 'ready';



-- =====================================================================
-- Migration 1790000009000-incidents   owner: Iftekhar   module: incidents
-- Tables: incidents, incident_events
-- =====================================================================

CREATE TABLE incidents (
  id                 uuid CONSTRAINT pk_incidents PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id            uuid NOT NULL CONSTRAINT fk_incidents_site_id REFERENCES sites(id) ON DELETE CASCADE,
  rule_id            uuid,
  zone_id            uuid,
  camera_id          uuid,
  alert_id           uuid,                          -- many incidents can share one alert
  kind               text NOT NULL,                 -- rule_template.kind
  title              text NOT NULL,
  severity           text NOT NULL CONSTRAINT chk_incidents_severity CHECK (severity IN ('low','medium','high','critical')),
  risk_score         smallint NOT NULL CONSTRAINT chk_incidents_risk_score CHECK (risk_score BETWEEN 0 AND 100),
  status             text NOT NULL DEFAULT 'open' CONSTRAINT chk_incidents_status CHECK (status IN ('open','acknowledged','resolved','false_alarm')),
  condition_active   boolean NOT NULL DEFAULT true, -- is the rule still violated right now
  dedup_key          text NOT NULL,                 -- '<zone or camera id>:<kind>:<subject>'
  recurrence         integer NOT NULL DEFAULT 1,
  started_at         timestamptz NOT NULL,
  last_seen_at       timestamptz NOT NULL,
  ended_at           timestamptz,
  clip_from          timestamptz,                   -- started_at - 30 s
  clip_to            timestamptz,                   -- started_at + 60 s
  expected           jsonb NOT NULL DEFAULT '{}',   -- see contracts.ts IncidentExpected
  observed           jsonb NOT NULL DEFAULT '{}',   -- see contracts.ts IncidentObserved
  cover_snapshot_id  uuid,
  acknowledged_by    uuid,
  acknowledged_at    timestamptz,
  resolved_by        uuid,
  resolved_at        timestamptz,
  false_alarm_reason text CONSTRAINT chk_incidents_false_alarm_reason CHECK (false_alarm_reason IN ('wrong_object','authorized_person','animal',
                                                        'light_or_shadow','rule_too_sensitive','other')),
  resolution_note    text,
  search_tsv         tsvector GENERATED ALWAYS AS
                     (to_tsvector('simple', title || ' ' || coalesce(resolution_note, ''))) STORED,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_incidents_site_id_id UNIQUE (site_id, id),
  CONSTRAINT fk_incidents_rule_id FOREIGN KEY (site_id, rule_id)   REFERENCES rules(site_id, id)   ON DELETE SET NULL (rule_id),
  CONSTRAINT fk_incidents_zone_id FOREIGN KEY (site_id, zone_id)   REFERENCES zones(site_id, id)   ON DELETE SET NULL (zone_id),
  CONSTRAINT fk_incidents_camera_id FOREIGN KEY (site_id, camera_id) REFERENCES cameras(site_id, id) ON DELETE SET NULL (camera_id),
  CONSTRAINT fk_incidents_alert_id FOREIGN KEY (site_id, alert_id)  REFERENCES alerts(site_id, id)  ON DELETE SET NULL (alert_id),
  CONSTRAINT fk_incidents_acknowledged_by FOREIGN KEY (site_id, acknowledged_by) REFERENCES site_members(site_id, id) ON DELETE SET NULL (acknowledged_by),
  CONSTRAINT fk_incidents_resolved_by FOREIGN KEY (site_id, resolved_by)     REFERENCES site_members(site_id, id) ON DELETE SET NULL (resolved_by),
  CONSTRAINT chk_incidents_false_alarm_status CHECK ((status = 'false_alarm') = (false_alarm_reason IS NOT NULL)),
  CONSTRAINT chk_incidents_clip_window CHECK (clip_to IS NULL OR clip_to > clip_from)
);
-- At most ONE unresolved incident per dedup_key: repeats merge into it.
CREATE UNIQUE INDEX uq_incidents_open_dedup ON incidents (dedup_key) WHERE status IN ('open','acknowledged');
CREATE INDEX idx_incidents_site_time ON incidents (site_id, started_at DESC);
CREATE INDEX idx_incidents_site_status ON incidents (site_id, status, started_at DESC);
CREATE INDEX idx_incidents_zone_time ON incidents (zone_id, started_at DESC);
CREATE INDEX idx_incidents_camera_clip ON incidents (camera_id, clip_from, clip_to) WHERE clip_from IS NOT NULL;
CREATE INDEX idx_incidents_alert ON incidents (alert_id) WHERE alert_id IS NOT NULL;
CREATE INDEX idx_incidents_search ON incidents USING gin (search_tsv);

CREATE TABLE incident_events (
  id              bigint GENERATED ALWAYS AS IDENTITY CONSTRAINT pk_incident_events PRIMARY KEY,
  incident_id     uuid NOT NULL CONSTRAINT fk_incident_events_incident_id REFERENCES incidents(id) ON DELETE CASCADE,
  type            text NOT NULL CONSTRAINT chk_incident_events_type CHECK (type IN ('created','recurred','severity_changed','alert_sent','acknowledged',
                                                'resolved','false_alarm','reopened','condition_cleared','note','clip_ready')),
  actor_member_id uuid CONSTRAINT fk_incident_events_actor_member_id REFERENCES site_members(id) ON DELETE SET NULL,
  data            jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_incident_events_incident ON incident_events (incident_id, created_at);



-- =====================================================================
-- Migration 1790000010000-recordings   owner: Musa   module: media, live view, feedback
-- Tables: snapshots, recording_segments, incident_segments, live_view_sessions, detection_feedback
-- =====================================================================

CREATE TABLE snapshots (
  id          uuid CONSTRAINT pk_snapshots PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     uuid NOT NULL,
  camera_id   uuid NOT NULL,
  incident_id uuid CONSTRAINT fk_snapshots_incident_id REFERENCES incidents(id) ON DELETE SET NULL,
  media_id    uuid NOT NULL CONSTRAINT uq_snapshots_media_id UNIQUE CONSTRAINT fk_snapshots_media_id REFERENCES media(id) ON DELETE RESTRICT,
  captured_at timestamptz NOT NULL,
  trigger     text NOT NULL CONSTRAINT chk_snapshots_trigger CHECK (trigger IN ('periodic','incident','manual','tamper')),
  detections  jsonb NOT NULL DEFAULT '[]',   -- frozen copy of the boxes in this frame (replaces snapshot_object)
  model_code  text,
  frame_w     integer,
  frame_h     integer,
  CONSTRAINT fk_snapshots_camera_id FOREIGN KEY (site_id, camera_id) REFERENCES cameras(site_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_snapshots_camera_time ON snapshots (camera_id, captured_at DESC);
CREATE INDEX idx_snapshots_incident ON snapshots (incident_id) WHERE incident_id IS NOT NULL;

ALTER TABLE incidents
  ADD CONSTRAINT fk_incidents_cover_snapshot_id
  FOREIGN KEY (cover_snapshot_id) REFERENCES snapshots(id) ON DELETE SET NULL;

-- One row per uploaded (or edge-held) video segment. Replaces "recording".
CREATE TABLE recording_segments (
  id            uuid CONSTRAINT pk_recording_segments PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       uuid NOT NULL,
  camera_id     uuid NOT NULL,
  started_at    timestamptz NOT NULL,
  ended_at      timestamptz NOT NULL,
  container     text NOT NULL CONSTRAINT chk_recording_segments_container CHECK (container IN ('webm','mp4','fmp4')),
  codec         text,
  stored        text NOT NULL DEFAULT 'cloud' CONSTRAINT chk_recording_segments_stored CHECK (stored IN ('cloud','edge')),
  media_id      uuid CONSTRAINT uq_recording_segments_media_id UNIQUE CONSTRAINT fk_recording_segments_media_id REFERENCES media(id) ON DELETE RESTRICT,
  init_media_id uuid CONSTRAINT fk_recording_segments_init_media_id REFERENCES media(id) ON DELETE RESTRICT,   -- fMP4 init segment
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_recording_segments_camera_id FOREIGN KEY (site_id, camera_id) REFERENCES cameras(site_id, id) ON DELETE CASCADE,
  CONSTRAINT uq_recording_segments_camera_id_started_at UNIQUE (camera_id, started_at),
  CONSTRAINT chk_recording_segments_time_order CHECK (ended_at > started_at),
  CONSTRAINT chk_recording_segments_cloud_media CHECK ((stored = 'cloud') = (media_id IS NOT NULL))
);
CREATE INDEX idx_recording_segments_range ON recording_segments (camera_id, ended_at);
CREATE INDEX idx_recording_segments_purge ON recording_segments (ended_at) WHERE stored = 'cloud';

-- Which segments an incident clip needs (replaces incident_clip -> recording N:1).
-- A 90 second clip links to the 2 or 3 one-minute segments it overlaps.
-- A linked segment is never purged by retention.
CREATE TABLE incident_segments (
  incident_id uuid NOT NULL CONSTRAINT fk_incident_segments_incident_id REFERENCES incidents(id) ON DELETE CASCADE,
  segment_id  uuid NOT NULL CONSTRAINT fk_incident_segments_segment_id REFERENCES recording_segments(id) ON DELETE RESTRICT,
  CONSTRAINT pk_incident_segments PRIMARY KEY (incident_id, segment_id)
);
CREATE INDEX idx_incident_segments_segment ON incident_segments (segment_id);

CREATE TABLE live_view_sessions (
  id             uuid CONSTRAINT pk_live_view_sessions PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id        uuid NOT NULL,
  camera_id      uuid NOT NULL,
  viewer_user_id uuid NOT NULL CONSTRAINT fk_live_view_sessions_viewer_user_id REFERENCES users(id) ON DELETE CASCADE,
  transport      text CONSTRAINT chk_live_view_sessions_transport CHECK (transport IN ('p2p','relay','sfu')),
  started_at     timestamptz NOT NULL DEFAULT now(),
  connected_at   timestamptz,
  ended_at       timestamptz,
  end_reason     text CONSTRAINT chk_live_view_sessions_end_reason CHECK (end_reason IN ('viewer_left','timeout','device_offline','limit','error')),
  CONSTRAINT fk_live_view_sessions_camera_id FOREIGN KEY (site_id, camera_id) REFERENCES cameras(site_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_live_view_sessions_active ON live_view_sessions (camera_id) WHERE ended_at IS NULL;

-- Owner feedback on an incident, kept as training data (false-alarm loop).
CREATE TABLE detection_feedback (
  id            uuid CONSTRAINT pk_detection_feedback PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       uuid NOT NULL CONSTRAINT fk_detection_feedback_site_id REFERENCES sites(id) ON DELETE CASCADE,
  incident_id   uuid CONSTRAINT fk_detection_feedback_incident_id REFERENCES incidents(id) ON DELETE SET NULL,
  snapshot_id   uuid CONSTRAINT fk_detection_feedback_snapshot_id REFERENCES snapshots(id) ON DELETE SET NULL,
  label         text NOT NULL CONSTRAINT chk_detection_feedback_label CHECK (label IN ('false_positive','true_positive','wrong_class','missed')),
  reason        text,
  model_code    text,
  model_version text,
  detections    jsonb NOT NULL DEFAULT '[]',   -- boxes the model produced
  corrected     jsonb,                         -- boxes or classes after human correction
  created_by    uuid CONSTRAINT fk_detection_feedback_created_by REFERENCES site_members(id) ON DELETE SET NULL,
  export_status text NOT NULL DEFAULT 'pending' CONSTRAINT chk_detection_feedback_export_status CHECK (export_status IN ('pending','exported','excluded')),
  exported_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_detection_feedback_export ON detection_feedback (export_status, created_at);



-- =====================================================================
-- Migration 1790000011000-conversations   owner: Abid   module: conversations
-- Tables: conversations, conversation_members, messages
-- =====================================================================

-- Site-scoped chat only: one team room per site and one thread per alert.
CREATE TABLE conversations (
  id              uuid CONSTRAINT pk_conversations PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         uuid NOT NULL CONSTRAINT fk_conversations_site_id REFERENCES sites(id) ON DELETE CASCADE,
  kind            text NOT NULL CONSTRAINT chk_conversations_kind CHECK (kind IN ('team','alert')),
  alert_id        uuid CONSTRAINT uq_conversations_alert_id UNIQUE CONSTRAINT fk_conversations_alert_id REFERENCES alerts(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,
  CONSTRAINT chk_conversations_alert_link CHECK ((kind = 'alert') = (alert_id IS NOT NULL))
);
CREATE UNIQUE INDEX uq_conversations_team ON conversations (site_id) WHERE kind = 'team';

CREATE TABLE conversation_members (
  conversation_id uuid NOT NULL CONSTRAINT fk_conversation_members_conversation_id REFERENCES conversations(id) ON DELETE CASCADE,
  member_id       uuid NOT NULL CONSTRAINT fk_conversation_members_member_id REFERENCES site_members(id) ON DELETE CASCADE,
  last_read_id    bigint NOT NULL DEFAULT 0,
  muted           boolean NOT NULL DEFAULT false,
  CONSTRAINT pk_conversation_members PRIMARY KEY (conversation_id, member_id)
);

CREATE TABLE messages (
  id               bigint GENERATED ALWAYS AS IDENTITY CONSTRAINT pk_messages PRIMARY KEY,
  conversation_id  uuid NOT NULL CONSTRAINT fk_messages_conversation_id REFERENCES conversations(id) ON DELETE CASCADE,
  sender_member_id uuid CONSTRAINT fk_messages_sender_member_id REFERENCES site_members(id) ON DELETE SET NULL,
  body             text NOT NULL CONSTRAINT chk_messages_body CHECK (char_length(body) BETWEEN 1 AND 4000),
  media_id         uuid CONSTRAINT fk_messages_media_id REFERENCES media(id) ON DELETE SET NULL,
  client_msg_id    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  edited_at        timestamptz,
  deleted_at       timestamptz
);
CREATE INDEX idx_messages_conversation ON messages (conversation_id, id DESC);
CREATE UNIQUE INDEX uq_messages_idempotency ON messages (conversation_id, sender_member_id, client_msg_id)
  WHERE client_msg_id IS NOT NULL;



-- =====================================================================
-- Migration 1790000012000-support-exports   owner: Abid   module: support, reports
-- Tables: support_tickets, ticket_messages, export_jobs
-- =====================================================================

-- Platform support. Feature requests are tickets with category 'feature_request'.
CREATE TABLE support_tickets (
  id                 uuid CONSTRAINT pk_support_tickets PRIMARY KEY DEFAULT gen_random_uuid(),
  number             bigint GENERATED ALWAYS AS IDENTITY CONSTRAINT uq_support_tickets_number UNIQUE,
  site_id            uuid CONSTRAINT fk_support_tickets_site_id REFERENCES sites(id) ON DELETE SET NULL,
  requester_user_id  uuid CONSTRAINT fk_support_tickets_requester_user_id REFERENCES users(id) ON DELETE SET NULL,
  category           text NOT NULL CONSTRAINT chk_support_tickets_category CHECK (category IN ('complaint','bug','billing','false_alarm','feature_request','other')),
  subject            text NOT NULL,
  priority           text NOT NULL DEFAULT 'normal' CONSTRAINT chk_support_tickets_priority CHECK (priority IN ('low','normal','high','urgent')),
  status             text NOT NULL DEFAULT 'open'
                     CONSTRAINT chk_support_tickets_status CHECK (status IN ('open','in_progress','waiting_customer','resolved','closed')),
  assigned_to        uuid CONSTRAINT fk_support_tickets_assigned_to REFERENCES users(id) ON DELETE SET NULL,
  quoted_price_minor integer CONSTRAINT chk_support_tickets_quoted_price_minor CHECK (quoted_price_minor >= 0),   -- feature requests
  delivered_pack_id  uuid CONSTRAINT fk_support_tickets_delivered_pack_id REFERENCES packs(id) ON DELETE SET NULL,
  first_response_at  timestamptz,
  resolved_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_support_tickets_queue ON support_tickets (status, priority, created_at)
  WHERE status IN ('open','in_progress','waiting_customer');
CREATE INDEX idx_support_tickets_assignee ON support_tickets (assigned_to) WHERE status IN ('open','in_progress','waiting_customer');
CREATE INDEX idx_support_tickets_requester ON support_tickets (requester_user_id, created_at DESC);
CREATE INDEX idx_support_tickets_subject_trgm ON support_tickets USING gin (subject gin_trgm_ops);

CREATE TABLE ticket_messages (
  id             bigint GENERATED ALWAYS AS IDENTITY CONSTRAINT pk_ticket_messages PRIMARY KEY,
  ticket_id      uuid NOT NULL CONSTRAINT fk_ticket_messages_ticket_id REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_user_id uuid CONSTRAINT fk_ticket_messages_sender_user_id REFERENCES users(id) ON DELETE SET NULL,
  body           text NOT NULL CONSTRAINT chk_ticket_messages_body CHECK (char_length(body) BETWEEN 1 AND 8000),
  is_internal    boolean NOT NULL DEFAULT false,   -- staff-only note
  media_id       uuid CONSTRAINT fk_ticket_messages_media_id REFERENCES media(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ticket_messages_ticket ON ticket_messages (ticket_id, id);

CREATE TABLE export_jobs (
  id           uuid CONSTRAINT pk_export_jobs PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      uuid NOT NULL CONSTRAINT fk_export_jobs_site_id REFERENCES sites(id) ON DELETE CASCADE,
  requested_by uuid CONSTRAINT fk_export_jobs_requested_by REFERENCES site_members(id) ON DELETE SET NULL,
  report_type  text NOT NULL CONSTRAINT chk_export_jobs_report_type CHECK (report_type IN ('incidents','counts','compliance','alerts','invoices')),
  format       text NOT NULL CONSTRAINT chk_export_jobs_format CHECK (format IN ('csv','pdf')),
  params       jsonb NOT NULL DEFAULT '{}',
  status       text NOT NULL DEFAULT 'queued' CONSTRAINT chk_export_jobs_status CHECK (status IN ('queued','running','ready','failed')),
  media_id     uuid CONSTRAINT fk_export_jobs_media_id REFERENCES media(id) ON DELETE SET NULL,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  expires_at   timestamptz
);
CREATE INDEX idx_export_jobs_site ON export_jobs (site_id, created_at DESC);



-- =====================================================================
-- Migration 1790000013000-billing   owner: Mahir   module: billing
-- Tables: plans, subscriptions, subscription_items, invoices, invoice_lines, payments
-- =====================================================================

CREATE TABLE plans (
  id                      uuid CONSTRAINT pk_plans PRIMARY KEY DEFAULT gen_random_uuid(),
  code                    text NOT NULL CONSTRAINT uq_plans_code UNIQUE,     -- 'basic','standard','pro'
  name                    text NOT NULL,
  price_minor             integer NOT NULL CONSTRAINT chk_plans_price_minor CHECK (price_minor >= 0),
  currency                char(3) NOT NULL DEFAULT 'BDT',
  max_cameras             smallint NOT NULL,
  max_members             smallint,                 -- NULL = unlimited
  pack_slots              smallint NOT NULL DEFAULT 0,  -- packs of choice included besides Core
  recording_days          smallint NOT NULL,
  incident_retention_days smallint NOT NULL DEFAULT 180,
  is_public               boolean NOT NULL DEFAULT true,
  active                  boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
  id                   uuid CONSTRAINT pk_subscriptions PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id              uuid NOT NULL CONSTRAINT uq_subscriptions_site_id UNIQUE CONSTRAINT fk_subscriptions_site_id REFERENCES sites(id) ON DELETE CASCADE,
  plan_id              uuid NOT NULL CONSTRAINT fk_subscriptions_plan_id REFERENCES plans(id) ON DELETE RESTRICT,
  status               text NOT NULL CONSTRAINT chk_subscriptions_status CHECK (status IN ('trialing','active','past_due','cancelled')),
  trial_ends_at        timestamptz,
  current_period_start timestamptz NOT NULL,
  current_period_end   timestamptz NOT NULL,
  grace_until          timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_subscriptions_period_order CHECK (current_period_end > current_period_start)
);
CREATE INDEX idx_subscriptions_renewal ON subscriptions (current_period_end) WHERE status IN ('trialing','active','past_due');

-- Which packs a site may use. Replaces site_pack + subscription_addon + plan_pack.
CREATE TABLE subscription_items (
  id               uuid CONSTRAINT pk_subscription_items PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id  uuid NOT NULL CONSTRAINT fk_subscription_items_subscription_id REFERENCES subscriptions(id) ON DELETE CASCADE,
  pack_id          uuid NOT NULL CONSTRAINT fk_subscription_items_pack_id REFERENCES packs(id) ON DELETE RESTRICT,
  kind             text NOT NULL CONSTRAINT chk_subscription_items_kind CHECK (kind IN ('included','addon','custom')),
  unit_price_minor integer NOT NULL DEFAULT 0 CONSTRAINT chk_subscription_items_unit_price_minor CHECK (unit_price_minor >= 0),  -- price agreed at purchase
  started_at       timestamptz NOT NULL DEFAULT now(),
  ended_at         timestamptz,
  CONSTRAINT chk_subscription_items_included_free CHECK (kind <> 'included' OR unit_price_minor = 0)
);
CREATE UNIQUE INDEX uq_subscription_items_active ON subscription_items (subscription_id, pack_id) WHERE ended_at IS NULL;

CREATE TABLE invoices (
  id              uuid CONSTRAINT pk_invoices PRIMARY KEY DEFAULT gen_random_uuid(),
  number          text NOT NULL CONSTRAINT uq_invoices_number UNIQUE,                 -- 'VG-2026-000123'
  site_id         uuid CONSTRAINT fk_invoices_site_id REFERENCES sites(id) ON DELETE SET NULL,
  subscription_id uuid CONSTRAINT fk_invoices_subscription_id REFERENCES subscriptions(id) ON DELETE SET NULL,
  billing_name    text NOT NULL,                        -- copied at issue time
  period_start    timestamptz NOT NULL,
  period_end      timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'draft' CONSTRAINT chk_invoices_status CHECK (status IN ('draft','open','paid','void')),
  total_minor     integer NOT NULL DEFAULT 0 CONSTRAINT chk_invoices_total_minor CHECK (total_minor >= 0),  -- frozen when status leaves 'draft'
  currency        char(3) NOT NULL DEFAULT 'BDT',
  issued_at       timestamptz,
  due_at          timestamptz,
  paid_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_invoices_subscription_id_period_start UNIQUE (subscription_id, period_start)                -- one invoice per period: makes the billing job idempotent
);
CREATE INDEX idx_invoices_site ON invoices (site_id, created_at DESC);
CREATE INDEX idx_invoices_open ON invoices (due_at) WHERE status = 'open';
CREATE INDEX idx_invoices_paid ON invoices (paid_at) WHERE status = 'paid';

CREATE TABLE invoice_lines (
  id                   uuid CONSTRAINT pk_invoice_lines PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id           uuid NOT NULL CONSTRAINT fk_invoice_lines_invoice_id REFERENCES invoices(id) ON DELETE CASCADE,
  description          text NOT NULL,
  amount_minor         integer NOT NULL,
  subscription_item_id uuid CONSTRAINT fk_invoice_lines_subscription_item_id REFERENCES subscription_items(id) ON DELETE SET NULL
);
CREATE INDEX idx_invoice_lines_invoice ON invoice_lines (invoice_id);

CREATE TABLE payments (
  id              uuid CONSTRAINT pk_payments PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      uuid NOT NULL CONSTRAINT fk_payments_invoice_id REFERENCES invoices(id) ON DELETE RESTRICT,
  provider        text NOT NULL CONSTRAINT chk_payments_provider CHECK (provider IN ('sandbox','bkash','sslcommerz','manual')),
  provider_txn_id text NOT NULL,
  amount_minor    integer NOT NULL CONSTRAINT chk_payments_amount_minor CHECK (amount_minor > 0),
  status          text NOT NULL DEFAULT 'initiated' CONSTRAINT chk_payments_status CHECK (status IN ('initiated','succeeded','failed','refunded')),
  raw             jsonb NOT NULL DEFAULT '{}',          -- provider payload, never card data
  created_at      timestamptz NOT NULL DEFAULT now(),
  confirmed_at    timestamptz,
  CONSTRAINT uq_payments_provider_provider_txn_id UNIQUE (provider, provider_txn_id)                    -- webhook idempotency
);
CREATE INDEX idx_payments_invoice ON payments (invoice_id);
