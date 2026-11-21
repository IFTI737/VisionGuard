// What a site member may do. A member's permissions are the preset of the
// role plus any extra ones stored in site_members.permissions.
export const PERMISSIONS = [
  "site.manage",
  "billing.manage",
  "members.manage",
  "cameras.manage",
  "zones.manage",
  "rules.manage",
  "live.view",
  "recordings.view",
  "incidents.view",
  "incidents.manage",
  "alerts.send",
  "alerts.receive",
  "chat.use",
  "reports.view",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PRESETS: Record<string, Permission[]> = {
  owner: [...PERMISSIONS],
  manager: PERMISSIONS.filter((p) => p !== "billing.manage" && p !== "site.manage"),
  guard: ["live.view", "incidents.view", "incidents.manage", "alerts.send", "alerts.receive", "chat.use"],
  viewer: ["live.view", "incidents.view", "alerts.receive", "chat.use"],
  contact: [], // phone-only contact: receives calls, never logs in
};

export const SEVERITY_ORDER = { low: 1, medium: 2, high: 3, critical: 4 } as const;
