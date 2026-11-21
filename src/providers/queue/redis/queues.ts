// Names of the Bull queues. One place, so a producer and its worker cannot disagree.
export const QUEUE = {
  INCIDENT: "incident", // rule fired / cleared -> create or update an incident
  ESCALATION: "escalation", // alert steps, delayed
  DELIVERY: "delivery", // send one notification on one channel
  MAINTENANCE: "maintenance", // minute flush, rollups, sweeps, retention
  EXPORT: "export", // CSV reports
  BILLING: "billing", // invoices
} as const;
