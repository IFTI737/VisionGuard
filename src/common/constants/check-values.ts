// Single source of truth for every value list that the database also enforces
// with a CHECK constraint. Generated from schema.reference.sql (v3), then kept by hand.
//
// Use these in DTOs (@IsIn(SITES_KIND)), zod schemas (z.enum(SITES_KIND)) and
// entity types (kind!: SitesKind). `pnpm schema:check` compares every list in
// CHECK_VALUES with the constraint of the same name in the database.
//
// Never import this file from a migration: a migration keeps the list it was
// written with, forever.
//
// Naming: <TABLE>_<COLUMN>. The type is the same in PascalCase.

export const AI_MODELS_OUTPUT_KIND = ["boxes", "attrs", "measure"] as const;
export type AiModelsOutputKind = (typeof AI_MODELS_OUTPUT_KIND)[number];

export const AI_MODELS_RUNTIME = ["onnx_web", "onnx", "tensorrt", "openvino", "remote"] as const;
export type AiModelsRuntime = (typeof AI_MODELS_RUNTIME)[number];

export const AI_MODELS_STATUS = ["planned", "active", "retired"] as const;
export type AiModelsStatus = (typeof AI_MODELS_STATUS)[number];

export const AI_MODELS_TASK = ["detect", "classify", "pose", "segment", "count"] as const;
export type AiModelsTask = (typeof AI_MODELS_TASK)[number];

export const ALERT_RECIPIENTS_STATUS = ["pending", "notified", "seen", "acknowledged", "unreachable", "skipped"] as const;
export type AlertRecipientsStatus = (typeof ALERT_RECIPIENTS_STATUS)[number];

export const ALERTS_ACKNOWLEDGED_VIA = ["app", "telegram", "webpush", "call"] as const;
export type AlertsAcknowledgedVia = (typeof ALERTS_ACKNOWLEDGED_VIA)[number];

export const ALERTS_SEVERITY = ["low", "medium", "high", "critical"] as const;
export type AlertsSeverity = (typeof ALERTS_SEVERITY)[number];

export const ALERTS_SOURCE = ["system", "manual", "test"] as const;
export type AlertsSource = (typeof ALERTS_SOURCE)[number];

export const ALERTS_STATUS = ["active", "acknowledged", "exhausted", "cancelled"] as const;
export type AlertsStatus = (typeof ALERTS_STATUS)[number];

export const AUDIT_LOGS_ACTOR_KIND = ["user", "staff", "device", "system"] as const;
export type AuditLogsActorKind = (typeof AUDIT_LOGS_ACTOR_KIND)[number];

export const AUTH_CODES_CHANNEL = ["email", "sms"] as const;
export type AuthCodesChannel = (typeof AUTH_CODES_CHANNEL)[number];

export const AUTH_CODES_PURPOSE = ["email_verify", "phone_verify", "password_reset", "login_2fa"] as const;
export type AuthCodesPurpose = (typeof AUTH_CODES_PURPOSE)[number];

export const CAMERAS_RECORDING_MODE = ["off", "continuous", "incident_only"] as const;
export type CamerasRecordingMode = (typeof CAMERAS_RECORDING_MODE)[number];

export const CAMERAS_SOURCE_KIND = ["browser", "rtsp", "simulator"] as const;
export type CamerasSourceKind = (typeof CAMERAS_SOURCE_KIND)[number];

export const CAMERAS_STATUS = ["pending", "online", "offline", "no_signal", "tampered", "disabled"] as const;
export type CamerasStatus = (typeof CAMERAS_STATUS)[number];

export const CONVERSATIONS_KIND = ["team", "alert"] as const;
export type ConversationsKind = (typeof CONVERSATIONS_KIND)[number];

export const DELIVERY_ATTEMPTS_CHANNEL = ["inapp", "webpush", "telegram", "call"] as const;
export type DeliveryAttemptsChannel = (typeof DELIVERY_ATTEMPTS_CHANNEL)[number];

