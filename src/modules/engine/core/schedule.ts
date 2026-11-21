import type { Schedule } from "@/common/contracts";

/** Local weekday (0 = Monday), hour and minute of a moment in a time zone such as "Asia/Dhaka". */
export function localParts(epochMs: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(epochMs));
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  const dow = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday"));
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  return { dow, hour, minute, minutes: hour * 60 + minute };
}

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** null schedule = always active. A window "22:00" -> "06:00" continues into the next morning. */
export function isWithinSchedule(schedule: Schedule | null, epochMs: number, timeZone: string): boolean {
  if (!schedule) return true;
  const { dow, minutes } = localParts(epochMs, timeZone);
  const yesterday = (dow + 6) % 7;
  return schedule.windows.some((w) => {
    const from = toMinutes(w.from);
    const to = toMinutes(w.to);
    const days = w.dow as number[];
    if (from <= to) return days.includes(dow) && minutes >= from && minutes < to;
    return (days.includes(dow) && minutes >= from) || (days.includes(yesterday) && minutes < to);
  });
}

/** Night = 22:00 to 06:00 site time. Raises the risk score. */
export function isNight(epochMs: number, timeZone: string): boolean {
  const { hour } = localParts(epochMs, timeZone);
  return hour >= 22 || hour < 6;
}

/** 0 = Monday 00:00 ... 167 = Sunday 23:00. Key of zone_baselines. */
export function hourOfWeek(epochMs: number, timeZone: string): number {
  const { dow, hour } = localParts(epochMs, timeZone);
  return dow * 24 + hour;
}
