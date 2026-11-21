// Names of the in-process events (EventEmitter2). A module emits an event when
// something happened; other modules listen with @OnEvent. This keeps modules
// from calling into each other in circles.
export const EVENTS = {
  SITE_CREATED: "site.created", // { siteId, ownerMemberId, manager }  (inside the creating transaction)
  CONFIG_CHANGED: "config.changed", // { siteId }  cameras/zones/rules changed -> drop caches, tell devices
  ZONE_STATE: "zone.state", // live counts for the dashboard
  CAMERA_STATUS: "camera.status",
  INCIDENT_CREATED: "incident.created",
  INCIDENT_UPDATED: "incident.updated",
  ALERT_CREATED: "alert.created",
  ALERT_UPDATED: "alert.updated",
  ALERT_RECIPIENT: "alert.recipient",
  MESSAGE_CREATED: "message.created",
  EXPORT_READY: "export.ready",
  DEVICE_COMMAND: "device.command", // { deviceId, command }
} as const;