export const DELIVERY_ATTEMPTS_STATUS = ["queued", "sent", "delivered", "failed", "ringing", "answered", "no_answer", "busy", "cancelled"] as const;
export type DeliveryAttemptsStatus = (typeof DELIVERY_ATTEMPTS_STATUS)[number];

export const DETECTION_FEEDBACK_EXPORT_STATUS = ["pending", "exported", "excluded"] as const;
export type DetectionFeedbackExportStatus = (typeof DETECTION_FEEDBACK_EXPORT_STATUS)[number];

export const DETECTION_FEEDBACK_LABEL = ["false_positive", "true_positive", "wrong_class", "missed"] as const;
export type DetectionFeedbackLabel = (typeof DETECTION_FEEDBACK_LABEL)[number];

export const DEVICES_KIND = ["browser", "simulator", "gateway", "cloud_worker"] as const;
export type DevicesKind = (typeof DEVICES_KIND)[number];

export const DEVICES_STATUS = ["pending", "active", "disabled"] as const;
export type DevicesStatus = (typeof DEVICES_STATUS)[number];

export const DEVICES_TIME_MODE = ["wall", "event"] as const;
export type DevicesTimeMode = (typeof DEVICES_TIME_MODE)[number];

export const ESCALATION_POLICIES_MIN_SEVERITY = ["low", "medium", "high", "critical"] as const;
export type EscalationPoliciesMinSeverity = (typeof ESCALATION_POLICIES_MIN_SEVERITY)[number];

export const ESCALATION_STEPS_AUDIENCE = ["all_members", "role", "call_list"] as const;
export type EscalationStepsAudience = (typeof ESCALATION_STEPS_AUDIENCE)[number];

export const ESCALATION_STEPS_CHANNELS = ["inapp", "webpush", "telegram", "call"] as const;
export type EscalationStepsChannels = (typeof ESCALATION_STEPS_CHANNELS)[number];

export const ESCALATION_STEPS_ROLE = ["owner", "manager", "guard", "viewer", "contact"] as const;
export type EscalationStepsRole = (typeof ESCALATION_STEPS_ROLE)[number];

export const EXPORT_JOBS_FORMAT = ["csv", "pdf"] as const;
export type ExportJobsFormat = (typeof EXPORT_JOBS_FORMAT)[number];

export const EXPORT_JOBS_REPORT_TYPE = ["incidents", "counts", "compliance", "alerts", "invoices"] as const;
export type ExportJobsReportType = (typeof EXPORT_JOBS_REPORT_TYPE)[number];

export const EXPORT_JOBS_STATUS = ["queued", "running", "ready", "failed"] as const;
export type ExportJobsStatus = (typeof EXPORT_JOBS_STATUS)[number];

export const INCIDENT_EVENTS_TYPE = ["created", "recurred", "severity_changed", "alert_sent", "acknowledged", "resolved", "false_alarm", "reopened", "condition_cleared", "note", "clip_ready"] as const;
export type IncidentEventsType = (typeof INCIDENT_EVENTS_TYPE)[number];

export const INCIDENTS_FALSE_ALARM_REASON = ["wrong_object", "authorized_person", "animal", "light_or_shadow", "rule_too_sensitive", "other"] as const;
export type IncidentsFalseAlarmReason = (typeof INCIDENTS_FALSE_ALARM_REASON)[number];

export const INCIDENTS_SEVERITY = ["low", "medium", "high", "critical"] as const;
export type IncidentsSeverity = (typeof INCIDENTS_SEVERITY)[number];

export const INCIDENTS_STATUS = ["open", "acknowledged", "resolved", "false_alarm"] as const;
export type IncidentsStatus = (typeof INCIDENTS_STATUS)[number];

export const INVOICES_STATUS = ["draft", "open", "paid", "void"] as const;
export type InvoicesStatus = (typeof INVOICES_STATUS)[number];

export const LIVE_VIEW_SESSIONS_END_REASON = ["viewer_left", "timeout", "device_offline", "limit", "error"] as const;
export type LiveViewSessionsEndReason = (typeof LIVE_VIEW_SESSIONS_END_REASON)[number];

export const LIVE_VIEW_SESSIONS_TRANSPORT = ["p2p", "relay", "sfu"] as const;
export type LiveViewSessionsTransport = (typeof LIVE_VIEW_SESSIONS_TRANSPORT)[number];

export const MEDIA_KIND = ["image", "video", "file"] as const;
export type MediaKind = (typeof MEDIA_KIND)[number];

export const MEDIA_STATUS = ["pending", "ready", "purging"] as const;
export type MediaStatus = (typeof MEDIA_STATUS)[number];

export const MEDIA_STORAGE = ["local", "r2"] as const;
export type MediaStorage = (typeof MEDIA_STORAGE)[number];

export const MODEL_ASSIGNMENTS_ACTIVE_WHEN = ["always", "day", "night", "lowlight"] as const;
export type ModelAssignmentsActiveWhen = (typeof MODEL_ASSIGNMENTS_ACTIVE_WHEN)[number];

export const NOTIFICATION_ENDPOINTS_KIND = ["telegram", "webpush"] as const;
export type NotificationEndpointsKind = (typeof NOTIFICATION_ENDPOINTS_KIND)[number];

export const OBJECT_CLASSES_KIND = ["object", "attribute", "measure"] as const;
export type ObjectClassesKind = (typeof OBJECT_CLASSES_KIND)[number];

export const PACKS_STATUS = ["draft", "active", "retired"] as const;
export type PacksStatus = (typeof PACKS_STATUS)[number];

export const PAYMENTS_PROVIDER = ["sandbox", "bkash", "sslcommerz", "manual"] as const;
export type PaymentsProvider = (typeof PAYMENTS_PROVIDER)[number];

export const PAYMENTS_STATUS = ["initiated", "succeeded", "failed", "refunded"] as const;
export type PaymentsStatus = (typeof PAYMENTS_STATUS)[number];

export const RECORDING_SEGMENTS_CONTAINER = ["webm", "mp4", "fmp4"] as const;
export type RecordingSegmentsContainer = (typeof RECORDING_SEGMENTS_CONTAINER)[number];

export const RECORDING_SEGMENTS_STORED = ["cloud", "edge"] as const;
export type RecordingSegmentsStored = (typeof RECORDING_SEGMENTS_STORED)[number];

export const REFRESH_TOKENS_REVOKE_REASON = ["logout", "rotated", "reuse_detected", "password_changed", "admin", "logout_all"] as const;
export type RefreshTokensRevokeReason = (typeof REFRESH_TOKENS_REVOKE_REASON)[number];

export const RULE_TEMPLATES_DEFAULT_SEVERITY = ["low", "medium", "high", "critical"] as const;
export type RuleTemplatesDefaultSeverity = (typeof RULE_TEMPLATES_DEFAULT_SEVERITY)[number];

export const RULE_TEMPLATES_KIND = ["presence", "count_range", "attribute_missing", "proximity", "measure_threshold", "delta", "anomaly", "device_health"] as const;
export type RuleTemplatesKind = (typeof RULE_TEMPLATES_KIND)[number];

export const RULE_TEMPLATES_STATUS = ["draft", "active", "retired"] as const;
export type RuleTemplatesStatus = (typeof RULE_TEMPLATES_STATUS)[number];

export const RULES_SEVERITY = ["low", "medium", "high", "critical"] as const;
export type RulesSeverity = (typeof RULES_SEVERITY)[number];

export const SITE_MEMBERS_ROLE = ["owner", "manager", "guard", "viewer", "contact"] as const;
export type SiteMembersRole = (typeof SITE_MEMBERS_ROLE)[number];

export const SITE_MEMBERS_STATUS = ["invited", "active", "removed"] as const;
export type SiteMembersStatus = (typeof SITE_MEMBERS_STATUS)[number];

export const SITES_KIND = ["home", "farm", "construction", "shop", "workplace", "other"] as const;
export type SitesKind = (typeof SITES_KIND)[number];

export const SITES_MODE = ["armed", "paused"] as const;
export type SitesMode = (typeof SITES_MODE)[number];

export const SITES_STATUS = ["active", "suspended", "deleted"] as const;
export type SitesStatus = (typeof SITES_STATUS)[number];

export const SNAPSHOTS_TRIGGER = ["periodic", "incident", "manual", "tamper"] as const;
export type SnapshotsTrigger = (typeof SNAPSHOTS_TRIGGER)[number];

export const SUBSCRIPTION_ITEMS_KIND = ["included", "addon", "custom"] as const;
export type SubscriptionItemsKind = (typeof SUBSCRIPTION_ITEMS_KIND)[number];

export const SUBSCRIPTIONS_STATUS = ["trialing", "active", "past_due", "cancelled"] as const;
export type SubscriptionsStatus = (typeof SUBSCRIPTIONS_STATUS)[number];

export const SUPPORT_TICKETS_CATEGORY = ["complaint", "bug", "billing", "false_alarm", "feature_request", "other"] as const;
export type SupportTicketsCategory = (typeof SUPPORT_TICKETS_CATEGORY)[number];

export const SUPPORT_TICKETS_PRIORITY = ["low", "normal", "high", "urgent"] as const;
export type SupportTicketsPriority = (typeof SUPPORT_TICKETS_PRIORITY)[number];

export const SUPPORT_TICKETS_STATUS = ["open", "in_progress", "waiting_customer", "resolved", "closed"] as const;
export type SupportTicketsStatus = (typeof SUPPORT_TICKETS_STATUS)[number];

export const USERS_LOCALE = ["bn", "en"] as const;
export type UsersLocale = (typeof USERS_LOCALE)[number];

export const USERS_PLATFORM_ROLE = ["customer", "support", "admin"] as const;
export type UsersPlatformRole = (typeof USERS_PLATFORM_ROLE)[number];

export const USERS_STATUS = ["active", "disabled"] as const;
export type UsersStatus = (typeof USERS_STATUS)[number];

export const ZONES_ANCHOR = ["foot", "center", "overlap"] as const;
export type ZonesAnchor = (typeof ZONES_ANCHOR)[number];

export const ZONES_KIND = ["general", "restricted", "shed", "work", "shelf", "stock", "entrance", "guard_post"] as const;
export type ZonesKind = (typeof ZONES_KIND)[number];

/** constraint name -> allowed values. Add a line whenever you add a value-list CHECK. */
export const CHECK_VALUES: Record<string, readonly string[]> = {
  chk_ai_models_output_kind: AI_MODELS_OUTPUT_KIND,
  chk_ai_models_runtime: AI_MODELS_RUNTIME,
  chk_ai_models_status: AI_MODELS_STATUS,
  chk_ai_models_task: AI_MODELS_TASK,
  chk_alert_recipients_status: ALERT_RECIPIENTS_STATUS,
  chk_alerts_acknowledged_via: ALERTS_ACKNOWLEDGED_VIA,
  chk_alerts_severity: ALERTS_SEVERITY,
  chk_alerts_source: ALERTS_SOURCE,
  chk_alerts_status: ALERTS_STATUS,
  chk_audit_logs_actor_kind: AUDIT_LOGS_ACTOR_KIND,
  chk_auth_codes_channel: AUTH_CODES_CHANNEL,
  chk_auth_codes_purpose: AUTH_CODES_PURPOSE,
  chk_cameras_recording_mode: CAMERAS_RECORDING_MODE,
  chk_cameras_source_kind: CAMERAS_SOURCE_KIND,
  chk_cameras_status: CAMERAS_STATUS,
  chk_conversations_kind: CONVERSATIONS_KIND,
  chk_delivery_attempts_channel: DELIVERY_ATTEMPTS_CHANNEL,
  chk_delivery_attempts_status: DELIVERY_ATTEMPTS_STATUS,
  chk_detection_feedback_export_status: DETECTION_FEEDBACK_EXPORT_STATUS,
  chk_detection_feedback_label: DETECTION_FEEDBACK_LABEL,
  chk_devices_kind: DEVICES_KIND,
  chk_devices_status: DEVICES_STATUS,
  chk_devices_time_mode: DEVICES_TIME_MODE,
  chk_escalation_policies_min_severity: ESCALATION_POLICIES_MIN_SEVERITY,
  chk_escalation_steps_audience: ESCALATION_STEPS_AUDIENCE,
  chk_escalation_steps_channels: ESCALATION_STEPS_CHANNELS,
  chk_escalation_steps_role: ESCALATION_STEPS_ROLE,
  chk_export_jobs_format: EXPORT_JOBS_FORMAT,
  chk_export_jobs_report_type: EXPORT_JOBS_REPORT_TYPE,
  chk_export_jobs_status: EXPORT_JOBS_STATUS,
  chk_incident_events_type: INCIDENT_EVENTS_TYPE,
  chk_incidents_false_alarm_reason: INCIDENTS_FALSE_ALARM_REASON,
  chk_incidents_severity: INCIDENTS_SEVERITY,
  chk_incidents_status: INCIDENTS_STATUS,
  chk_invoices_status: INVOICES_STATUS,
  chk_live_view_sessions_end_reason: LIVE_VIEW_SESSIONS_END_REASON,
  chk_live_view_sessions_transport: LIVE_VIEW_SESSIONS_TRANSPORT,
  chk_media_kind: MEDIA_KIND,
  chk_media_status: MEDIA_STATUS,
  chk_media_storage: MEDIA_STORAGE,
  chk_model_assignments_active_when: MODEL_ASSIGNMENTS_ACTIVE_WHEN,
  chk_notification_endpoints_kind: NOTIFICATION_ENDPOINTS_KIND,
  chk_object_classes_kind: OBJECT_CLASSES_KIND,
  chk_packs_status: PACKS_STATUS,
  chk_payments_provider: PAYMENTS_PROVIDER,
  chk_payments_status: PAYMENTS_STATUS,
  chk_recording_segments_container: RECORDING_SEGMENTS_CONTAINER,
  chk_recording_segments_stored: RECORDING_SEGMENTS_STORED,
  chk_refresh_tokens_revoke_reason: REFRESH_TOKENS_REVOKE_REASON,
  chk_rule_templates_default_severity: RULE_TEMPLATES_DEFAULT_SEVERITY,
  chk_rule_templates_kind: RULE_TEMPLATES_KIND,
  chk_rule_templates_status: RULE_TEMPLATES_STATUS,
  chk_rules_severity: RULES_SEVERITY,
  chk_site_members_role: SITE_MEMBERS_ROLE,
  chk_site_members_status: SITE_MEMBERS_STATUS,
  chk_sites_kind: SITES_KIND,
  chk_sites_mode: SITES_MODE,
  chk_sites_status: SITES_STATUS,
  chk_snapshots_trigger: SNAPSHOTS_TRIGGER,
  chk_subscription_items_kind: SUBSCRIPTION_ITEMS_KIND,
  chk_subscriptions_status: SUBSCRIPTIONS_STATUS,
  chk_support_tickets_category: SUPPORT_TICKETS_CATEGORY,
  chk_support_tickets_priority: SUPPORT_TICKETS_PRIORITY,
  chk_support_tickets_status: SUPPORT_TICKETS_STATUS,
  chk_users_locale: USERS_LOCALE,
  chk_users_platform_role: USERS_PLATFORM_ROLE,
  chk_users_status: USERS_STATUS,
  chk_zones_anchor: ZONES_ANCHOR,
  chk_zones_kind: ZONES_KIND,
};
